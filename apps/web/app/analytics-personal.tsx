'use client';

import type { ReactNode } from 'react';
import { Search, UserRound } from 'lucide-react';
import { numberText, shortDate, type PersonalAnalytics, type ProfileActivity } from './analytics-data';

export function MetricGrid({ values }: { values: { label: string; count: number }[] }) {
  return <dl className="analytics-metrics">
    {values.map(({ label, count }) => <div className="card" key={label}>
      <dt>{label}</dt><dd>{numberText(count)}</dd>
    </div>)}
  </dl>;
}

export function ReportTable({ headers, label, children }: { headers: string[]; label: string; children: ReactNode }) {
  return <div className="analytics-table-region" tabIndex={0} role="region" aria-label={label}>
    <table><thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

function ProfileTrend({ activity }: { activity: ProfileActivity[] }) {
  const max = Math.max(0, ...activity.map((day) => day.views + day.appearances));
  return <section className="card content-card analytics-section">
    <div className="section-heading"><h2>Profile activity over time</h2></div>
    {max > 0 ? <>
      <div className="analytics-legend"><span><UserRound size={15} /> Profile views</span><span><Search size={15} /> Search appearances</span></div>
      <div className="analytics-chart" aria-hidden="true">
        {activity.map(({ day, views, appearances }) => <span className="analytics-bar" key={day}
          title={`${shortDate(day)} · ${views} profile views · ${appearances} search appearances`}>
          <i style={{ height: `${views * 100 / max}%` }} /><i style={{ height: `${appearances * 100 / max}%` }} />
        </span>)}
      </div>
      <div className="analytics-chart-dates" aria-hidden="true"><span>{shortDate(activity[0].day)}</span><span>{shortDate(activity[activity.length - 1].day)}</span></div>
      <details><summary>Daily profile and search counts</summary><ReportTable label="Daily profile and search counts"
        headers={['Date (UTC)', 'Profile views', 'Search appearances']}>
        {activity.map((item) => <tr key={item.day}><th scope="row">{shortDate(item.day)}</th>
          <td>{numberText(item.views)}</td><td>{numberText(item.appearances)}</td></tr>)}
      </ReportTable></details>
    </> : <p className="muted">No profile views or search appearances in this date range yet.</p>}
  </section>;
}

export function PersonalReport({ report }: { report: PersonalAnalytics }) {
  const { profile, content, publishing, trackingSince, range } = report;
  return <>
    <MetricGrid values={[
      { label: 'Profile views', count: profile.views }, { label: 'Unique profile visitors', count: profile.visitors },
      { label: 'Search appearances', count: profile.appearances }, { label: 'Post impressions', count: content.impressions }
    ]} />
    {range.from < trackingSince && <p className="analytics-meta">Dated tracking for profile visits, posts, and article readership began on {shortDate(trackingSince)}.</p>}
    <ProfileTrend activity={profile.daily} />
    <section className="card content-card analytics-section">
      <h2>Post performance</h2>
      <p className="analytics-meta">{numberText(content.reach)} unique members reached · {numberText(content.likes)} recorded likes · {numberText(content.comments)} comments</p>
      {content.posts.length > 0 ? <ReportTable label="Post performance" headers={['Post', 'Impressions', 'Reach', 'Likes', 'Comments']}>
        {content.posts.map((post) => <tr key={post.id}>
          <th scope="row"><strong>{post.excerpt}</strong><small>{shortDate(post.createdAt)}</small></th>
          <td>{numberText(post.impressions)}</td><td>{numberText(post.reach)}</td><td>{numberText(post.likes)}</td><td>{numberText(post.comments)}</td>
        </tr>)}
      </ReportTable> : <p className="muted">No activity on your public feed posts in this date range.</p>}
    </section>
    <section className="card content-card analytics-section">
      <h2>Article readership</h2>
      <p className="analytics-meta">{numberText(publishing.views)} article views · {numberText(publishing.readers)} unique readers</p>
      {publishing.articles.length > 0 ? <ReportTable label="Article readership" headers={['Article', 'Views', 'Unique readers']}>
        {publishing.articles.map((article) => <tr key={article.id}><th scope="row">
          <a className="text-link" href={`#publications?article=${article.id}`}>{article.title}</a><small>{shortDate(article.publishedAt)}</small>
        </th><td>{numberText(article.views)}</td><td>{numberText(article.readers)}</td></tr>)}
      </ReportTable> : <p className="muted">No published articles or readership activity in this date range.</p>}
    </section>
    <section className="card content-card analytics-section">
      <h2>Newsletters</h2>
      {publishing.newsletters.length > 0 ? <ReportTable label="Newsletter performance"
        headers={['Newsletter', 'Current subscribers', 'New active subscribers', 'Editions published', 'Unique readers']}>
        {publishing.newsletters.map((newsletter) => <tr key={newsletter.id}>
          <th scope="row"><a className="text-link" href={`#publications?newsletter=${newsletter.id}`}>{newsletter.title}</a></th>
          <td>{numberText(newsletter.subscribers)}</td><td>{numberText(newsletter.newSubscribers)}</td>
          <td>{numberText(newsletter.editions)}</td><td>{numberText(newsletter.readers)}</td>
        </tr>)}
      </ReportTable> : <p className="muted">Your newsletters will appear here when you create one.</p>}
    </section>
  </>;
}
