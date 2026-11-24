import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { positiveId } from './access.js';
import { videoUrl } from './article-document.js';
import { db, isLearningInstructor } from './database.js';

const field = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default('');
const quiz = z.object({
  prompt: field(240),
  choices: z.tuple([field(140), field(140), field(140)]),
  answer: z.number().int().min(0).max(2)
}).refine(({ choices }) => new Set(choices.map((choice) => choice.toLowerCase())).size === 3,
  'Enter three different answers for each quiz.');
const lesson = z.object({
  title: field(100), minutes: z.number().int().min(1).max(240), notes: optionalText(1800),
  video: optionalText(2048).transform((value) => value ? videoUrl(value) : ''),
  exercise: optionalText(600), quiz: quiz.nullable().default(null)
}).refine(({ notes, video }) => Boolean(notes || video), 'Add lecture notes or a YouTube video to each lesson.');

export const courseInput = z.object({
  title: field(120), description: field(1000),
  category: z.enum(['Technical', 'Business', 'Soft skills', 'Certification prep']),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']),
  skills: z.array(field(40)).max(8).transform((skills) => [...new Set(skills)]),
  lessons: z.array(lesson).min(1).max(16)
});
export const pathInput = z.object({
  title: field(120), description: field(600),
  courses: z.array(positiveId).min(2).max(8).refine((courses) => new Set(courses).size === courses.length, 'Choose each course once.')
});
type CourseInput = z.output<typeof courseInput>;
type Lesson = z.output<typeof lesson>;
type Member = { id: string; email: string; emailVerified: boolean };

const courseFields = `c.id,c.title,c.description,c.category,c.level,c.skills,
  COALESCE(u.name,'Linkedup Pro') AS instructor, c.published_at AS "publishedAt",
  jsonb_array_length(c.lessons) AS "lessonCount",
  (SELECT sum((item->>'minutes')::int)::int FROM jsonb_array_elements(c.lessons) item) AS minutes,
  b.user_id IS NOT NULL AS saved,
  e.user_id IS NOT NULL AS enrolled, e.completed_lessons AS "completedLessons",
  e.certificate_id AS "certificateId",e.profile_visible AS "onProfile"`;
const courseSource = `FROM learning_courses c LEFT JOIN "user" u ON u.id=c.instructor_id
  LEFT JOIN learning_bookmarks b ON b.course_id=c.id AND b.user_id=$1
  LEFT JOIN learning_enrollments e ON e.course_id=c.id AND e.user_id=$1`;

function requireInstructor(user: Member) {
  if (!isLearningInstructor(user)) throw new ForbiddenException('Instructor access is required.');
}

export async function learningCatalog(user: Member) {
  const [catalog, paths] = await Promise.all([
    db.query(`SELECT ${courseFields} ${courseSource}
      WHERE c.published_at IS NOT NULL OR ($2 AND c.instructor_id=$1)
      ORDER BY c.published_at DESC NULLS FIRST,c.id DESC`, [user.id, isLearningInstructor(user)]),
    db.query(`SELECT p.id,p.title,p.description,json_agg(json_build_object(
      'id',c.id,'title',c.title,'completed',e.completed_at IS NOT NULL) ORDER BY pc.position) AS courses
      FROM learning_paths p JOIN learning_path_courses pc ON pc.path_id=p.id
      JOIN learning_courses c ON c.id=pc.course_id
      LEFT JOIN learning_enrollments e ON e.course_id=c.id AND e.user_id=$1
      GROUP BY p.id ORDER BY p.id DESC`, [user.id])
  ]);
  return { courses: catalog.rows, paths: paths.rows };
}

export async function searchCourses(query: string) {
  if (!query) return [];
  const { rows } = await db.query(`SELECT id,title,category FROM learning_courses WHERE published_at IS NOT NULL
    AND strpos(lower(concat_ws(' ',title,description,category,array_to_string(skills,' '))),lower($1))>0
    ORDER BY (strpos(lower(title),lower($1))>0) DESC,published_at DESC,id DESC LIMIT 4`, [query]);
  return rows;
}

export async function courseDetail(user: Member, id: number) {
  const { rows: [course] } = await db.query(`SELECT ${courseFields},c.lessons ${courseSource}
    WHERE c.id=$2 AND (c.published_at IS NOT NULL OR ($3 AND c.instructor_id=$1))`, [user.id, id, isLearningInstructor(user)]);
  if (!course) throw new NotFoundException('This course is unavailable.');
  const { lessons, ...summary } = course;
  return {
    ...summary,
    lessons: (lessons as Lesson[]).map(({ title, minutes, notes, video, exercise, quiz }, index) => ({
      number: index + 1, title, minutes,
      ...(course.enrolled ? { notes, video, exercise, quiz: quiz && { prompt: quiz.prompt, choices: quiz.choices } } : {})
    })),
    ...(!course.publishedAt ? { draftLessons: lessons } : {})
  };
}

export async function saveCourse(user: Member, input: CourseInput, id?: number) {
  requireInstructor(user);
  const fields = [user.id, input.title, input.description, input.category, input.level, input.skills, JSON.stringify(input.lessons)];
  if (!id) {
    const { rows: [course] } = await db.query(`INSERT INTO learning_courses
      (instructor_id,title,description,category,level,skills,lessons) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, fields);
    return course;
  }
  const { rowCount } = await db.query(`UPDATE learning_courses SET title=$2,description=$3,category=$4,level=$5,skills=$6,lessons=$7
    WHERE instructor_id=$1 AND id=$8 AND published_at IS NULL`, [...fields, id]);
  if (!rowCount) throw new ConflictException('This draft is unavailable for editing.');
  return { id };
}

export async function publishCourse(user: Member, id: number) {
  requireInstructor(user);
  const { rowCount } = await db.query(`UPDATE learning_courses SET published_at=COALESCE(published_at,now())
    WHERE id=$1 AND instructor_id=$2`, [id, user.id]);
  if (!rowCount) throw new NotFoundException('This course is unavailable.');
  return { ok: true };
}

export async function publishPath(user: Member, input: z.output<typeof pathInput>) {
  requireInstructor(user);
  const { rows: [path] } = await db.query(`
    WITH selected AS (
      SELECT item.course_id,item.position FROM unnest($3::int[]) WITH ORDINALITY item(course_id,position)
      JOIN learning_courses c ON c.id=item.course_id AND c.published_at IS NOT NULL
    ), path AS (
      INSERT INTO learning_paths(title,description)
      SELECT $1,$2 WHERE (SELECT count(*) FROM selected)=cardinality($3::int[]) RETURNING id
    )
    INSERT INTO learning_path_courses(path_id,position,course_id)
    SELECT path.id,selected.position,selected.course_id FROM path CROSS JOIN selected RETURNING path_id AS id`,
  [input.title, input.description, input.courses]);
  if (!path) throw new BadRequestException('Choose published courses for this learning path.');
  return { id: path.id };
}

export async function enroll(userId: string, courseId: number) {
  const result = await db.query(`INSERT INTO learning_enrollments(user_id,course_id)
    SELECT $1,id FROM learning_courses WHERE id=$2 AND published_at IS NOT NULL
    ON CONFLICT (user_id,course_id) DO UPDATE SET course_id=EXCLUDED.course_id`, [userId, courseId]);
  if (!result.rowCount) throw new NotFoundException('This course is unavailable.');
  return { ok: true };
}

export async function bookmarkCourse(userId: string, courseId: number, active: boolean) {
  if (active) {
    const { rowCount } = await db.query(`INSERT INTO learning_bookmarks(user_id,course_id)
      SELECT $1,id FROM learning_courses WHERE id=$2 AND published_at IS NOT NULL
      ON CONFLICT (user_id,course_id) DO UPDATE SET course_id=EXCLUDED.course_id`, [userId, courseId]);
    if (!rowCount) throw new NotFoundException('This course is unavailable.');
  } else {
    await db.query('DELETE FROM learning_bookmarks WHERE user_id=$1 AND course_id=$2', [userId, courseId]);
  }
  return { ok: true };
}

export async function completeLesson(userId: string, courseId: number, number: number, answer?: number) {
  const { rows: [entry] } = await db.query(`SELECT c.lessons->($3::int-1) AS lesson,jsonb_array_length(c.lessons) AS total
    FROM learning_courses c JOIN learning_enrollments e ON e.course_id=c.id
    WHERE e.user_id=$1 AND c.id=$2 AND c.published_at IS NOT NULL`, [userId, courseId, number]);
  if (!entry?.lesson) throw new NotFoundException('Join the course to open this lesson.');
  const { quiz } = entry.lesson as Lesson;
  if (quiz && answer !== quiz.answer) return { passed: false };
  await db.query(`UPDATE learning_enrollments
    SET completed_lessons=array_append(completed_lessons,$3),
      completed_at=CASE WHEN cardinality(completed_lessons)+1=$4 THEN now() ELSE completed_at END,
      certificate_id=CASE WHEN cardinality(completed_lessons)+1=$4 THEN $5 ELSE certificate_id END
    WHERE user_id=$1 AND course_id=$2 AND NOT ($3=ANY(completed_lessons))`, [userId, courseId, number, entry.total, randomUUID()]);
  return { passed: true };
}

const certificateFields = `e.certificate_id AS id,e.completed_at AS "completedAt",c.id AS "courseId",c.title,
  learner.name AS recipient,COALESCE(instructor.name,'Linkedup Pro') AS instructor`;
const certificateSource = `FROM learning_enrollments e JOIN learning_courses c ON c.id=e.course_id
  JOIN "user" learner ON learner.id=e.user_id LEFT JOIN "user" instructor ON instructor.id=c.instructor_id`;

export async function visibleCertificates(profileId: string) {
  const { rows } = await db.query(`SELECT ${certificateFields} ${certificateSource}
    WHERE e.user_id=$1 AND e.profile_visible ORDER BY e.completed_at DESC`, [profileId]);
  return rows;
}

export async function certificateDetail(userId: string, id: string) {
  const { rows: [certificate] } = await db.query(`SELECT ${certificateFields},e.user_id=$1 AS mine,e.profile_visible AS "onProfile"
    ${certificateSource} WHERE e.certificate_id=$2 AND (e.user_id=$1 OR e.profile_visible)`, [userId, id]);
  if (!certificate) throw new NotFoundException('This certificate is unavailable.');
  return certificate;
}

export async function certificateVisibility(userId: string, id: string, active: boolean) {
  const { rowCount } = await db.query('UPDATE learning_enrollments SET profile_visible=$3 WHERE user_id=$1 AND certificate_id=$2',
    [userId, id, active]);
  if (!rowCount) throw new NotFoundException('This certificate is unavailable.');
  return { ok: true };
}
