import type { Job } from './data';

export const writingTasks = {
  post: { name: 'Professional post', placeholder: 'Share a project outcome, a lesson learned, or a point you want to make.' },
  headline: { name: 'Profile headline', placeholder: 'Add your role, skills, and the type of work you focus on.' },
  profile: { name: 'Profile summary', placeholder: 'Describe your work, experience, and what you want people to know.' },
  message: { name: 'Message or proofreading', placeholder: 'Paste your draft or describe what you want to say.' },
  'job-description': { name: 'Job description', placeholder: 'Add the role, responsibilities, required skills, and working arrangement.' }
} as const;

export type WritingTask = keyof typeof writingTasks;
export type TextTask = WritingTask | 'career';
export type AiStatus = { available: boolean; remaining: number; dailyLimit: number };
export type AiDraft = { kind: 'draft'; text: string; remaining: number };
export type AiJobResults = {
  kind: 'jobs'; remaining: number; jobs: Job[];
  filters: { keywords: string[]; location: string; workMode: string; employmentType: string };
};
export type JobSkillReport = {
  id: number; title: string; company: string; requiredSkills: string[]; profileSkills: string[];
  matched: string[]; missingFromProfile: string[];
};
export const fitHref = (id: number) => '#ai?tab=fit&job=' + id;
export const splitSkills = (value: FormDataEntryValue | null | undefined) =>
  String(value ?? '').split(',').map((skill) => skill.trim()).filter(Boolean);
