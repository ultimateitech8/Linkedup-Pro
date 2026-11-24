import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { positiveId } from './access.js';
import { db } from './database.js';
import { notifyMember } from './realtime.js';

const text = (max: number) => z.string().trim().min(1).max(max);
export const newRequestInput = z.object({
  key: z.uuid(), offeringId: positiveId.optional(), kind: z.enum(['inquiry', 'proposal']),
  title: text(110), brief: text(2500), budget: z.string().trim().max(100).default('')
});
export const quoteInput = z.object({
  amount: z.number().int().min(1).max(100_000_000),
  currency: z.enum(['USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD']),
  scope: text(2200), delivery: z.iso.date()
});
export const messageInput = z.object({ body: text(2000) });
export const reviewInput = z.object({ rating: z.number().int().min(1).max(5), body: text(800) });
export const decisionInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), version: positiveId }),
  z.object({ action: z.enum(['decline', 'cancel', 'deliver', 'complete']) })
]);

type Actor = { id: string; name: string };
type Status = 'requested' | 'quoted' | 'accepted' | 'delivered' | 'completed' | 'declined' | 'cancelled';
type Locked = { clientId: string; ownerId: string; status: Status; quoteVersion: number };
const states: Record<z.output<typeof decisionInput>['action'], {
  role: 'client' | 'provider'; from: Status[]; to: Status; activity: string;
}> = {
  accept: { role: 'client', from: ['quoted'], to: 'accepted', activity: 'accepted the proposal.' },
  decline: { role: 'provider', from: ['requested', 'quoted'], to: 'declined', activity: 'declined the request.' },
  cancel: { role: 'client', from: ['requested', 'quoted'], to: 'cancelled', activity: 'cancelled the request.' },
  deliver: { role: 'provider', from: ['accepted'], to: 'delivered', activity: 'marked the work as delivered.' },
  complete: { role: 'client', from: ['delivered'], to: 'completed', activity: 'confirmed the work was completed.' }
};

async function transaction<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (failure) {
    await client.query('ROLLBACK');
    throw failure;
  } finally {
    client.release();
  }
}

const visibility = '(r.client_id=$1 OR p.owner_id=$1)';
const requestSource = `FROM service_requests r JOIN service_providers p ON p.id=r.provider_id
  JOIN "user" buyer ON buyer.id=r.client_id JOIN "user" seller ON seller.id=p.owner_id`;
const requestFields = `r.id,r.title,r.kind,r.status,r.offering_title AS "offeringTitle",r.updated_at AS "updatedAt",
  CASE WHEN p.owner_id=$1 THEN 'provider' ELSE 'client' END AS role,
  CASE WHEN p.owner_id=$1 THEN buyer.name ELSE seller.name END AS "otherName",
  CASE WHEN p.owner_id=$1 THEN buyer.image ELSE seller.image END AS "otherImage"`;

export async function listServiceRequests(memberId: string) {
  const { rows } = await db.query(`SELECT ${requestFields} ${requestSource}
    WHERE ${visibility} ORDER BY r.updated_at DESC,r.id DESC`, [memberId]);
  return rows;
}

export async function serviceRequestDetail(memberId: string, id: number) {
  const { rows: [request] } = await db.query(`SELECT ${requestFields},r.brief,r.budget,r.provider_id AS "providerId",
    CASE WHEN r.quote_version>0 THEN json_build_object('amount',r.quote_amount,'currency',r.quote_currency,'scope',r.quote_scope,
      'delivery',r.quote_delivery,'version',r.quote_version) END AS quote,
    (SELECT json_build_object('rating',rating,'body',body) FROM service_reviews WHERE request_id=r.id) AS review
    ${requestSource} WHERE r.id=$2 AND ${visibility}`, [memberId, id]);
  if (!request) throw new NotFoundException('This service request is unavailable.');
  const { rows: messages } = await db.query(`SELECT m.id,m.kind,m.body,m.sender_id=$1 AS mine,u.name,m.created_at AS "createdAt"
    FROM service_request_messages m JOIN "user" u ON u.id=m.sender_id WHERE m.request_id=$2 ORDER BY m.id`, [memberId, id]);
  return { ...request, messages };
}

async function lockedRequest(client: PoolClient, memberId: string, id: number) {
  const { rows: [request] } = await client.query<Locked>(`SELECT r.client_id AS "clientId",p.owner_id AS "ownerId",
    r.status,r.quote_version AS "quoteVersion" FROM service_requests r JOIN service_providers p ON p.id=r.provider_id
    WHERE r.id=$2 AND ${visibility} FOR UPDATE OF r`, [memberId, id]);
  if (!request) throw new NotFoundException('This service request is unavailable.');
  return request;
}

async function logMessage(client: PoolClient, id: number, sender: string, kind: 'message' | 'activity', body: string) {
  await client.query('INSERT INTO service_request_messages(request_id,sender_id,kind,body) VALUES($1,$2,$3,$4)', [id, sender, kind, body]);
}

async function sendNotice(client: PoolClient, id: number, recipient: string, message: string) {
  await client.query(`INSERT INTO notifications(user_id,category,message,service_request_id) VALUES($1,'Services',$2,$3)`, [recipient, message, id]);
}

export async function createServiceRequest(user: Actor, providerId: number, input: z.output<typeof newRequestInput>) {
  const result = await transaction(async (client) => {
    const existing = async () => (await client.query<{ id: number }>(
      'SELECT id FROM service_requests WHERE client_id=$1 AND client_key=$2', [user.id, input.key])).rows[0];
    const previous = await existing();
    if (previous) return previous;
    const { rows: [provider] } = await client.query<{ owner_id: string }>(
      'SELECT owner_id FROM service_providers WHERE id=$1 AND accepting FOR SHARE', [providerId]);
    if (!provider) throw new NotFoundException('This provider is unavailable for new requests.');
    if (provider.owner_id === user.id) throw new BadRequestException('Choose another provider for your request.');
    let offeringTitle: string | null = null;
    if (input.offeringId) {
      const { rows: [offering] } = await client.query<{ title: string }>(
        'SELECT title FROM service_offerings WHERE id=$1 AND provider_id=$2 AND active FOR SHARE', [input.offeringId, providerId]);
      if (!offering) throw new NotFoundException('This service listing is unavailable.');
      offeringTitle = offering.title;
    } else {
      const { rowCount } = await client.query(`SELECT id FROM service_offerings WHERE provider_id=$1 AND active ORDER BY id LIMIT 1 FOR SHARE`, [providerId]);
      if (!rowCount) throw new NotFoundException('This provider has no active service listings.');
    }
    const { rows: [request] } = await client.query<{ id: number }>(`INSERT INTO service_requests
      (provider_id,client_id,client_key,offering_id,offering_title,kind,title,brief,budget) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(client_id,client_key) DO NOTHING RETURNING id`,
    [providerId, user.id, input.key, input.offeringId ?? null, offeringTitle, input.kind, input.title, input.brief, input.budget]);
    if (!request) {
      const duplicate = await existing();
      if (!duplicate) throw new ConflictException('This request could not be saved. Try again.');
      return duplicate;
    }
    await sendNotice(client, request.id, provider.owner_id,
      `${user.name} sent a ${input.kind === 'proposal' ? 'proposal request' : 'service inquiry'}.`);
    return { id: request.id, recipient: provider.owner_id };
  });
  if ('recipient' in result && result.recipient) notifyMember(result.recipient);
  return { id: result.id };
}

export async function quoteService(user: Actor, id: number, input: z.output<typeof quoteInput>) {
  const recipient = await transaction(async (client) => {
    const request = await lockedRequest(client, user.id, id);
    if (request.ownerId !== user.id) throw new ForbiddenException('The provider sends the proposal.');
    if (request.status !== 'requested' && request.status !== 'quoted') throw new ConflictException('This request is closed to new proposals.');
    const { rowCount } = await client.query(`UPDATE service_requests SET status='quoted',quote_amount=$2,quote_currency=$3,
      quote_scope=$4,quote_delivery=$5,quote_version=quote_version+1,updated_at=now()
      WHERE id=$1 AND (quote_amount,quote_currency,quote_scope,quote_delivery) IS DISTINCT FROM ($2::int,$3::text,$4::text,$5::date)`,
    [id, input.amount, input.currency, input.scope, input.delivery]);
    if (!rowCount) return;
    const activity = request.status === 'quoted' ? 'revised the proposal.' : 'sent a proposal.';
    await logMessage(client, id, user.id, 'activity', activity);
    await sendNotice(client, id, request.clientId, `${user.name} ${activity}`);
    return request.clientId;
  });
  if (recipient) notifyMember(recipient);
  return { ok: true };
}

export async function decideService(user: Actor, id: number, input: z.output<typeof decisionInput>) {
  const recipient = await transaction(async (client) => {
    const request = await lockedRequest(client, user.id, id);
    const role = request.clientId === user.id ? 'client' : 'provider';
    const change = states[input.action];
    if (role !== change.role) throw new ForbiddenException('This action is available to the other participant.');
    if (input.action === 'accept' && input.version !== request.quoteVersion) {
      throw new ConflictException('The provider revised this proposal. Review the latest terms before accepting.');
    }
    if (request.status === change.to) return;
    if (!change.from.includes(request.status)) throw new ConflictException('This request changed. Refresh it and try again.');
    await client.query('UPDATE service_requests SET status=$2,updated_at=now() WHERE id=$1', [id, change.to]);
    await logMessage(client, id, user.id, 'activity', change.activity);
    const other = role === 'client' ? request.ownerId : request.clientId;
    await sendNotice(client, id, other, `${user.name} ${change.activity}`);
    return other;
  });
  if (recipient) notifyMember(recipient);
  return { ok: true };
}

export async function messageService(user: Actor, id: number, body: string) {
  const recipient = await transaction(async (client) => {
    const request = await lockedRequest(client, user.id, id);
    if (['completed', 'declined', 'cancelled'].includes(request.status)) throw new ConflictException('This conversation is closed.');
    await client.query('UPDATE service_requests SET updated_at=now() WHERE id=$1', [id]);
    await logMessage(client, id, user.id, 'message', body);
    const other = request.clientId === user.id ? request.ownerId : request.clientId;
    await sendNotice(client, id, other, `${user.name} sent a message about your service request.`);
    return other;
  });
  notifyMember(recipient);
  return { ok: true };
}

export async function reviewService(user: Actor, id: number, input: z.output<typeof reviewInput>) {
  const recipient = await transaction(async (client) => {
    const request = await lockedRequest(client, user.id, id);
    if (request.clientId !== user.id) throw new ForbiddenException('The client can review the finished work.');
    if (request.status !== 'completed') throw new ConflictException('Confirm completion before reviewing this provider.');
    const { rowCount } = await client.query(`INSERT INTO service_reviews(request_id,rating,body) VALUES($1,$2,$3)
      ON CONFLICT(request_id) DO NOTHING`, [id, input.rating, input.body]);
    if (!rowCount) throw new ConflictException('You already reviewed this request.');
    await sendNotice(client, id, request.ownerId, `${user.name} left a review for your service.`);
    return request.ownerId;
  });
  notifyMember(recipient);
  return { ok: true };
}
