import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { db } from './database.js';
import { listGroupPosts } from './posts.js';
import { notifyMember } from './realtime.js';

type Membership = 'none' | 'active' | 'pending' | 'invited';
type GroupRole = 'member' | 'admin' | 'owner';
type GroupInput = { name: string; description: string; industry: string; visibility: 'public' | 'private' };
type GroupSummary = GroupInput & { id: number; membership: Membership; role: GroupRole | null; memberCount: number };
type LockedGroup = Pick<GroupInput, 'name' | 'visibility'> & { ownerId: string; membership: Membership; role: GroupRole | null };
export type MemberDecision = 'invite' | 'approve' | 'decline' | 'promote' | 'demote' | 'transfer' | 'remove';

const membershipFields = `COALESCE(m.membership,'none') AS membership,
  CASE WHEN g.owner_id=$1 THEN 'owner' ELSE m.role END AS role`;
const viewerMembership = 'LEFT JOIN group_members m ON m.group_id=g.id AND m.user_id=$1';
const groupsQuery = `
  SELECT g.id,g.name,g.description,g.industry,g.visibility,${membershipFields},
    (SELECT count(*)::int FROM group_members gm WHERE gm.group_id=g.id AND gm.membership='active') AS "memberCount"
  FROM professional_groups g ${viewerMembership}`;
const memberFields = 'u.id,u.name,u.image,COALESCE(p.headline,\'\') AS headline';
const groupPeople = `FROM group_members m JOIN "user" u ON u.id=m.user_id LEFT JOIN profiles p ON p.user_id=u.id`;

function canManage(group: Pick<LockedGroup, 'membership' | 'role'>) {
  return group.membership === 'active' && (group.role === 'admin' || group.role === 'owner');
}

async function withGroup<T>(member: string, id: number, operation: (client: PoolClient, group: LockedGroup) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const group = (await client.query<LockedGroup>(
      `SELECT g.name,g.visibility,g.owner_id AS "ownerId",${membershipFields}
      FROM professional_groups g ${viewerMembership} WHERE g.id=$2 FOR UPDATE OF g`, [member, id]
    )).rows[0];
    if (!group) throw new NotFoundException('This group is unavailable.');
    const result = await operation(client, group);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listGroups(member: string) {
  return (await db.query<GroupSummary>(
    `${groupsQuery} ORDER BY (m.membership='active') DESC NULLS LAST,g.name,g.id LIMIT 200`, [member]
  )).rows;
}

export async function createGroup(member: string, input: GroupInput) {
  return (await db.query<{ id: number }>(
    `WITH created AS (
      INSERT INTO professional_groups(owner_id,name,description,industry,visibility) VALUES($1,$2,$3,$4,$5) RETURNING id
    ), joined AS (
      INSERT INTO group_members(group_id,user_id,membership) SELECT id,$1,'active' FROM created
    ) SELECT id FROM created`, [member, input.name, input.description, input.industry, input.visibility]
  )).rows[0];
}

export async function viewGroup(member: string, id: number) {
  const group = (await db.query<GroupSummary>(`${groupsQuery} WHERE g.id=$2`, [member, id])).rows[0];
  if (!group) throw new NotFoundException('This group is unavailable.');

  const visible = group.visibility === 'public' || group.membership === 'active';
  const manage = canManage(group);
  const [posts, members, requests, invitees, hidden] = await Promise.all([
    visible ? listGroupPosts(member, id) : null,
    group.membership === 'active' ? db.query(
      `SELECT ${memberFields},CASE WHEN u.id=g.owner_id THEN 'owner' ELSE m.role END AS role
       ${groupPeople} JOIN professional_groups g ON g.id=m.group_id
       WHERE m.group_id=$1 AND m.membership='active'
       ORDER BY (u.id=g.owner_id) DESC,(m.role='admin') DESC,u.name,u.id LIMIT 150`, [id]
    ) : null,
    manage ? db.query(
      `SELECT ${memberFields},m.created_at AS "requestedAt"
       ${groupPeople} WHERE m.group_id=$1 AND m.membership='pending' ORDER BY m.created_at,u.id LIMIT 100`, [id]
    ) : null,
    manage ? db.query(
      `SELECT ${memberFields}
       FROM connections c JOIN "user" u ON u.id=CASE WHEN c.sender=$1 THEN c.recipient ELSE c.sender END
       LEFT JOIN profiles p ON p.user_id=u.id
       WHERE c.accepted AND (c.sender=$1 OR c.recipient=$1) AND NOT EXISTS (
         SELECT 1 FROM group_members target WHERE target.group_id=$2 AND target.user_id=u.id
       ) ORDER BY u.name,u.id LIMIT 100`, [member, id]
    ) : null,
    manage ? db.query(
      `SELECT post.id,post.group_topic AS topic,post.body,u.name AS author FROM posts post JOIN "user" u ON u.id=post.author_id
       WHERE post.group_id=$1 AND post.group_hidden_at IS NOT NULL AND post.hidden_at IS NULL
       ORDER BY post.group_hidden_at DESC LIMIT 100`, [id]
    ) : null
  ]);
  return {
    group, posts: posts?.rows ?? [], members: members?.rows ?? [],
    requests: requests?.rows ?? [], invitees: invitees?.rows ?? [], hidden: hidden?.rows ?? []
  };
}

export async function changeMembership(member: { id: string; name: string }, id: number, action: 'join' | 'leave') {
  const recipients = await withGroup(member.id, id, async (client, group) => {
    if (action === 'leave') {
      if (group.ownerId === member.id) throw new ConflictException('Transfer ownership before leaving this group.');
      await client.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [id, member.id]);
      return [];
    }
    if (group.membership === 'active' || group.membership === 'pending') return [];
    const status = group.visibility === 'public' || group.membership === 'invited' ? 'active' : 'pending';
    await client.query(
      `INSERT INTO group_members(group_id,user_id,membership) VALUES($1,$2,$3)
       ON CONFLICT(group_id,user_id) DO UPDATE SET membership=EXCLUDED.membership,created_at=now()`, [id, member.id, status]
    );
    if (status === 'active') return [];
    const notices = await client.query<{ user_id: string }>(
      `INSERT INTO notifications(user_id,message,category)
       SELECT user_id,$4,'Groups' FROM group_members WHERE group_id=$1 AND membership='active' AND user_id<>$2
         AND (role='admin' OR user_id=$3) RETURNING user_id`,
      [id, member.id, group.ownerId, `${member.name} requested to join ${group.name}.`]
    );
    return notices.rows.map((notice) => notice.user_id);
  });
  recipients.forEach(notifyMember);
}

export async function reviewMember(member: { id: string; name: string }, id: number, target: string, action: MemberDecision) {
  if (target === member.id) throw new BadRequestException('Choose another member of the group.');
  await withGroup(member.id, id, async (client, group) => {
    if (!canManage(group)) throw new ForbiddenException('Group admin access is required.');
    const entry = (await client.query<{ membership: Membership; role: GroupRole }>(
      'SELECT membership,role FROM group_members WHERE group_id=$1 AND user_id=$2', [id, target]
    )).rows[0];

    if (action === 'invite') {
      if (entry) throw new ConflictException('This person already has a membership, request, or invitation.');
      const invited = await client.query(
        `INSERT INTO group_members(group_id,user_id,membership)
         SELECT $1,$3,'invited' FROM connections WHERE accepted
           AND ((sender=$2 AND recipient=$3) OR (sender=$3 AND recipient=$2))`, [id, member.id, target]
      );
      if (!invited.rowCount) throw new BadRequestException('Choose one of your accepted connections.');
      await client.query("INSERT INTO notifications(user_id,message,category) VALUES($1,$2,'Groups')",
        [target, `${member.name} invited you to ${group.name}.`]);
      return;
    }

    if (action === 'approve' || action === 'decline') {
      if (entry?.membership !== 'pending') throw new ConflictException('This membership request is no longer pending.');
      if (action === 'approve') {
        await client.query("UPDATE group_members SET membership='active' WHERE group_id=$1 AND user_id=$2", [id, target]);
      } else {
        await client.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [id, target]);
      }
      const message = action === 'approve' ? `Your request to join ${group.name} was approved.` :
        `Your request to join ${group.name} was declined.`;
      await client.query("INSERT INTO notifications(user_id,message,category) VALUES($1,$2,'Groups')", [target, message]);
      return;
    }

    if (entry?.membership !== 'active') throw new NotFoundException('This member is no longer in the group.');
    if (target === group.ownerId) throw new ForbiddenException('Group ownership can only be changed by the owner.');
    if (action === 'remove') {
      if (entry.role === 'admin' && group.role !== 'owner') throw new ForbiddenException('Only the owner can remove an admin.');
      await client.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [id, target]);
      await client.query("INSERT INTO notifications(user_id,message,category) VALUES($1,$2,'Groups')",
        [target, `You were removed from ${group.name}.`]);
      return;
    }

    if (group.role !== 'owner') throw new ForbiddenException('Only the owner can change group roles.');
    if (action === 'transfer') {
      await client.query('UPDATE professional_groups SET owner_id=$2 WHERE id=$1', [id, target]);
      await client.query("UPDATE group_members SET role='admin' WHERE group_id=$1 AND user_id=$2", [id, member.id]);
      await client.query("INSERT INTO notifications(user_id,message,category) VALUES($1,$2,'Groups')",
        [target, `${member.name} transferred ownership of ${group.name} to you.`]);
      return;
    }
    await client.query('UPDATE group_members SET role=$3 WHERE group_id=$1 AND user_id=$2',
      [id, target, action === 'promote' ? 'admin' : 'member']);
    const message = action === 'promote' ? `You’re now an admin of ${group.name}.` : `Your role in ${group.name} changed to member.`;
    await client.query("INSERT INTO notifications(user_id,message,category) VALUES($1,$2,'Groups')", [target, message]);
  });
  notifyMember(target);
}

export async function startDiscussion(member: string, id: number, topic: string, body: string) {
  return withGroup(member, id, async (client, group) => {
    if (group.membership !== 'active') throw new ForbiddenException('Join this group to start a discussion.');
    return (await client.query<{ id: number }>(
      'INSERT INTO posts(author_id,group_id,group_topic,body) VALUES($1,$2,$3,$4) RETURNING id', [member, id, topic, body]
    )).rows[0];
  });
}

export async function moderateDiscussion(member: string, id: number, post: number, action: 'hide' | 'restore') {
  await withGroup(member, id, async (client, group) => {
    if (!canManage(group)) throw new ForbiddenException('Group admin access is required.');
    const result = await client.query(
      `UPDATE posts SET group_hidden_at=CASE WHEN $3 THEN now() ELSE NULL END
       WHERE id=$1 AND group_id=$2 AND hidden_at IS NULL AND (group_hidden_at IS NULL)=$3`, [post, id, action === 'hide']
    );
    if (!result.rowCount) throw new NotFoundException('This discussion is unavailable.');
  });
}
