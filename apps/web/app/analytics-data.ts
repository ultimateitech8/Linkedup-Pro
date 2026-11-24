export const dateRanges = [7, 30, 90] as const;
export type AnalyticsDays = typeof dateRanges[number];
export type Range = { from: string; through: string };

export type ProfileActivity = { day: string; views: number; appearances: number };
export type PersonalAnalytics = {
  range: Range;
  trackingSince: string;
  profile: { views: number; visitors: number; appearances: number; daily: ProfileActivity[] };
  content: {
    impressions: number; reach: number; likes: number; comments: number;
    posts: { id: number; excerpt: string; createdAt: string; impressions: number; reach: number; likes: number; comments: number }[];
  };
  publishing: {
    views: number; readers: number;
    articles: { id: number; title: string; publishedAt: string; views: number; readers: number }[];
    newsletters: { id: number; title: string; subscribers: number; newSubscribers: number; readers: number; editions: number }[];
  };
};

export type CompanyActivity = {
  id: number; name: string; industry: string; size: string; headquarters: string; views: number; visitors: number;
  followers: number; newFollowers: number; updates: number; updateImpressions: number; teamSize: number;
  openJobs: number; newJobs: number; locations: { location: string; followers: number }[];
};

export type HiringActivity = {
  id: number; title: string; company: string; companyId: number | null; closed: boolean; received: number; submitted: number;
  reviewing: number; interviews: number; offers: number; rejected: number; responded: number; medianResponseHours: number | null;
};

export type CampaignActivity = {
  id: number; name: string; company: string; companyId: number; format: string; objective: string;
  impressions: number; reach: number; clicks: number; leads: number;
};

export const numberText = (value: number) => new Intl.NumberFormat().format(value);
export const shortDate = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', ...(value.length === 10 ? { timeZone: 'UTC' } : {})
}).format(new Date(value));
