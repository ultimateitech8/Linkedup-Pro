import { ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { appOrigin, db, emailEnabled } from './database.js';
import { savedSalesAccounts, savedSalesLeads } from './sales-search.js';

export const salesStage = z.enum(['Prospect', 'Contacted', 'Qualified', 'Won', 'Lost']);
export const leadUpdate = z.object({
  stage: salesStage, notes: z.string().trim().max(3000).default(''), followUpAt: z.iso.datetime().nullable()
});
export const listName = z.object({ name: z.string().trim().min(1).max(90) });

export async function salesWorkspace(userId: string) {
  const [leads, accounts, { rows: lists }] = await Promise.all([
    savedSalesLeads(userId),
    savedSalesAccounts(userId),
    db.query(`SELECT l.id,l.name,
      ARRAY(SELECT x.lead_id FROM sales_list_leads x JOIN "user" u ON u.id=x.lead_id
        WHERE x.list_id=l.id AND ($2 OR u."emailVerified") ORDER BY x.lead_id) AS "leadIds",
      ARRAY(SELECT x.company_id FROM sales_list_accounts x WHERE x.list_id=l.id ORDER BY x.company_id) AS "accountIds"
      FROM sales_lists l WHERE l.user_id=$1 ORDER BY lower(l.name),l.id`, [userId, !emailEnabled])
  ]);
  return { leads, accounts, lists };
}

export async function setSavedLead(userId: string, leadId: string, active: boolean) {
  if (active) {
    const { rows: [lead] } = await db.query(`WITH target AS (
      SELECT id FROM "user" WHERE id=$2 AND id<>$1 AND ($3 OR "emailVerified")
    ), saved AS (
      INSERT INTO sales_leads(user_id,lead_id) SELECT $1,id FROM target ON CONFLICT DO NOTHING
    ) SELECT id FROM target`, [userId, leadId, !emailEnabled]);
    if (!lead) throw new NotFoundException('This lead is unavailable.');
  } else {
    await db.query('DELETE FROM sales_leads WHERE user_id=$1 AND lead_id=$2', [userId, leadId]);
  }
  return { ok: true };
}

export async function updateSavedLead(userId: string, leadId: string, input: z.output<typeof leadUpdate>) {
  const { rowCount } = await db.query(`UPDATE sales_leads SET stage=$3,notes=$4,
    alerted_at=CASE WHEN follow_up_at IS DISTINCT FROM $5::timestamptz THEN NULL ELSE alerted_at END,
    follow_up_at=$5,updated_at=now() WHERE user_id=$1 AND lead_id=$2`,
  [userId, leadId, input.stage, input.notes, input.followUpAt]);
  if (!rowCount) throw new NotFoundException('Save this lead before editing the follow-up.');
  return { ok: true };
}

export async function setSavedAccount(userId: string, accountId: number, active: boolean) {
  if (active) {
    const { rows: [account] } = await db.query(`WITH target AS (
      SELECT id FROM professional_companies WHERE id=$2
    ), saved AS (
      INSERT INTO sales_accounts(user_id,company_id) SELECT $1,id FROM target ON CONFLICT DO NOTHING
    ) SELECT id FROM target`, [userId, accountId]);
    if (!account) throw new NotFoundException('This company is unavailable.');
  } else {
    await db.query('DELETE FROM sales_accounts WHERE user_id=$1 AND company_id=$2', [userId, accountId]);
  }
  return { ok: true };
}

export async function watchSavedAccount(userId: string, accountId: number, active: boolean) {
  const { rowCount } = await db.query(`UPDATE sales_accounts SET watched_at=CASE WHEN $3 THEN COALESCE(watched_at,now()) END
    WHERE user_id=$1 AND company_id=$2`, [userId, accountId, active]);
  if (!rowCount) throw new NotFoundException('Save this company before enabling alerts.');
  return { ok: true };
}

export async function saveSalesList(userId: string, name: string, id?: number) {
  try {
    const { rows: [list] } = id
      ? await db.query('UPDATE sales_lists SET name=$2 WHERE user_id=$1 AND id=$3 RETURNING id', [userId, name, id])
      : await db.query('INSERT INTO sales_lists(user_id,name) VALUES($1,$2) RETURNING id', [userId, name]);
    if (!list) throw new NotFoundException('This prospect list is unavailable.');
    return list;
  } catch (failure) {
    if (typeof failure === 'object' && failure && 'code' in failure && failure.code === '23505') {
      throw new ConflictException('You already have a list with this name.');
    }
    throw failure;
  }
}

export async function removeSalesList(userId: string, id: number) {
  const { rowCount } = await db.query('DELETE FROM sales_lists WHERE user_id=$1 AND id=$2', [userId, id]);
  if (!rowCount) throw new NotFoundException('This prospect list is unavailable.');
  return { ok: true };
}

// Table and column names come from the two fixed kinds, while all member data uses parameters.
const listKinds = {
  lead: { items: 'sales_list_leads', saved: 'sales_leads', field: 'lead_id' },
  account: { items: 'sales_list_accounts', saved: 'sales_accounts', field: 'company_id' }
};
export async function setSalesListItem(userId: string, listId: number, kind: keyof typeof listKinds, entity: string | number, active: boolean) {
  const { items, saved, field } = listKinds[kind];
  const { rows: [list] } = await db.query(`WITH target AS (
      SELECT id FROM sales_lists WHERE user_id=$1 AND id=$2 FOR KEY SHARE
    ), item AS (
      SELECT ${field} FROM ${saved} WHERE user_id=$1 AND ${field}=$3 FOR KEY SHARE
    ), changed AS (
      ${active ? `INSERT INTO ${items}(list_id,user_id,${field}) SELECT target.id,$1,item.${field}
        FROM target CROSS JOIN item ON CONFLICT DO NOTHING`
        : `DELETE FROM ${items} WHERE list_id=(SELECT id FROM target) AND ${field}=$3`}
    ) SELECT target.id,EXISTS(SELECT 1 FROM item) AS saved FROM target`,
  [userId, listId, entity]);
  if (!list) throw new NotFoundException('This prospect list is unavailable.');
  if (active && !list.saved) throw new NotFoundException('Save this prospect before adding it to a list.');
  return { ok: true };
}

function csvCell(value: unknown) {
  const raw = String(value ?? '');
  const safe = /^\s*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export async function exportSalesCsv(userId: string, listId?: number) {
  const { leads, accounts, lists } = await salesWorkspace(userId);
  const list = listId ? lists.find((entry) => entry.id === listId) : null;
  if (listId && !list) throw new NotFoundException('This prospect list is unavailable.');
  const rows = [
    ['Type', 'Name', 'Company', 'Headline or industry', 'Location', 'Stage', 'Follow-up (UTC)', 'Private notes', 'Company URL'],
    ...leads.filter((lead) => !list || list.leadIds.includes(lead.id)).map((lead) =>
      ['Lead', lead.name, lead.companyName, lead.headline, lead.location, lead.stage,
        lead.followUpAt?.toISOString(), lead.notes, lead.companyId ? `${appOrigin}/#companies?company=${lead.companyId}` : '']),
    ...accounts.filter((account) => !list || list.accountIds.includes(account.id)).map((account) =>
      ['Account', account.name, account.name, account.industry, account.headquarters, '', '', '', `${appOrigin}/#companies?company=${account.id}`])
  ];
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
