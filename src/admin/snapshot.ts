import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { asJson } from '../db/pool';
import { Tenants, ident, tbl } from '../db/tenants';
import type { Knowledge, KbEntry, MerchantCfg, WordMap, Lang } from '../engine/types';

import type { Snapshot, SnapEntry, SnapSettings, Words, MerchantMeta } from './snapshotTypes';
export type { Snapshot, SnapEntry, SnapSettings, Words, MerchantMeta } from './snapshotTypes';

const TOOLS = ['deposit_status', 'withdraw_status', 'balance', 'transactions', 'points'];
const rows = async <T extends RowDataPacket = RowDataPacket>(c: Pool | PoolConnection, sql: string, p: unknown[] = []) => (await c.query<T[]>(sql, p))[0];

function group(list: RowDataPacket[], k: string, v: string): Words {
  const out: Words = {};
  for (const r of list) ((out[r[k]] ??= {})[r.language] ??= []).push(r[v]);
  return out;
}

export async function readMerchants(pool: Pool): Promise<MerchantMeta[]> {
  return (await rows(pool, "SELECT code, name, default_language, livechat_group_id FROM merchants WHERE status = 'active' ORDER BY id")) as unknown as MerchantMeta[];
}

/** Reads the whole editable knowledge base, drafts included: every merchant from its own database, the shared word lists from the main one. */
export async function readSnapshot(pool: Pool): Promise<Snapshot> {
  const tenants = await new Tenants(pool).list();
  const [merchants, aliases, aspects, small, guard, fillers] = await Promise.all([
    rows(pool, "SELECT code, handoff_group_id FROM merchants WHERE status = 'active' ORDER BY id"),
    rows(pool, 'SELECT language, variant, canonical FROM shared_aliases ORDER BY id'),
    rows(pool, 'SELECT kind, language, keyword FROM aspects ORDER BY id'),
    rows(pool, 'SELECT kind, language, phrase FROM shared_smalltalk ORDER BY id'),
    rows(pool, 'SELECT kind, language, phrase FROM shared_guard ORDER BY id'),
    rows(pool, 'SELECT language, word FROM filler_words ORDER BY id'),
  ]);
  const handoff = new Map(merchants.map((m) => [m.code as string, m.handoff_group_id as number | null]));
  const snap: Snapshot = {
    kb: [], aliases: {}, mAliases: {}, aspects: group(aspects, 'kind', 'keyword'), smalltalk: group(small, 'kind', 'phrase'), guard: group(guard, 'kind', 'phrase'),
    fillers: {}, settings: {},
  };
  for (const a of aliases) ((snap.aliases[a.canonical] ??= {})[a.language] ??= []).push(a.variant);
  for (const f of fillers) (snap.fillers[f.language] ??= []).push(f.word);
  for (const t of tenants) {
    const D = (table: string) => tbl(t.db, table);
    const [own, entries, trans, [st], tools] = await Promise.all([
      rows(pool, `SELECT language, variant, canonical FROM ${D('aliases')} ORDER BY id`),
      rows(pool, `SELECT e.id, c.name AS category, e.intent_key, e.topic, e.aspect, e.topic_optional, e.status, e.updated_at FROM ${D('kb_entries')} e LEFT JOIN ${D('kb_categories')} c ON c.id = e.category_id ORDER BY e.id`),
      rows(pool, `SELECT kb_id, language, question_examples, answer_text FROM ${D('kb_translations')} ORDER BY id`),
      rows(pool, `SELECT * FROM ${D('settings')} WHERE id = 1`),
      rows(pool, `SELECT tool, enabled FROM ${D('tools')}`),
    ]);
    snap.mAliases[t.code] = own.map((a) => ({ language: a.language, variant: a.variant, canonical: a.canonical }));
    const byKb = new Map<number, SnapEntry['translations']>();
    for (const x of trans) {
      const m = byKb.get(Number(x.kb_id)) ?? {};
      m[x.language as Lang] = { question_examples: asJson<string[]>(x.question_examples, []), answer_text: x.answer_text };
      byKb.set(Number(x.kb_id), m);
    }
    for (const e of entries) snap.kb.push({
      id: Number(e.id), merchant: t.code, category: e.category ?? 'General', intent_key: e.intent_key, topic: e.topic, aspect: e.aspect,
      topic_optional: !!e.topic_optional, status: e.status, updated: (e.updated_at as Date).toISOString(), translations: byKb.get(Number(e.id)) ?? {},
    });
    if (!st) continue;
    const on = new Set(tools.filter((x) => x.enabled).map((x) => x.tool));
    snap.settings[t.code] = {
      tone: st.tone, handoff_group: handoff.get(t.code) ?? null, answer: Number(st.answer_threshold), clarify: Number(st.clarify_threshold), abuse_close_after: st.abuse_close_after,
      kind: { en: '', ms: '', zh: '', ...asJson<Record<string, string>>(st.kind_reply, {}) }, closing: asJson(st.closing_msg, {}), handoff: asJson(st.handoff_msg, {}),
      tools: Object.fromEntries(TOOLS.map((k) => [k, k.endsWith('_status') ? true : on.has(k)])),
    };
  }
  return snap;
}

export interface WriteScope {
  /** Only these merchants are rewritten (codes). Leave out for every merchant in the snapshot. */
  merchants?: string[];
  /** Rewrite the word lists shared by all merchants. Default true. */
  shared?: boolean;
}

/** Replaces the knowledge base with the snapshot, in one transaction. Entries keep their ids so history and tests still point at them.
 *  Each merchant's rows are written into that merchant's own database. */
export async function writeSnapshot(pool: Pool, snap: Snapshot, scope: WriteScope = {}): Promise<void> {
  const tenants = await new Tenants(pool).list();
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const shared = scope.shared !== false;
    const mine = tenants.filter((t) => snap.settings[t.code] && (!scope.merchants || scope.merchants.includes(t.code)));
    const bulk = async (table: string, cols: string, tuples: unknown[][]) => {
      for (let i = 0; i < tuples.length; i += 500) await c.query(`INSERT INTO ${table}(${cols}) VALUES ?`, [tuples.slice(i, i + 500)]);
    };
    const flat = (w: Words) => Object.entries(w).flatMap(([k, byLang]) => Object.entries(byLang).flatMap(([lang, list]) => list.map((x) => [k, lang, x])));

    // words shared by all merchants: rewritten in the order the panel shows them
    if (shared) {
      for (const t of ['shared_aliases', 'aspects', 'shared_smalltalk', 'shared_guard', 'filler_words']) await c.query(`DELETE FROM ${ident(t)}`);
      await bulk('shared_aliases', 'canonical,language,variant', flat(snap.aliases));
      await bulk('aspects', 'kind,language,keyword', flat(snap.aspects));
      await bulk('shared_smalltalk', 'kind,language,phrase', flat(snap.smalltalk));
      await bulk('shared_guard', 'kind,language,phrase', flat(snap.guard));
      await bulk('filler_words', 'language,word', Object.entries(snap.fillers).flatMap(([lang, list]) => list.map((w) => [lang, w])));
    }

    for (const t of mine) {
      const D = (table: string) => tbl(t.db, table); const s = snap.settings[t.code];
      await c.query('UPDATE merchants SET handoff_group_id = ? WHERE id = ?', [s.handoff_group, t.id]);
      await c.query(`DELETE FROM ${D('aliases')}`);
      await bulk(D('aliases'), 'language,variant,canonical', (snap.mAliases[t.code] ?? []).map((a) => [a.language, a.variant, a.canonical]));
      await c.query(`UPDATE ${D('settings')} SET tone=?, answer_threshold=?, clarify_threshold=?, abuse_close_after=?, kind_reply=?, closing_msg=?, handoff_msg=? WHERE id = 1`,
        [s.tone, s.answer, s.clarify, s.abuse_close_after, JSON.stringify(s.kind), JSON.stringify(s.closing), JSON.stringify(s.handoff)]);
      for (const [tool, enabled] of Object.entries(s.tools))
        await c.query(`INSERT INTO ${D('tools')}(tool,enabled) VALUES(?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)`, [tool, enabled]);

      // knowledge base entries: update the ones that exist, add new ones, delete removed ones
      const keep = new Set<string>();
      for (const e of snap.kb.filter((x) => x.merchant === t.code)) {
        keep.add(e.intent_key);
        let cat = (await rows(c, `SELECT id FROM ${D('kb_categories')} WHERE name=?`, [e.category || 'General']))[0]?.id;
        if (!cat) cat = (await c.query<ResultSetHeader>(`INSERT INTO ${D('kb_categories')}(name) VALUES(?)`, [e.category || 'General']))[0].insertId;
        const found = (await rows(c, `SELECT id FROM ${D('kb_entries')} WHERE intent_key=?`, [e.intent_key]))[0];
        let id: number;
        if (found) {
          id = Number(found.id);
          await c.query(`UPDATE ${D('kb_entries')} SET category_id=?, title=?, topic=?, aspect=?, topic_optional=?, status=?, version=version+1 WHERE id=?`,
            [cat, e.intent_key.replace(/_/g, ' '), e.topic, e.aspect || null, !!e.topic_optional, e.status, id]);
        } else {
          id = (await c.query<ResultSetHeader>('INSERT INTO kb_id_seq() VALUES()'))[0].insertId;      // ids stay unique across all merchants
          await c.query(`INSERT INTO ${D('kb_entries')}(id,category_id,intent_key,title,topic,aspect,topic_optional,status) VALUES(?,?,?,?,?,?,?,?)`,
            [id, cat, e.intent_key, e.intent_key.replace(/_/g, ' '), e.topic, e.aspect || null, !!e.topic_optional, e.status]);
        }
        await c.query(`DELETE FROM ${D('kb_translations')} WHERE kb_id=?`, [id]);
        for (const [lang, tr] of Object.entries(e.translations)) {
          if (!tr || (!(tr.answer_text || '').trim() && !(tr.question_examples || []).length)) continue;
          await c.query(`INSERT INTO ${D('kb_translations')}(kb_id,language,question_examples,answer_text) VALUES(?,?,?,?)`, [id, lang, JSON.stringify(tr.question_examples || []), tr.answer_text || '']);
        }
      }
      for (const r of await rows(c, `SELECT id, intent_key FROM ${D('kb_entries')}`)) if (!keep.has(r.intent_key)) await c.query(`DELETE FROM ${D('kb_entries')} WHERE id=?`, [r.id]);
    }
    await c.commit();
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}

/** Builds what the engine needs from a snapshot (used to test a draft before it is published). */
export function knowledgeFromSnapshot(snap: Snapshot, merchants: MerchantMeta[], limits: Record<string, MerchantCfg['limits']>, includeDrafts: boolean): Knowledge {
  const cfgs: MerchantCfg[] = merchants.filter((m) => snap.settings[m.code]).map((m) => {
    const s = snap.settings[m.code];
    return {
      code: m.code, name: m.name, tone: s.tone, defaultLanguage: m.default_language, livechatGroupId: m.livechat_group_id, handoffGroupId: s.handoff_group,
      closing: s.closing, handoff: s.handoff, abuseCloseAfter: s.abuse_close_after, answerThreshold: s.answer, clarifyThreshold: s.clarify, kindReply: s.kind,
      aliases: snap.mAliases[m.code] ?? [], tools: Object.entries(s.tools).filter(([, on]) => on).map(([k]) => k).sort(), limits: limits[m.code] ?? {},
    };
  });
  const entries: KbEntry[] = snap.kb.filter((e) => includeDrafts || e.status === 'live').map((e) => ({
    id: e.id, merchant: e.merchant, category: e.category, intentKey: e.intent_key, topic: e.topic, aspect: e.aspect, topicOptional: !!e.topic_optional,
    translations: Object.fromEntries(Object.entries(e.translations).map(([l, t]) => [l, { questionExamples: t!.question_examples ?? [], answerText: t!.answer_text ?? '' }])),
  }));
  return { merchants: cfgs, kbEntries: entries, globalAliases: snap.aliases as WordMap, aspects: snap.aspects as WordMap, smalltalk: snap.smalltalk as WordMap, guard: snap.guard as WordMap, fillers: snap.fillers };
}
