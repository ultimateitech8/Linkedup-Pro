'use client';

import { useState } from 'react';
import { BarChart3, Building2 } from 'lucide-react';
import { Empty } from './components';
import { MetricGrid, ReportTable } from './analytics-personal';
import { numberText, type CampaignActivity, type CompanyActivity, type HiringActivity } from './analytics-data';

export function CompanyReport({ companies }: { companies: CompanyActivity[] }) {
  const [companyId, setCompanyId] = useState<number>();
  const company = companies.find((item) => item.id === companyId) ?? companies[0];
  if (!company) return <Empty title="No managed company pages">
    Company analytics are available to page owners and admins.
  </Empty>;

  return <>
    <section className="card content-card analytics-company-heading">
      <div><h2><Building2 size={20} /> {company.name}</h2><p className="analytics-meta">{company.industry} · {company.headquarters}</p>
        <a className="text-link" href={`#companies?company=${company.id}`}>Open company page</a>
      </div>
      {companies.length > 1 && <select aria-label="Choose company" value={company.id} onChange={(event) => setCompanyId(Number(event.target.value))}>
        {companies.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select>}
    </section>
    <MetricGrid values={[
      { label: 'Company page views', count: company.views }, { label: 'Unique visitors', count: company.visitors },
      { label: 'Current followers', count: company.followers }, { label: 'Current team members', count: company.teamSize }
    ]} />
    <div className="analytics-columns">
      <section className="card content-card analytics-section">
        <h2>Company activity</h2>
        <dl className="analytics-count-list">
          <div><dt>New active followers</dt><dd>{numberText(company.newFollowers)}</dd></div>
          <div><dt>Public updates published</dt><dd>{numberText(company.updates)}</dd></div>
          <div><dt>Update impressions</dt><dd>{numberText(company.updateImpressions)}</dd></div>
          <div><dt>Jobs posted</dt><dd>{numberText(company.newJobs)}</dd></div>
          <div><dt>Currently open jobs</dt><dd>{numberText(company.openJobs)}</dd></div>
        </dl>
      </section>
      <section className="card content-card analytics-section">
        <h2>Follower locations</h2>
        {company.locations.length > 0 ? <dl className="analytics-count-list">
          {company.locations.map(({ location, followers }) => <div key={location}><dt>{location}</dt><dd>{numberText(followers)}</dd></div>)}
        </dl> : <p className="muted">A location appears after at least three current followers list it on their profiles.</p>}
      </section>
    </div>
  </>;
}

function responseTime(hours: number | null) {
  if (hours === null) return '—';
  if (hours < 1 / 60) return 'Under 1 min';
  if (hours < 1) return `${numberText(Math.round(hours * 60))} min`;
  if (hours < 24) return `${numberText(Math.round(hours * 10) / 10)} hr`;
  return `${numberText(Math.round(hours / 24 * 10) / 10)} days`;
}

export function HiringReport({ jobs }: { jobs: HiringActivity[] }) {
  if (!jobs.length) return <Empty title="No managed jobs in this date range">
    Applications and hiring stages appear here for jobs you manage.
  </Empty>;
  const sum = (key: 'received' | 'responded' | 'interviews' | 'offers') => jobs.reduce((total, job) => total + job[key], 0);
  return <>
    <MetricGrid values={[
      { label: 'Applications received', count: sum('received') }, { label: 'Applications with a response', count: sum('responded') },
      { label: 'At interview stage', count: sum('interviews') }, { label: 'At offer stage', count: sum('offers') }
    ]} />
    <div className="analytics-columns">
      {jobs.map((job) => <section className="card content-card analytics-section" key={job.id}>
        <div className="section-heading analytics-job-heading"><h2>{job.title}</h2><span className={`status ${job.closed ? '' : 'green'}`}>{job.closed ? 'Closed' : 'Open'}</span></div>
        <p className="analytics-meta">{job.company} · {numberText(job.received)} {job.received === 1 ? 'application' : 'applications'} received</p>
        <dl className="analytics-count-list">
          <div><dt>Submitted</dt><dd>{numberText(job.submitted)}</dd></div>
          <div><dt>In review</dt><dd>{numberText(job.reviewing)}</dd></div>
          <div><dt>Interview</dt><dd>{numberText(job.interviews)}</dd></div>
          <div><dt>Offer</dt><dd>{numberText(job.offers)}</dd></div>
          <div><dt>Not selected</dt><dd>{numberText(job.rejected)}</dd></div>
          <div><dt>Median time to first response</dt><dd>{responseTime(job.medianResponseHours)}</dd></div>
        </dl>
      </section>)}
    </div>
  </>;
}

export function CampaignReport({ campaigns }: { campaigns: CampaignActivity[] }) {
  if (!campaigns.length) return <Empty title="No published campaigns to report">
    <a className="text-link" href="#advertising">Open Campaigns</a>
  </Empty>;
  const sum = (key: 'impressions' | 'clicks' | 'leads') => campaigns.reduce((total, campaign) => total + campaign[key], 0);
  return <>
    <MetricGrid values={[
      { label: 'Campaign impressions', count: sum('impressions') },
      { label: 'CTA clicks', count: sum('clicks') },
      { label: 'Consented leads', count: sum('leads') }
    ]} />
    <section className="card content-card analytics-section">
      <h2><BarChart3 size={20} /> Campaign performance</h2>
      <ReportTable label="Campaign performance" headers={['Campaign', 'Impressions', 'Unique reach', 'Clicks', 'Leads']}>
        {campaigns.map((campaign) => <tr key={campaign.id}><th scope="row">
          <a className="text-link" href={`#advertising?campaign=${campaign.id}`}>{campaign.name}</a>
          <small>{campaign.company} · {campaign.format}</small>
        </th><td>{numberText(campaign.impressions)}</td><td>{numberText(campaign.reach)}</td>
          <td>{numberText(campaign.clicks)}</td><td>{numberText(campaign.leads)}</td></tr>)}
      </ReportTable>
    </section>
  </>;
}
