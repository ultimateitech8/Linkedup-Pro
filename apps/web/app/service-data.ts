export const serviceCategories = ['Design', 'Development', 'Marketing', 'Writing', 'Business consulting', 'Career coaching', 'Other'] as const;
export const serviceModes = ['Remote', 'On-site', 'Both'] as const;
export const quoteCurrencies = ['USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD'] as const;
export type Category = typeof serviceCategories[number];
export type ServiceMode = typeof serviceModes[number];
export type Offering = { id: number; title: string; description: string; category: Category; pricingNote: string; active: boolean };
export type ServiceSearchResult = Pick<Offering, 'id' | 'title' | 'category'> & { providerId: number; name: string };
export type DirectoryOffering = Offering & ServiceSearchResult & {
  memberId: string; image: string | null; headline: string; workMode: ServiceMode; location: string; rating: number | null; reviewCount: number;
};
export type ServiceDirectory = { offerings: DirectoryOffering[]; next: number | null };
export type ServiceReview = { id: number; name: string; image: string | null; rating: number; body: string; offeringTitle: string | null; createdAt: string };
export type Provider = {
  id: number; memberId: string; name: string; image: string | null; headline: string; about: string;
  workMode: ServiceMode; location: string; accepting: boolean; mine: boolean; leads?: number;
  offerings: Offering[]; reviews: ServiceReview[]; rating: number | null; reviewCount: number;
};
export type ServiceSummary = { id: number; headline: string };
export const requestLabels = {
  requested: 'Requested', quoted: 'Proposal sent', accepted: 'In progress', delivered: 'Delivered',
  completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled'
} as const;
export type ServiceStatus = keyof typeof requestLabels;
export type ServiceRequest = {
  id: number; title: string; kind: 'inquiry' | 'proposal'; status: ServiceStatus; offeringTitle: string | null;
  updatedAt: string; role: 'client' | 'provider'; otherName: string; otherImage: string | null;
};
export type Proposal = { amount: number; currency: typeof quoteCurrencies[number]; scope: string; delivery: string; version: number };
export type RequestDetail = ServiceRequest & {
  providerId: number; brief: string; budget: string; quote: Proposal | null; review: { rating: number; body: string } | null;
  messages: { id: number; kind: 'message' | 'activity'; body: string; name: string; mine: boolean; createdAt: string }[];
};

export const serviceProviderHref = (providerId: number, offeringId?: number) =>
  `#services?provider=${providerId}${offeringId ? `&listing=${offeringId}` : ''}`;
export const serviceRequestHref = (requestId: number) => '#services?request=' + requestId;
export const serviceWorkMode = (mode: ServiceMode) => mode === 'Both' ? 'Remote and on-site' : mode;
export const quoteAmount = (proposal: Proposal) => new Intl.NumberFormat(undefined, {
  style: 'currency', currency: proposal.currency, currencyDisplay: 'code', minimumFractionDigits: proposal.amount % 100 === 0 ? 0 : 2
}).format(proposal.amount / 100);
export const serviceDate = (date: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', ...(date.length === 10 ? { timeZone: 'UTC' } : {})
}).format(new Date(date));
