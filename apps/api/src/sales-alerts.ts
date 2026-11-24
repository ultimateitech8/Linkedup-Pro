import { db } from './database.js';
import { notifyMember } from './realtime.js';

async function sendFollowUpAlerts() {
  return (await db.query<{ user_id: string }>(`WITH due AS (
    SELECT s.user_id,s.lead_id,u.name FROM sales_leads s JOIN "user" u ON u.id=s.lead_id
    WHERE s.follow_up_at<=now() AND s.alerted_at IS NULL ORDER BY s.follow_up_at LIMIT 250 FOR UPDATE OF s SKIP LOCKED
  ), marked AS (
    UPDATE sales_leads s SET alerted_at=now() FROM due WHERE s.user_id=due.user_id AND s.lead_id=due.lead_id
    RETURNING s.user_id,due.name
  ) INSERT INTO notifications(user_id,category,message)
    SELECT user_id,'Sales','Follow up with ' || name || '.' FROM marked RETURNING user_id`)).rows;
}

async function sendWatchedJobAlerts() {
  return (await db.query<{ user_id: string }>(`WITH eligible AS (
    SELECT a.user_id,j.id AS job_id,c.id AS company_id,c.name,j.title
    FROM sales_accounts a JOIN jobs j ON j.company_id=a.company_id
    JOIN professional_companies c ON c.id=a.company_id
    WHERE j.created_at>=a.watched_at AND j.owner_id<>a.user_id AND NOT j.closed
      AND NOT EXISTS (SELECT 1 FROM sales_job_alerts sent WHERE sent.user_id=a.user_id AND sent.job_id=j.id)
    ORDER BY j.created_at,j.id,a.user_id LIMIT 250 FOR SHARE OF a,j SKIP LOCKED
  ), sent AS (
    INSERT INTO sales_job_alerts(user_id,job_id) SELECT user_id,job_id FROM eligible
    ON CONFLICT DO NOTHING RETURNING user_id,job_id
  ) INSERT INTO notifications(user_id,category,message,company_id)
    SELECT eligible.user_id,'Sales',eligible.name || ' posted a new job: ' || eligible.title || '.',eligible.company_id
    FROM sent JOIN eligible USING (user_id,job_id) RETURNING user_id`)).rows;
}

export function startSalesAlerts() {
  let processing = false;
  async function tick() {
    if (processing) return;
    processing = true;
    try {
      const recipients = new Set<string>();
      const results = await Promise.allSettled([sendFollowUpAlerts(), sendWatchedJobAlerts()]);
      for (const result of results) {
        if (result.status === 'fulfilled') result.value.forEach((entry) => recipients.add(entry.user_id));
        else console.error('Sales alert delivery failed', result.reason);
      }
      recipients.forEach(notifyMember);
    } finally {
      processing = false;
    }
  }
  void tick();
  setInterval(() => void tick(), 30000).unref();
}
