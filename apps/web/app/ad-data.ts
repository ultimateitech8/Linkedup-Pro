import type { CompanyBrand } from './data';

export const adFormats = ['Sponsored post', 'Single image', 'Text'] as const;
export const adObjectives = { company: 'Company page', website: 'Website visits', lead: 'Lead generation' } as const;

export type AdFormat = typeof adFormats[number];
export type AdObjective = keyof typeof adObjectives;
export type AdCompany = { id: number; name: string };
export type AdCampaignStatus = 'Draft' | 'Scheduled' | 'Running' | 'Paused' | 'Ended' | 'Budget reached' | 'Post unavailable';
export type AdCampaign = {
  id: number; companyId: number; companyName: string; name: string; format: AdFormat; postId: number | null;
  headline: string; body: string | null; hasImage: boolean; imageAlt: string; objective: AdObjective; destination: string | null;
  buttonLabel: string; targetLocation: string; targetSkills: string[]; followersOnly: boolean; budget: number;
  delivered: number; startsAt: string | null; endsAt: string | null; state: 'draft' | 'active' | 'paused' | 'ended';
  status: AdCampaignStatus; reach: number; clicks: number; leadCount: number;
};
export type AdReport = AdCampaign & { daily: { day: string; deliveries: number; clicks: number }[] };
export type AdWorkspace = { companies: AdCompany[]; campaigns: AdCampaign[] };
export type AdSource = { id: number; body: string; createdAt: string };
export type FeedAd = {
  id: string; headline: string; body: string; hasImage: boolean; imageAlt: string; objective: AdObjective;
  buttonLabel: string; company: CompanyBrand; converted: boolean;
};
export type AdLead = { id: string; name: string; email: string; message: string; consentedAt: string };

export const campaignPath = (id: number) => 'advertising/campaigns/' + id;
export const campaignHref = (id: number) => '#advertising?campaign=' + id;
export const formatAdNumber = (value: number) => new Intl.NumberFormat().format(value);
export const formatAdDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
