export type Person = {
  id: string; name: string; image: string | null; headline: string;
  location: string; about: string; skills: string[];
  connection: 'connected' | 'sent' | 'received' | 'none';
};
export type Me = Person & { email: string; connections: number; aiAvailable: boolean; isModerator: boolean; isLearningInstructor: boolean; twoFactorEnabled: boolean };
export type CompanyBrand = { id: number; name: string; hasLogo: boolean; updatedAt: string };
export type Post = {
  id: number; author: Person; body: string; image?: string; createdAt: string;
  groupId?: number | null; groupName?: string | null; topic?: string | null; canParticipate?: boolean;
  eventId?: number | null; eventTitle?: string | null;
  company?: CompanyBrand | null; followsCompany?: boolean; canManageCompany?: boolean;
  likes: number; liked: boolean; saved: boolean; commentCount: number;
  comments: { id: number; name: string; body: string; image: string | null }[];
};
export type Job = {
  id: number; ownerId: string; title: string; company: string; location: string; workMode: string;
  companyId: number | null; canManage: boolean;
  employmentType: string; salary: string; description: string; requiredSkills: string[]; responseDate?: string;
  color: string; saved: boolean; closed: boolean; createdAt: string;
};
export type Project = {
  id: number; title: string; contribution: string; url?: string; isPublic: boolean;
  verifiedAt?: string; verifierId?: string; verifier?: string;
};
export type Resume = { id: number; resumeUrl?: string | null; resumeFileName?: string | null };
export type Application = Resume & {
  id: number; jobId: number; title: string; company: string;
  timeline: { status: string; createdAt: string }[];
};
export type Hiring = Resume & { jobId: number; applicant: string; note: string; status: string;
  project?: { title: string; contribution: string; url?: string; verified: boolean };
};
export type Notification = { id: number; message: string; category: string; seen: boolean; createdAt: string; articleId?: number | null; companyId?: number | null; serviceRequestId?: number | null };
export type Message = { id: number; sender: string; recipient: string; body: string; createdAt: string };
export type AccessOptions = { demoMode: boolean; emailEnabled: boolean; inviteOnly: boolean };
export type Dashboard = AccessOptions & {
  me: Me; posts: Post[]; people: Person[]; jobs: Job[]; projects: Project[];
  applications: Application[]; hiring: Hiring[]; notifications: Notification[]; messages: Message[];
  pendingProjects: (Project & { owner: string })[];
};
export type View = 'home' | 'network' | 'jobs' | 'companies' | 'groups' | 'events' | 'publications' | 'learning' | 'services' | 'sales' | 'advertising' | 'analytics' | 'ai' | 'messages' | 'saved' | 'profile' | 'settings' | 'moderation';
export type Action = (path: string, body?: object, success?: string, method?: string) => Promise<boolean>;

export class RequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

export async function api<T = { ok: boolean }>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (typeof options?.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers,
    cache: 'no-store'
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(typeof data?.message === 'string' ? data.message : 'The request could not be completed. Try again.',
    typeof data?.code === 'string' ? data.code : undefined);
  return data as T;
}

export const day = (value?: string) => value ? new Intl.DateTimeFormat('en', {
  month: 'short', day: 'numeric', timeZone: value.length === 10 ? 'UTC' : undefined
}).format(new Date(value)) : '';

export const companyImagePath = (brand: CompanyBrand, kind: 'logo' | 'banner') =>
  `/api/companies/${brand.id}/media/${kind}?v=${encodeURIComponent(brand.updatedAt)}`;

export function ago(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
