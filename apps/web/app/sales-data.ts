import type { CompanyBrand } from './data';

export const salesStages = ['Prospect', 'Contacted', 'Qualified', 'Won', 'Lost'] as const;
export type SalesStage = typeof salesStages[number];

type LeadProfile = {
  id: string; name: string; image: string | null; headline: string; location: string; skills: string[];
  companyId: number | null; companyName: string | null; relationship: 'connected' | 'mutual' | 'outside';
};
export type SalesLead = LeadProfile & {
  saved: boolean; mutualCount: number; matchedSkills: string[]; leadershipSignal: string | null;
};
export type SavedSalesLead = LeadProfile & { stage: SalesStage; notes: string; followUpAt: string | null };
type AccountInfo = CompanyBrand & {
  description: string; industry: string; size: string; headquarters: string; workplace: string;
  openJobs: number; newJobs: number; recentUpdates: number;
};
export type SalesAccount = AccountInfo & { saved: boolean };
export type SavedSalesAccount = AccountInfo & { watching: boolean };
export type SalesList = { id: number; name: string; leadIds: string[]; accountIds: number[] };
export type SalesWorkspace = { leads: SavedSalesLead[]; accounts: SavedSalesAccount[]; lists: SalesList[] };
export type SalesSearchResult<T> = { results: T[]; next: number | null };

export const companyHref = (id: number) => '#companies?company=' + id;
export const leadPath = (id: string) => 'sales/leads/' + encodeURIComponent(id);
export const accountPath = (id: number) => 'sales/accounts/' + id;
export const salesListHref = (id?: number) => '#sales?tab=lists' + (id ? '&list=' + id : '');
export const salesDate = (date: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
