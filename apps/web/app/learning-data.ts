export const categories = ['Technical', 'Business', 'Soft skills', 'Certification prep'] as const;
export const levels = ['Beginner', 'Intermediate', 'Advanced'] as const;

export type CourseSearchResult = { id: number; title: string; category: typeof categories[number] };
export type Course = CourseSearchResult & {
  description: string; level: typeof levels[number]; skills: string[]; instructor: string;
  publishedAt: string | null; lessonCount: number; minutes: number; saved: boolean;
  enrolled: boolean; completedLessons: number[] | null; certificateId: string | null; onProfile: boolean | null;
};
type LessonQuiz = { prompt: string; choices: string[] };
export type LessonInput = { title: string; minutes: number; notes: string; video: string; exercise: string; quiz: (LessonQuiz & { answer: number }) | null };
export type CourseLesson = { number: number; title: string; minutes: number; notes?: string; video?: string; exercise?: string; quiz?: LessonQuiz | null };
export type CourseDetail = Course & { lessons: CourseLesson[]; draftLessons?: LessonInput[] };
export type LearningPath = { id: number; title: string; description: string; courses: { id: number; title: string; completed: boolean }[] };
export type Catalog = { courses: Course[]; paths: LearningPath[] };
export type Certificate = { id: string; courseId: number; title: string; recipient: string; instructor: string; completedAt: string };
export type CertificateDetail = Certificate & { mine: boolean; onProfile: boolean };

export const courseHref = (id: number) => '#learning?course=' + id;
export const certificateHref = (id: string) => '#learning?certificate=' + id;
export const issueDate = (value: string) => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value));
