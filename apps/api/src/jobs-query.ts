import { managesJob } from './company-access.js';

// Jobs are aliased as j and the viewer is the first query parameter.
export const jobFields = `
  j.id,j.title,COALESCE((SELECT name FROM professional_companies c WHERE c.id=j.company_id),j.company) AS company,
  j.company_id AS "companyId",j.location,j.work_mode AS "workMode",j.employment_type AS "employmentType",
  j.salary,j.description,j.required_skills AS "requiredSkills",j.response_date::text AS "responseDate",j.color,j.closed,j.owner_id AS "ownerId",
  j.created_at AS "createdAt",${managesJob('$1')} AS "canManage",
  EXISTS(SELECT 1 FROM saved_jobs s WHERE s.job_id=j.id AND s.user_id=$1) AS saved
`;

export const jobVisibility = `NOT j.closed OR ${managesJob('$1')}
  OR EXISTS(SELECT 1 FROM applications a WHERE a.job_id=j.id AND a.user_id=$1)
  OR EXISTS(SELECT 1 FROM saved_jobs s WHERE s.job_id=j.id AND s.user_id=$1)`;
