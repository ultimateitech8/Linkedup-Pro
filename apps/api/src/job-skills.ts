import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db } from './database.js';
import { jobFields, jobVisibility } from './jobs-query.js';

const clean = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export const listedSkills = z.array(z.string().trim().min(1).max(50)).max(16).transform((values) => {
  const unique = new Map<string, string>();
  for (const value of values) {
    const key = clean(value);
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()];
});
export const jobWorkModes = z.enum(['Remote', 'Hybrid', 'On-site']);
export const jobEmploymentTypes = z.enum(['Full-time', 'Part-time', 'Internship', 'Contract']);

export async function jobSkillComparison(member: string, id: number) {
  const { rows: [job] } = await db.query<{
    id: number; title: string; company: string; description: string; workMode: string; employmentType: string;
    requiredSkills: string[]; profileSkills: string[];
  }>(`SELECT ${jobFields},COALESCE(p.skills,'{}') AS "profileSkills"
    FROM jobs j LEFT JOIN profiles p ON p.user_id=$1 WHERE j.id=$2 AND (${jobVisibility})`, [member, id]);
  if (!job) throw new NotFoundException('This job is unavailable.');
  const memberSkills = new Set(job.profileSkills.map(clean));
  return {
    ...job,
    matched: job.requiredSkills.filter((skill) => memberSkills.has(clean(skill))),
    missingFromProfile: job.requiredSkills.filter((skill) => !memberSkills.has(clean(skill)))
  };
}

export async function jobSkillReport(member: string, id: number) {
  const job = await jobSkillComparison(member, id);
  const { title, company, requiredSkills, profileSkills, matched, missingFromProfile } = job;
  return { id, title, company, requiredSkills, profileSkills, matched, missingFromProfile };
}

export const jobSearchFilters = z.object({
  keywords: z.array(z.string().trim().min(1).max(65)).max(5),
  location: z.string().trim().max(100),
  workMode: z.union([jobWorkModes, z.literal('')]),
  employmentType: z.union([jobEmploymentTypes, z.literal('')])
});
export type JobSearchFilters = z.output<typeof jobSearchFilters>;

export async function searchJobsByFilters(member: string, filter: JobSearchFilters) {
  const { rows } = await db.query(`SELECT ${jobFields}
    FROM jobs j LEFT JOIN professional_companies c ON c.id=j.company_id
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS hits FROM unnest($2::text[]) word
      WHERE strpos(lower(concat_ws(' ',j.title,j.description,COALESCE(c.name,j.company),array_to_string(j.required_skills,' '))),lower(word))>0
    ) relevancy WHERE NOT j.closed AND (cardinality($2::text[])=0 OR relevancy.hits>0)
      AND ($3='' OR strpos(lower(j.location),lower($3))>0)
      AND ($4='' OR j.work_mode=$4) AND ($5='' OR j.employment_type=$5)
    ORDER BY relevancy.hits DESC,j.created_at DESC,j.id DESC LIMIT 20`,
  [member, filter.keywords, filter.location, filter.workMode, filter.employmentType]);
  return rows;
}
