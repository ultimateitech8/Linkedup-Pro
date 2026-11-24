import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException,
  Get, NotFoundException, Param, Patch, Post, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser, MemberUploadGuard, positiveId, read, requireUser } from './access.js';
import { aiConfigured } from './ai-provider.js';
import { managesCompany, managesJob } from './company-access.js';
import { appOrigin, auth, db, demoEmail, demoMode, demoPassword, emailEnabled, inviteOnly, isLearningInstructor, isModerator } from './database.js';
import { jobFields, jobVisibility } from './jobs-query.js';
import { jobEmploymentTypes, jobWorkModes, listedSkills } from './job-skills.js';
import { loadModeration, reportPost, reviewPost } from './moderation.js';
import { listDashboardPosts, postAccess } from './posts.js';
import { notifyMember } from './realtime.js';
import { resumeDisposition, resumeMaxBytes, type ResumeUpload, validateResume } from './resume.js';

const text = (length: number) => z.string().trim().min(1).max(length);
const optionalText = (length: number) => z.string().trim().max(length).default('');
const personId = text(128);
const optionalUrl = z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(2048)]).default('');
const outcomes = z.enum(['In review', 'Interview', 'Offer', 'Not selected']);
const reasons = z.enum(['Spam', 'Harassment', 'Fraud or impersonation', 'Inappropriate content', 'Other']);
const publicPerson = 'u.id, u.name, u.image, COALESCE(p.headline, \'\') AS headline, COALESCE(p.location, \'\') AS location';

async function requireModerator(request: Request) {
  const user = await requireUser(request);
  if (!isModerator(user)) throw new ForbiddenException('Moderator access is required.');
  return user;
}

@Controller('api')
export class PlatformController {
  @Get('health')
  async health() {
    await db.query('SELECT 1');
    return { ok: true };
  }

  @Post('demo/:person')
  async demo(@Param('person') rawPerson: string, @Req() request: Request, @Res() response: Response) {
    if (!demoMode) throw new NotFoundException();
    const origin = request.get('origin');
    if (origin && origin !== appOrigin) throw new ForbiddenException();
    const person = read(z.enum(['alex', 'maya', 'jordan']), rawPerson);
    const upstream = await auth.api.signInEmail({
      body: { email: person === 'alex' ? demoEmail : `${person}@example.test`, password: demoPassword },
      asResponse: true
    });
    for (const cookie of upstream.headers.getSetCookie()) response.append('Set-Cookie', cookie);
    response.status(upstream.status).type('json').send(await upstream.text());
  }

  @Get('dashboard')
  async dashboard(@Req() request: Request) {
    const user = await currentUser(request);
    if (!user) return { demoMode, emailEnabled, inviteOnly, me: null };

    const [profile, posts, people, jobs, projects, applications, notifications, messages, pendingProjects, hiring] = await Promise.all([
      db.query(
        `SELECT ${publicPerson}, COALESCE(about,'') AS about, COALESCE(skills,'{}') AS skills,
          (SELECT count(*)::int FROM connections WHERE accepted AND (sender=u.id OR recipient=u.id)) AS connections
         FROM "user" u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=$1`, [user.id]
      ),
      listDashboardPosts(user.id),
      db.query(
        `SELECT ${publicPerson}, COALESCE(p.about,'') AS about, COALESCE(p.skills,'{}') AS skills,
          CASE WHEN c.accepted THEN 'connected' WHEN c.sender=$1 THEN 'sent' WHEN c.recipient=$1 THEN 'received' ELSE 'none' END AS connection
         FROM "user" u LEFT JOIN profiles p ON p.user_id=u.id
         LEFT JOIN connections c ON (c.sender=$1 AND c.recipient=u.id) OR (c.recipient=$1 AND c.sender=u.id)
         WHERE u.id<>$1 ORDER BY u.name LIMIT 120`, [user.id]
      ),
      db.query(
        `SELECT ${jobFields} FROM jobs j WHERE ${jobVisibility} ORDER BY j.created_at DESC LIMIT 200`, [user.id]
      ),
      db.query(
        `SELECT pr.id,pr.title,pr.contribution,pr.url,pr.verified_at AS "verifiedAt",pr.is_public AS "isPublic",
          pr.verifier_id AS "verifierId",v.name AS verifier
         FROM projects pr LEFT JOIN "user" v ON v.id=pr.verifier_id WHERE pr.owner_id=$1 ORDER BY pr.id DESC`, [user.id]
      ),
      db.query(
        `SELECT a.id, a.job_id AS "jobId",j.title,
          COALESCE((SELECT name FROM professional_companies c WHERE c.id=j.company_id),j.company) AS company,
          a.resume_url AS "resumeUrl", resume.filename AS "resumeFileName",
          COALESCE((SELECT json_agg(json_build_object('status',e.status,'createdAt',e.created_at) ORDER BY e.id DESC)
            FROM application_events e WHERE e.application_id=a.id),'[]') AS timeline
         FROM applications a JOIN jobs j ON j.id=a.job_id LEFT JOIN application_resumes resume ON resume.application_id=a.id
         WHERE a.user_id=$1 ORDER BY a.id DESC`, [user.id]
      ),
      db.query(
        `SELECT id,message,category,seen,created_at AS "createdAt",publication_article_id AS "articleId",company_id AS "companyId",
          service_request_id AS "serviceRequestId"
         FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 30`, [user.id]
      ),
      db.query(
        'SELECT id,sender,recipient,body,created_at AS "createdAt" FROM messages WHERE sender=$1 OR recipient=$1 ORDER BY id DESC LIMIT 300', [user.id]
      ),
      db.query(
        `SELECT pr.id,pr.title,pr.contribution,pr.url,u.name AS owner FROM projects pr JOIN "user" u ON u.id=pr.owner_id
         WHERE pr.verifier_id=$1 AND pr.verified_at IS NULL ORDER BY pr.id DESC`, [user.id]
      ),
      db.query(
        `SELECT a.id,a.job_id AS "jobId",u.name AS applicant,a.note,a.resume_url AS "resumeUrl", resume.filename AS "resumeFileName",
          (SELECT e.status FROM application_events e WHERE e.application_id=a.id ORDER BY e.id DESC LIMIT 1) AS status,
          CASE WHEN pr.id IS NOT NULL THEN json_build_object('title',pr.title,'contribution',pr.contribution,'url',pr.url,'verified',pr.verified_at IS NOT NULL) END AS project
         FROM applications a JOIN jobs j ON j.id=a.job_id JOIN "user" u ON u.id=a.user_id
         LEFT JOIN projects pr ON pr.id=a.project_id LEFT JOIN application_resumes resume ON resume.application_id=a.id
         WHERE ${managesJob('$1')} ORDER BY a.id DESC`, [user.id]
      )
    ]);
    return {
      demoMode, emailEnabled, inviteOnly,
      me: { ...profile.rows[0], email: user.email, aiAvailable: aiConfigured, isModerator: isModerator(user),
        isLearningInstructor: isLearningInstructor(user), twoFactorEnabled: user.twoFactorEnabled ?? false },
      posts: posts.rows, people: people.rows, jobs: jobs.rows, projects: projects.rows,
      applications: applications.rows, notifications: notifications.rows, messages: messages.rows,
      pendingProjects: pendingProjects.rows, hiring: hiring.rows
    };
  }

  @Patch('profile')
  async profile(@Req() request: Request, @Body() body: unknown) {
    const user = await requireUser(request);
    const fields = read(z.object({ name: text(100), headline: optionalText(140), location: optionalText(100),
      about: optionalText(2000), skills: z.array(text(50)).max(20).default([]) }), body);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE "user" SET name=$2,"updatedAt"=now() WHERE id=$1', [user.id, fields.name]);
      await client.query(
        `INSERT INTO profiles(user_id,headline,location,about,skills) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(user_id) DO UPDATE SET headline=EXCLUDED.headline, location=EXCLUDED.location,
           about=EXCLUDED.about, skills=EXCLUDED.skills`,
        [user.id, fields.headline, fields.location, fields.about, fields.skills]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  }

  @Get('profiles/:id')
  async memberProfile(@Req() request: Request, @Param('id') id: string) {
    const user = await requireUser(request);
    const { rows: [profile] } = await db.query(`SELECT ${publicPerson},COALESCE(p.about,'') AS about,COALESCE(p.skills,'{}') AS skills,
      CASE WHEN c.accepted THEN 'connected' WHEN c.sender=$1 THEN 'sent' WHEN c.recipient=$1 THEN 'received' ELSE 'none' END AS connection
      FROM "user" u LEFT JOIN profiles p ON p.user_id=u.id
      LEFT JOIN connections c ON (c.sender=$1 AND c.recipient=u.id) OR (c.sender=u.id AND c.recipient=$1)
      WHERE u.id=$2 AND ($3 OR u."emailVerified")`, [user.id, read(personId, id), !emailEnabled]);
    if (!profile) throw new NotFoundException('This profile is unavailable.');
    return profile;
  }

  @Get('profiles/:id/projects')
  async memberProjects(@Req() request: Request, @Param('id') id: string) {
    await requireUser(request);
    return (await db.query(
      `SELECT pr.id,pr.title,pr.contribution,pr.url,pr.verified_at AS "verifiedAt",v.name AS verifier
       FROM projects pr LEFT JOIN "user" v ON v.id=pr.verifier_id
       WHERE pr.owner_id=$1 AND pr.is_public ORDER BY pr.id DESC LIMIT 50`, [id]
    )).rows;
  }

  @Post('posts')
  async post(@Req() request: Request, @Body() body: unknown) {
    const user = await requireUser(request);
    const fields = read(z.object({ body: text(3000) }), body);
    await db.query('INSERT INTO posts(author_id, body) VALUES ($1,$2)', [user.id, fields.body]);
    return { ok: true };
  }

  @Delete('posts/:id')
  async deletePost(@Req() request: Request, @Param('id') id: string) {
    const user = await requireUser(request);
    const result = await db.query(`DELETE FROM posts post WHERE id=$1
      AND ((post.company_id IS NULL AND post.author_id=$2) OR ${managesCompany('post.company_id', '$2')})`, [read(positiveId,id), user.id]);
    if (!result.rowCount) throw new NotFoundException();
    return { ok: true };
  }

  @Post('posts/:id/:action')
  async postAction(@Req() request: Request, @Param('id') id: string, @Param('action') rawAction: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const post = read(positiveId, id);
    const action = read(z.enum(['like','bookmark','comment','report']), rawAction);
    if (action === 'report') {
      const { reason } = read(z.object({ reason: reasons.default('Other') }), body ?? {});
      await reportPost(post, user.id, reason);
      return { ok: true };
    }
    const access = await postAccess(user.id, post);
    if (!access) throw new NotFoundException('This post is unavailable.');
    if (!access.canParticipate && (action === 'like' || action === 'comment')) {
      throw new ForbiddenException('This discussion is unavailable for participation.');
    }
    if (action === 'comment') {
      const fields = read(z.object({ body: text(1000) }), body);
      await db.query('INSERT INTO comments(post_id,author_id,body) VALUES ($1,$2,$3)', [post, user.id, fields.body]);
    } else {
      const { active } = read(z.object({ active: z.boolean() }), body);
      const table = action === 'like' ? 'reactions' : 'bookmarks';
      await db.query(active
        ? `INSERT INTO ${table}(post_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`
        : `DELETE FROM ${table} WHERE post_id=$1 AND user_id=$2`, [post, user.id]);
    }
    return { ok: true };
  }

  @Get('moderation')
  async moderation(@Req() request: Request) {
    await requireModerator(request);
    return loadModeration();
  }

  @Post('moderation/posts/:id')
  async moderationAction(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireModerator(request);
    const { action } = read(z.object({ action: z.enum(['dismiss', 'hide', 'restore']) }), body);
    await reviewPost(read(positiveId, id), user.id, action);
    return { ok: true };
  }

  @Post('connections/:id')
  async connect(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const recipient = read(personId, id);
    if (recipient === user.id) throw new BadRequestException();
    const { action } = read(z.object({ action: z.enum(['request', 'accept', 'remove']) }), body);
    if (action === 'remove') {
      await db.query('DELETE FROM connections WHERE (sender=$1 AND recipient=$2) OR (sender=$2 AND recipient=$1)', [user.id, recipient]);
    } else if (action === 'accept') {
      await db.query(
        `WITH changed AS (UPDATE connections SET accepted=true WHERE sender=$2 AND recipient=$1 AND NOT accepted RETURNING sender)
         INSERT INTO notifications(user_id,message,category) SELECT sender,$3,'Network' FROM changed`,
        [user.id, recipient, `${user.name} accepted your connection request.`]
      );
    } else {
      await db.query(
        `WITH changed AS (
           INSERT INTO connections(sender,recipient) SELECT $1,id FROM "user" WHERE id=$2
           ON CONFLICT DO NOTHING RETURNING recipient
         ) INSERT INTO notifications(user_id,message,category) SELECT recipient,$3,'Network' FROM changed`,
        [user.id, recipient, `${user.name} sent you a connection request.`]
      );
    }
    return { ok: true };
  }

  @Post('projects')
  async project(@Req() request: Request, @Body() body: unknown) {
    const user = await requireUser(request);
    const fields = read(z.object({ title: text(100), contribution: text(2000), url: optionalUrl,
      verifierId: optionalText(128), isPublic: z.boolean() }), body);
    if (fields.verifierId === user.id) throw new BadRequestException('Choose someone else to verify your contribution.');
    if (fields.verifierId && !(await db.query(
      'SELECT 1 FROM connections WHERE accepted AND ((sender=$1 AND recipient=$2) OR (sender=$2 AND recipient=$1))',
      [user.id, fields.verifierId]
    )).rowCount) throw new BadRequestException('Choose one of your connections.');
    await db.query(
      `WITH created AS (
        INSERT INTO projects(owner_id,title,contribution,url,verifier_id,is_public) VALUES ($1,$2,$3,$4,$5,$6) RETURNING verifier_id
      ) INSERT INTO notifications(user_id,message,category) SELECT verifier_id,$7,'Profile' FROM created WHERE verifier_id IS NOT NULL`,
      [user.id, fields.title, fields.contribution, fields.url || null, fields.verifierId || null,
        fields.isPublic, `${user.name} asked you to verify a project contribution.`]
    );
    return { ok: true };
  }

  @Post('projects/:id/verify')
  async verify(@Req() request: Request, @Param('id') id: string) {
    const user = await requireUser(request);
    const result = await db.query(
      `WITH changed AS (
        UPDATE projects SET verified_at=now() WHERE id=$1 AND verifier_id=$2 AND verified_at IS NULL RETURNING owner_id,title
      ) INSERT INTO notifications(user_id,message,category) SELECT owner_id,$3 || title || '.','Profile' FROM changed`,
      [read(positiveId, id), user.id, `${user.name} confirmed your contribution to `]
    );
    if (!result.rowCount) throw new NotFoundException('This verification request is unavailable.');
    return { ok: true };
  }

  @Post('jobs')
  async job(@Req() request: Request, @Body() body: unknown) {
    const user = await requireUser(request);
    const fields = read(z.object({ title: text(120), company: optionalText(100), companyId: positiveId.optional(),
      location: text(120), workMode: jobWorkModes, employmentType: jobEmploymentTypes, salary: text(80), description: text(4000),
      responseDate: z.iso.date(), requiredSkills: listedSkills.default([])
    }).refine((item) => Boolean(item.companyId || item.company), 'Enter a company name.'), body);
    const result = await db.query(
      `INSERT INTO jobs(owner_id,title,company,location,work_mode,employment_type,salary,description,response_date,company_id,required_skills)
       SELECT $1,$2,COALESCE(company.name,$3),$4,$5,$6,$7,$8,$9,$10,$11
       FROM (VALUES (1)) AS job_row(value) LEFT JOIN professional_companies company ON company.id=$10
       WHERE $10 IS NULL OR ${managesCompany('$10', '$1')}`,
      [user.id,fields.title,fields.company,fields.location,fields.workMode,fields.employmentType,fields.salary,
        fields.description,fields.responseDate,fields.companyId ?? null,fields.requiredSkills]
    );
    if (!result.rowCount) throw new ForbiddenException('Company admin access is required to post this job.');
    return { ok: true };
  }

  @Get('jobs/:id')
  async jobDetails(@Req() request: Request, @Param('id') id: string) {
    const user = await requireUser(request);
    const job = (await db.query(
      `SELECT ${jobFields} FROM jobs j WHERE j.id=$2 AND (${jobVisibility})`, [user.id, read(positiveId, id)]
    )).rows[0];
    if (!job) throw new NotFoundException('This job is unavailable.');
    return job;
  }

  @Patch('jobs/:id/skills')
  async jobSkills(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { requiredSkills } = read(z.object({ requiredSkills: listedSkills }), body);
    const { rowCount } = await db.query(`UPDATE jobs j SET required_skills=$3 WHERE j.id=$2 AND ${managesJob('$1')}`,
      [user.id, read(positiveId, id), requiredSkills]);
    if (!rowCount) throw new NotFoundException('This job is unavailable for editing.');
    return { ok: true };
  }

  @Post('jobs/:id/save')
  async saveJob(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { active } = read(z.object({ active: z.boolean() }), body);
    await db.query(active
      ? 'INSERT INTO saved_jobs(job_id,user_id) SELECT id,$2 FROM jobs WHERE id=$1 AND NOT closed ON CONFLICT DO NOTHING'
      : 'DELETE FROM saved_jobs WHERE job_id=$1 AND user_id=$2', [read(positiveId,id),user.id]);
    return { ok: true };
  }

  @Post('jobs/:id/apply')
  @UseGuards(MemberUploadGuard)
  @UseInterceptors(FileInterceptor('resume', {
    limits: { fileSize: resumeMaxBytes + 1, fieldSize: 8192, fields: 3, parts: 6, files: 1 }
  }))
  async apply(@Req() request: Request, @Param('id') id: string, @Body() body: unknown, @UploadedFile() file?: ResumeUpload) {
    const user = await requireUser(request);
    const jobId = read(positiveId,id);
    const fields = read(z.object({
      note: optionalText(2000), projectId: z.preprocess((id) => id === '' ? undefined : id, positiveId.nullish()), resumeUrl: optionalUrl
    }), body ?? {});
    if (file && fields.resumeUrl) throw new BadRequestException('Choose a PDF or a résumé link.');
    const resume = file ? validateResume(file) : null;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const job = (await client.query(
        `SELECT j.owner_id,j.company_id,j.closed,j.title,${managesJob('$2')} AS "canManage"
         FROM jobs j WHERE j.id=$1 FOR UPDATE`, [jobId, user.id]
      )).rows[0];
      if (!job || job.closed) throw new NotFoundException('Applications for this job are closed.');
      if (job.canManage) throw new BadRequestException('You manage this job listing.');
      if (fields.projectId && !(await client.query('SELECT 1 FROM projects WHERE id=$1 AND owner_id=$2', [fields.projectId,user.id])).rowCount) {
        throw new BadRequestException('Choose a project from your profile.');
      }
      const inserted = await client.query(
        'INSERT INTO applications(job_id,user_id,project_id,note,resume_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',
        [jobId,user.id,fields.projectId ?? null,fields.note,fields.resumeUrl || null]
      );
      if (!inserted.rowCount) throw new ConflictException('You already applied for this job.');
      if (resume) await client.query('INSERT INTO application_resumes(application_id,filename,content) VALUES($1,$2,$3)',
        [inserted.rows[0].id, resume.filename, resume.content]);
      await client.query("INSERT INTO application_events(application_id,status) VALUES ($1,'Submitted')", [inserted.rows[0].id]);
      if (job.company_id) await client.query(`INSERT INTO notifications(user_id,message,category)
        SELECT user_id,$2,'Jobs' FROM company_members WHERE company_id=$1 AND role='admin'`,
      [job.company_id,`${user.name} applied for ${job.title}.`]);
      else await client.query("INSERT INTO notifications(user_id,message,category) VALUES($1,$2,'Jobs')",
        [job.owner_id,`${user.name} applied for ${job.title}.`]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  }

  @Get('applications/:id/resume')
  async downloadResume(@Req() request: Request, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const user = await requireUser(request);
    const result = await db.query<{ filename: string; content: Buffer }>(
      `SELECT r.filename,r.content FROM application_resumes r JOIN applications a ON a.id=r.application_id
       JOIN jobs j ON j.id=a.job_id WHERE r.application_id=$1 AND (a.user_id=$2 OR ${managesJob('$2')})`,
      [read(positiveId, id), user.id]
    );
    const file = result.rows[0];
    if (!file) throw new NotFoundException('This résumé is unavailable.');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.content, { type: 'application/pdf', disposition: resumeDisposition(file.filename) });
  }

  @Post('jobs/:id/close')
  async closeJob(@Req() request: Request, @Param('id') id: string) {
    const user = await requireUser(request);
    const result = await db.query(
      `WITH closed AS (UPDATE jobs j SET closed=true WHERE j.id=$1 AND ${managesJob('$2')} AND NOT j.closed RETURNING id,title),
         events AS (INSERT INTO application_events(application_id,status)
           SELECT a.id,'Role closed' FROM applications a JOIN closed j ON j.id=a.job_id),
         notices AS (INSERT INTO notifications(user_id,message,category)
           SELECT a.user_id,j.title || ' is now closed.','Jobs' FROM applications a JOIN closed j ON j.id=a.job_id)
       SELECT id FROM closed`, [read(positiveId,id),user.id]
    );
    if (!result.rowCount) throw new NotFoundException();
    return { ok: true };
  }

  @Patch('applications/:id')
  async applicationStatus(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { status } = read(z.object({ status: outcomes }), body);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const application = (await client.query(
        `SELECT a.user_id,j.title,j.closed FROM applications a JOIN jobs j ON j.id=a.job_id
         WHERE a.id=$1 AND ${managesJob('$2')} FOR UPDATE OF j`, [read(positiveId,id),user.id]
      )).rows[0];
      if (!application || application.closed) throw new NotFoundException('This application is unavailable.');
      const last = (await client.query('SELECT status FROM application_events WHERE application_id=$1 ORDER BY id DESC LIMIT 1', [id])).rows[0];
      if (last?.status !== status) {
        await client.query('INSERT INTO application_events(application_id,status) VALUES($1,$2)', [id,status]);
        await client.query("INSERT INTO notifications(user_id,message,category) VALUES($1,$2,'Jobs')",
          [application.user_id,`${application.title}: ${status}.`]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  }

  @Post('messages/:recipient')
  async message(@Req() request: Request, @Param('recipient') recipient: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const fields = read(z.object({ body: text(3000) }), body);
    const result = await db.query<{ user_id: string }>(
      `WITH sent AS (
        INSERT INTO messages(sender,recipient,body)
        SELECT $1,$2,$3 FROM connections
        WHERE accepted AND ((sender=$1 AND recipient=$2) OR (sender=$2 AND recipient=$1))
        RETURNING recipient
      ) INSERT INTO notifications(user_id,message,category) SELECT recipient,$4,'Messages' FROM sent RETURNING user_id`,
      [user.id,read(personId,recipient),fields.body,`${user.name} sent you a message.`]
    );
    if (!result.rowCount) throw new ForbiddenException('Connect with this member before sending a message.');
    notifyMember(result.rows[0].user_id);
    return { ok: true };
  }

  @Post('notifications/read')
  async markRead(@Req() request: Request) {
    const user = await requireUser(request);
    await db.query('UPDATE notifications SET seen=true WHERE user_id=$1 AND NOT seen', [user.id]);
    return { ok: true };
  }
}
