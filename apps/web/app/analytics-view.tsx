'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChartNoAxesCombined, RefreshCw } from 'lucide-react';
import { useApiResource } from './api-resource';
import { CampaignReport, CompanyReport, HiringReport } from './analytics-business';
import { dateRanges, shortDate, type AnalyticsDays, type CampaignActivity, type CompanyActivity, type HiringActivity, type PersonalAnalytics, type Range } from './analytics-data';
import { PersonalReport } from './analytics-personal';
import { FilterTabs } from './views';

const reports = { personal: 'Profile & content', companies: 'Companies', hiring: 'Hiring', campaigns: 'Campaigns' } as const;
type ReportKey = keyof typeof reports;

function Report<T extends { range: Range }>({ name, days, revision, render }: {
  name: ReportKey; days: AnalyticsDays; revision: number; render: (data: T) => ReactNode;
}) {
  const { snapshot, refresh } = useApiResource<T>(`analytics/${name}?days=${days}`, revision);
  if (!snapshot) return <p className="muted" role="status">Loading analytics…</p>;
  if ('error' in snapshot) return <div className="card content-card analytics-section">
    <p className="dialog-error" role="alert">{snapshot.error}</p><button className="button secondary analytics-retry" onClick={refresh}>Try again</button>
  </div>;
  return <>
    <p className="analytics-meta analytics-coverage">{shortDate(snapshot.data.range.from)} to {shortDate(snapshot.data.range.through)} · UTC</p>
    {render(snapshot.data)}
  </>;
}

export function AnalyticsView() {
  const [tab, setTab] = useState<ReportKey>('personal');
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const read = () => {
      if (window.location.hash.split('?')[0] !== '#analytics') return;
      const value = new URLSearchParams(window.location.hash.split('?')[1]).get('tab');
      const key = (Object.keys(reports) as ReportKey[]).find((item) => item === value);
      setTab(key ?? 'personal');
      window.scrollTo({ top: 0 });
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  return <div className="analytics-workspace">
    <header className="analytics-banner"><div><h1>Analytics</h1><p>See how members discover your work and engage with your business.</p></div>
      <ChartNoAxesCombined size={85} strokeWidth={1.2} aria-hidden="true" /></header>
    <div className="analytics-tools">
      <FilterTabs values={Object.values(reports)} current={reports[tab]} change={(label) => {
        const key = (Object.keys(reports) as ReportKey[]).find((item) => reports[item] === label);
        window.location.hash = key === 'personal' ? 'analytics' : `analytics?tab=${key}`;
      }} />
      <div className="analytics-range-tools">
        <label><span>Date range</span><select value={days} onChange={(event) => setDays(Number(event.target.value) as AnalyticsDays)}>
          {dateRanges.map((value) => <option value={value} key={value}>Last {value} days</option>)}
        </select></label>
        <button className="button secondary" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={16} /> Refresh</button>
      </div>
    </div>
    {tab === 'personal' && <Report<PersonalAnalytics> name={tab} days={days} revision={revision} render={(data) => <PersonalReport report={data} />} />}
    {tab === 'companies' && <Report<{ range: Range; trackingSince: string; companies: CompanyActivity[] }> name={tab} days={days} revision={revision}
      render={(data) => <>
        {data.companies.length > 0 && data.range.from < data.trackingSince && <p className="analytics-meta">
          Dated tracking for company visits, update impressions, and new followers began on {shortDate(data.trackingSince)}.
        </p>}
        <CompanyReport companies={data.companies} />
      </>} />}
    {tab === 'hiring' && <Report<{ range: Range; jobs: HiringActivity[] }> name={tab} days={days} revision={revision}
      render={(data) => <HiringReport jobs={data.jobs} />} />}
    {tab === 'campaigns' && <Report<{ range: Range; campaigns: CampaignActivity[] }> name={tab} days={days} revision={revision}
      render={(data) => <CampaignReport campaigns={data.campaigns} />} />}
  </div>;
}
