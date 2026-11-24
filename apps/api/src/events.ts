import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { db } from './database.js';
import { listEventPosts } from './posts.js';
import { notifyMember } from './realtime.js';

export type EventInput = {
  title: string; description: string; category: 'Meetup' | 'Webinar' | 'Conference';
  format: 'online' | 'in-person'; startsAt: string; endsAt: string; venue?: string; meetingUrl?: string;
};
type LockedEvent = {
  hostId: string; title: string; format: EventInput['format']; startsAt: Date; endsAt: Date;
  venue: string | null; meetingUrl: string | null; cancelled: boolean; canCheckIn: boolean;
  liveStarted: boolean; liveEnded: boolean; status: 'none' | 'invited' | 'registered' | 'declined'; checkedInAt: Date | null;
};
type EventSummary = {
  id: number; title: string; description: string; category: EventInput['category']; format: EventInput['format'];
  startsAt: Date; endsAt: Date; venue: string | null; isHost: boolean; cancelled: boolean; ended: boolean; live: boolean;
  registration: LockedEvent['status']; checkedInAt: Date | null; registeredCount: number;
  host: { id: string; name: string; image: string | null; headline: string };
};
type EventDetails = EventSummary & {
  hostLink: string | null; canCheckIn: boolean; canStartLive: boolean; canEndLive: boolean; canEdit: boolean;
  invitedCount: number; checkedInCount: number;
};

const canCheckIn = `(e.cancelled_at IS NULL AND e.ends_at>now()
  AND (e.starts_at<=now() + interval '15 minutes' OR e.live_started_at IS NOT NULL)
  AND e.live_ended_at IS NULL)`;

const eventSummary = `
  SELECT e.id,e.title,e.description,e.category,e.format,e.starts_at AS "startsAt",e.ends_at AS "endsAt",e.venue,
    e.host_id=$1 AS "isHost",e.cancelled_at IS NOT NULL AS cancelled,(e.ends_at<=now() OR e.live_ended_at IS NOT NULL) AS ended,
    (e.cancelled_at IS NULL AND e.live_started_at IS NOT NULL AND e.live_ended_at IS NULL AND e.ends_at>now()) AS live,
    COALESCE(a.status,'none') AS registration,a.checked_in_at AS "checkedInAt",
    (SELECT count(*)::int FROM event_attendees r WHERE r.event_id=e.id AND r.status='registered') AS "registeredCount",
    json_build_object('id',u.id,'name',u.name,'image',u.image,'headline',COALESCE(p.headline,'')) AS host
  FROM professional_events e JOIN "user" u ON u.id=e.host_id LEFT JOIN profiles p ON p.user_id=u.id
  LEFT JOIN event_attendees a ON a.event_id=e.id AND a.user_id=$1
`;

function validateSchedule(input: EventInput) {
  const start = new Date(input.startsAt).getTime();
  const end = new Date(input.endsAt).getTime();
  if (start <= Date.now()) throw new BadRequestException('Choose a start date and time in the future.');
  if (end <= start) throw new BadRequestException('The end time must come after the start time.');
  if (input.format === 'online' && !input.meetingUrl) throw new BadRequestException('Add a secure meeting or livestream link.');
  if (input.format === 'in-person' && !input.venue) throw new BadRequestException('Enter the venue or address.');
}

function values(input: EventInput) {
  return [input.title, input.description, input.category, input.format, input.startsAt, input.endsAt,
    input.format === 'in-person' ? input.venue : null, input.format === 'online' ? input.meetingUrl : null];
}

async function withEvent<T>(viewer: string, id: number, operation: (client: PoolClient, event: LockedEvent) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const event = (await client.query<LockedEvent>(
      `SELECT e.host_id AS "hostId",e.title,e.format,e.starts_at AS "startsAt",e.ends_at AS "endsAt",e.venue,e.meeting_url AS "meetingUrl",
        e.cancelled_at IS NOT NULL AS cancelled, e.live_started_at IS NOT NULL AS "liveStarted",
        e.live_ended_at IS NOT NULL AS "liveEnded",${canCheckIn} AS "canCheckIn",
        COALESCE(a.status,'none') AS status,a.checked_in_at AS "checkedInAt"
       FROM professional_events e LEFT JOIN event_attendees a ON a.event_id=e.id AND a.user_id=$1
       WHERE e.id=$2 FOR UPDATE OF e`, [viewer, id]
    )).rows[0];
    if (!event) throw new NotFoundException('This event is unavailable.');
    const result = await operation(client, event);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function requireHost(member: string, event: LockedEvent) {
  if (event.hostId !== member) throw new ForbiddenException('Only the host can manage this event.');
}

export async function listEvents(member: string) {
  return (await db.query<EventSummary>(
    `${eventSummary} WHERE (e.cancelled_at IS NULL AND e.ends_at>now() AND e.live_ended_at IS NULL)
      OR e.host_id=$1 OR a.status='registered'
    ORDER BY (e.ends_at<=now() OR e.cancelled_at IS NOT NULL OR e.live_ended_at IS NOT NULL), e.starts_at,e.id LIMIT 200`, [member]
  )).rows;
}

export async function createEvent(member: string, input: EventInput) {
  validateSchedule(input);
  return (await db.query<{ id: number }>(
    `INSERT INTO professional_events(host_id,title,description,category,format,starts_at,ends_at,venue,meeting_url)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [member, ...values(input)]
  )).rows[0];
}

export async function viewEvent(member: string, id: number) {
  const event = (await db.query<EventDetails>(
    `SELECT summary.*, e.meeting_url AS "hostLink", ${canCheckIn} AS "canCheckIn",
      (e.format='online' AND e.cancelled_at IS NULL AND e.live_started_at IS NULL AND e.ends_at>now()
        AND e.starts_at<=now() + interval '30 minutes') AS "canStartLive",
      (e.cancelled_at IS NULL AND e.live_started_at IS NOT NULL AND e.live_ended_at IS NULL) AS "canEndLive",
      (e.cancelled_at IS NULL AND e.live_started_at IS NULL AND e.starts_at>now()) AS "canEdit",
      (SELECT count(*)::int FROM event_attendees a WHERE a.event_id=e.id AND a.status='invited') AS "invitedCount",
      (SELECT count(*)::int FROM event_attendees a WHERE a.event_id=e.id AND a.checked_in_at IS NOT NULL) AS "checkedInCount"
     FROM (${eventSummary} WHERE e.id=$2) summary JOIN professional_events e ON e.id=summary.id`, [member, id]
  )).rows[0];
  if (!event) throw new NotFoundException('This event is unavailable.');
  const registered = event.registration === 'registered';
  const allowed = event.isHost || registered;
  const { hostLink, canCheckIn: inWindow, invitedCount, checkedInCount, ...publicEvent } = event;
  const [posts, attendees, invitees, hidden] = await Promise.all([
    allowed ? listEventPosts(member, id) : null,
    allowed ? db.query(
      `SELECT u.id,u.name,u.image,COALESCE(p.headline,'') AS headline,
        CASE WHEN $2 THEN a.checked_in_at END AS "checkedInAt"
       FROM event_attendees a JOIN "user" u ON u.id=a.user_id LEFT JOIN profiles p ON p.user_id=u.id
       WHERE a.event_id=$1 AND a.status='registered' ORDER BY u.name,u.id LIMIT 150`, [id, event.isHost]
    ) : null,
    event.isHost ? db.query(
      `SELECT u.id,u.name FROM connections c JOIN "user" u ON u.id=CASE WHEN c.sender=$1 THEN c.recipient ELSE c.sender END
       WHERE c.accepted AND (c.sender=$1 OR c.recipient=$1) AND NOT EXISTS (
         SELECT 1 FROM event_attendees a WHERE a.event_id=$2 AND a.user_id=u.id
       ) ORDER BY u.name,u.id LIMIT 100`, [member, id]
    ) : null,
    event.isHost ? db.query(
      `SELECT post.id,post.event_topic AS topic,post.body,u.name AS author FROM posts post JOIN "user" u ON u.id=post.author_id
       WHERE post.event_id=$1 AND post.event_hidden_at IS NOT NULL AND post.hidden_at IS NULL
       ORDER BY post.event_hidden_at DESC LIMIT 100`, [id]
    ) : null
  ]);
  return {
    event: publicEvent,
    meetingUrl: !event.cancelled && (event.isHost || (registered && inWindow)) ? hostLink : null,
    canCheckIn: registered && inWindow,
    analytics: event.isHost ? { invitedCount, checkedInCount, registeredCount: event.registeredCount } : null,
    posts: posts?.rows ?? [], attendees: attendees?.rows ?? [], invitees: invitees?.rows ?? [], hidden: hidden?.rows ?? []
  };
}

async function notifyAttendees(client: PoolClient, id: number, message: string) {
  const notices = await client.query<{ user_id: string }>(
    `INSERT INTO notifications(user_id,message,category)
     SELECT user_id,$2,'Events' FROM event_attendees WHERE event_id=$1 AND status IN ('registered','invited')
     RETURNING user_id`, [id, message]
  );
  return notices.rows.map((notice) => notice.user_id);
}

export async function editEvent(member: string, id: number, input: EventInput) {
  validateSchedule(input);
  const recipients = await withEvent(member, id, async (client, event) => {
    requireHost(member, event);
    if (event.cancelled || event.liveStarted || event.startsAt.getTime() <= Date.now()) {
      throw new ConflictException('Event details can be edited before the event starts.');
    }
    await client.query(
      `UPDATE professional_events SET title=$2,description=$3,category=$4,format=$5,starts_at=$6,ends_at=$7,venue=$8,meeting_url=$9
       WHERE id=$1`, [id, ...values(input)]
    );
    const startChanged = event.startsAt.getTime() !== new Date(input.startsAt).getTime();
    if (startChanged) await client.query('UPDATE event_attendees SET reminded_at=NULL WHERE event_id=$1', [id]);
    const logisticsChanged = startChanged || event.endsAt.getTime() !== new Date(input.endsAt).getTime() ||
      event.format !== input.format || event.venue !== (input.format === 'in-person' ? input.venue : null) ||
      event.meetingUrl !== (input.format === 'online' ? input.meetingUrl : null);
    return logisticsChanged ? notifyAttendees(client, id, `The time or location of ${input.title} was updated.`) : [];
  });
  recipients.forEach(notifyMember);
}

export async function changeAttendance(member: string, id: number, action: 'register' | 'withdraw' | 'decline' | 'check-in') {
  await withEvent(member, id, async (client, event) => {
    if (event.hostId === member) throw new BadRequestException('You host this event.');
    if (event.cancelled || event.liveEnded || event.endsAt.getTime() <= Date.now()) throw new ConflictException('This event is closed.');
    if (action === 'register') {
      if (event.status !== 'registered') await client.query(
        `INSERT INTO event_attendees(event_id,user_id,status) VALUES($1,$2,'registered')
         ON CONFLICT(event_id,user_id) DO UPDATE SET status='registered',updated_at=now()`, [id, member]
      );
      return;
    }
    if (action === 'decline') {
      await client.query("UPDATE event_attendees SET status='declined',updated_at=now() WHERE event_id=$1 AND user_id=$2 AND status='invited'",
        [id, member]);
      return;
    }
    if (event.status !== 'registered') throw new ForbiddenException('Register for this event first.');
    if (action === 'check-in') {
      if (!event.canCheckIn) throw new ConflictException('Check-in is available around the event start.');
      await client.query('UPDATE event_attendees SET checked_in_at=COALESCE(checked_in_at,now()) WHERE event_id=$1 AND user_id=$2', [id, member]);
      return;
    }
    if (event.checkedInAt) throw new ConflictException('This registration has already been checked in.');
    await client.query('DELETE FROM event_attendees WHERE event_id=$1 AND user_id=$2', [id, member]);
  });
}

export async function inviteToEvent(member: { id: string; name: string }, id: number, target: string) {
  await withEvent(member.id, id, async (client, event) => {
    requireHost(member.id, event);
    if (event.cancelled || event.liveEnded || event.endsAt.getTime() <= Date.now()) throw new ConflictException('This event is closed.');
    const result = await client.query(
      `INSERT INTO event_attendees(event_id,user_id,status)
       SELECT $1,$3,'invited' FROM connections WHERE accepted AND ((sender=$2 AND recipient=$3) OR (sender=$3 AND recipient=$2))
       ON CONFLICT DO NOTHING`, [id, member.id, target]
    );
    if (!result.rowCount) throw new BadRequestException('Choose a connection with no invitation or registration for this event.');
    await client.query("INSERT INTO notifications(user_id,message,category) VALUES($1,$2,'Events')",
      [target, `${member.name} invited you to ${event.title}.`]);
  });
  notifyMember(target);
}

export async function hostEvent(member: string, id: number, action: 'cancel' | 'start-live' | 'end-live') {
  const recipients = await withEvent(member, id, async (client, event) => {
    requireHost(member, event);
    if (event.cancelled) return [];
    if (action === 'cancel') {
      if (event.liveEnded || event.endsAt.getTime() <= Date.now()) throw new ConflictException('This event has ended.');
      await client.query('UPDATE professional_events SET cancelled_at=now() WHERE id=$1', [id]);
      return notifyAttendees(client, id, `${event.title} was cancelled.`);
    }
    if (event.format !== 'online') throw new BadRequestException('Live sessions are available for online events.');
    if (action === 'start-live') {
      if (event.liveStarted) throw new ConflictException('The session has already started.');
      if (event.endsAt.getTime() <= Date.now() || event.startsAt.getTime() > Date.now() + 30 * 60_000) {
        throw new ConflictException('Start the live session within 30 minutes of the scheduled start.');
      }
      await client.query('UPDATE professional_events SET live_started_at=now() WHERE id=$1', [id]);
      return notifyAttendees(client, id, `${event.title} is live.`);
    }
    if (!event.liveStarted || event.liveEnded) throw new ConflictException('There is no live session to end.');
    await client.query('UPDATE professional_events SET live_ended_at=now() WHERE id=$1', [id]);
    return [];
  });
  recipients.forEach(notifyMember);
}

export async function startEventDiscussion(member: string, id: number, topic: string, body: string) {
  return withEvent(member, id, async (client, event) => {
    if (event.cancelled) throw new ConflictException('This event was cancelled.');
    if (event.status !== 'registered' && event.hostId !== member) throw new ForbiddenException('Register to join the discussion.');
    return (await client.query<{ id: number }>(
      'INSERT INTO posts(author_id,event_id,event_topic,body) VALUES($1,$2,$3,$4) RETURNING id', [member, id, topic, body]
    )).rows[0];
  });
}

export async function moderateEventDiscussion(member: string, id: number, post: number, action: 'hide' | 'restore') {
  await withEvent(member, id, async (client, event) => {
    requireHost(member, event);
    const result = await client.query(
      `UPDATE posts SET event_hidden_at=CASE WHEN $3 THEN now() ELSE NULL END
       WHERE id=$1 AND event_id=$2 AND hidden_at IS NULL AND (event_hidden_at IS NULL)=$3`, [post, id, action === 'hide']
    );
    if (!result.rowCount) throw new NotFoundException('This discussion is unavailable.');
  });
}

export async function sendEventReminders() {
  const notices = await db.query<{ user_id: string }>(`
    WITH due AS (
      SELECT a.event_id,a.user_id,e.title
      FROM event_attendees a JOIN professional_events e ON e.id=a.event_id
      WHERE a.status='registered' AND a.reminded_at IS NULL AND e.cancelled_at IS NULL
        AND e.live_started_at IS NULL AND e.starts_at>now() AND e.starts_at<=now() + interval '1 hour'
      ORDER BY e.starts_at,a.event_id,a.user_id LIMIT 100 FOR UPDATE OF e SKIP LOCKED
    ), sent AS (
      UPDATE event_attendees a SET reminded_at=now() FROM due
      WHERE a.event_id=due.event_id AND a.user_id=due.user_id AND a.status='registered' AND a.reminded_at IS NULL
      RETURNING a.user_id,due.title
    ) INSERT INTO notifications(user_id,message,category)
      SELECT user_id,title || ' starts within the next hour.','Events' FROM sent RETURNING user_id
  `);
  notices.rows.forEach((notice) => notifyMember(notice.user_id));
}

export function startEventReminders() {
  const deliver = () => void sendEventReminders().catch((error: unknown) => {
    console.error('Event reminder delivery failed.', error instanceof Error ? error.message : '');
  });
  deliver();
  setInterval(deliver, 30_000).unref();
}
