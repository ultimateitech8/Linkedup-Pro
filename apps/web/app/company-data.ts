import type { CompanyBrand, Job, Person, Post } from './data';

export type CompanyRole = 'none' | 'requested' | 'employee' | 'admin' | 'owner';
export type CompanyPage = CompanyBrand & {
  description: string; industry: string; size: string; headquarters: string; locations: string[];
  workplace: string; website: string | null; culture: string; ctaLabel: string | null; ctaUrl: string | null;
  logoAlt: string; hasBanner: boolean; bannerAlt: string;
  role: CompanyRole; following: boolean; followerCount: number; employeeCount: number;
};
export type Showcase = { id: number; kind: 'Product' | 'Showcase'; title: string; description: string; url: string | null };
export type CompanyMember = Pick<Person, 'id' | 'name' | 'image' | 'headline'>;
export type CompanyDetail = {
  company: CompanyPage; posts: Post[]; jobs: Job[]; pages: Showcase[];
  team: (CompanyMember & { role: 'employee' | 'admin' | 'owner' })[];
  requests: (CompanyMember & { requestedAt: string })[];
  analytics: { visitorCount: number; followerCount: number; employeeCount: number; openJobs: number; updateCount: number } | null;
  hidden: { id: number; body: string }[];
};

export const roleName = { owner: 'Owner', admin: 'Admin', employee: 'Employee' };
export const mayManageCompany = (company: CompanyPage) => company.role === 'owner' || company.role === 'admin';
