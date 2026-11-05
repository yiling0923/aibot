import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { asJson } from '../db/pool';
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

/** Reads the whole editable knowledge base, drafts included. */
export async function readSnapshot(pool: Pool): Promise<Snapshot> {
  const [merchants, aliases, aspects, small, guard, fillers, entries, trans, settings, tools] = await Promise.all([
    rows(pool, "SELECT id, code, handoff_group_id FROM merchants WHERE status = 'active' ORDER BY id"),
    rows(pool, 'SELECT merchant_id, language, variant, canonical FROM aliases ORDER BY id'),
    rows(pool, 'SELECT kind, language, keyword FROM aspects ORDER BY id'),
    rows(pool, 'SELECT kind, language, phrase FROM smalltalk_phrases WHERE merchant_id IS NULL ORDER BY id'),
    rows(pool, 'SELECT kind, language, phrase FROM guard_phrases WHERE merchant_id IS NULL ORDER BY id'),
    rows(pool, 'SELECT language, word FROM filler_words ORDER BY id'),
    rows(pool, `SELECT e.id, m.code AS merchant, c.name AS category, e.intent_key, e.topic, e.aspect, e.topic_optional, e.status, e.updated_at
                FROM kb_entries e JOIN merchants m ON m.id = e.merchant_id LEFT JOIN kb_categories c ON c.id = e.category_id WHERE m.status = 'active' ORDER BY e.id`),
    rows(pool, 'SELECT kb_id, language, question_examples, answer_text FROM kb_translations ORDER BY id'),
    rows(pool, 'SELECT * FROM merchant_settings'),
    rows(pool, 'SELECT merchant_id, tool, enabled FROM merchant_tools'),
  ]);
  const code = new Map(merchants.map((m) => [Number(m.id), m.code as string]));
  const snap: Snapshot = {
    kb: [], aliases: {}, mAliases: {}, aspects: group(aspects, 'kind', 'keyword'), smalltalk: group(small, 'kind', 'phrase'), guard: group(guard, 'kind', 'phrase'),
    fillers: {}, settings: {},
  };
  for (const m of merchants) snap.mAliases[m.code] = [];
  for (const a of aliases) {
    if (a.merchant_id == null) ((snap.aliases[a.canonical] ??= {})[a.language] ??= []).push(a.variant);
    else snap.mAliases[code.get(Number(a.merchant_id))!]?.push({ language: a.language, variant: a.variant, canonical: a.canonical });
  }
  for (const f of fillers) (snap.fillers[f.language] ??= []).push(f.word);
  const byKb = new Map<number, SnapEntry['translations']>();
  for (const t of trans) {
    const m = byKb.get(Number(t.kb_id)) ?? {};
    m[t.language as Lang] = { question_examples: asJson<string[]>(t.question_examples, []), answer_text: t.answer_text };
    byKb.set(Number(t.kb_id), m);
  }
  for (const e of entries) snap.kb.push({
    id: Number(e.id), merchant: e.merchant, category: e.category ?? 'General', intent_key: e.intent_key, topic: e.topic, aspect: e.aspect,
    topic_optional: !!e.topic_optional, status: e.status, updated: (e.updated_at as Date).toISOString(), translations: byKb.get(Number(e.id)) ?? {},
  });
  for (const m of merchants) {
    const s = settings.find((x) => Number(x.merchant_id) === Number(m.id))!;
    const on = new Set(tools.filter((t) => Number(t.merchant_id) === Number(m.id) && t.enabled).map((t) => t.tool));
    snap.settings[m.code] = {
      tone: s.tone, handoff_group: m.handoff_group_id, answer: Number(s.answer_threshold), clarify: Number(s.clarify_threshold), abuse_close_after: s.abuse_close_after,
      kind: { en: '', ms: '', zh: '', ...asJson<Record<string, string>>(s.kind_reply, {}) }, closing: asJson(s.closing_msg, {}), handoff: asJson(s.handoff_msg, {}),
      tools: Object.fromEntries(TOOLS.map((k) => [k, k.endsWith('_status') ? true : on.has(k)])),
    };
  }
  return snap;
}

/** Replaces the knowledge base with the snapshot, in one transaction. Entries keep their ids so history and tests still point at them. */
export async function writeSnapshot(pool: Pool, snap: Snapshot): Promise<void> {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const merchants = await rows(c, 'SELECT id, code FROM merchants');
    const mid = new Map(merchants.map((m) => [m.code as string, Number(m.id)]));

    // words shared by all merchants: rewritten in the order the panel shows them
    // Only merchants this snapshot knows about are rewritten: a merchant added later keeps its entries and short forms.
    const known = Object.keys(snap.settings).map((code) => mid.get(code)).filter((id): id is number => id != null);
    await (known.length ? c.query('DELETE FROM aliases WHERE merchant_id IS NULL OR merchant_id IN (?)', [known]) : c.query('DELETE FROM aliases WHERE merchant_id IS NULL'));
    await c.query('DELETE FROM aspects'); await c.query('DELETE FROM smalltalk_phrases WHERE merchant_id IS NULL');
    await c.query('DELETE FROM guard_phrases WHERE merchant_id IS NULL'); await c.query('DELETE FROM filler_words');
    const bulk = async (table: string, cols: string, tuples: unknown[][]) => {
      for (let i = 0; i < tuples.length; i += 500) await c.query(`INSERT INTO ${table}(${cols}) VALUES ?`, [tuples.slice(i, i + 500)]);
    };
    const flat = (w: Words, pre: unknown[] = []) => Object.entries(w).flatMap(([k, byLang]) => Object.entries(byLang).flatMap(([lang, list]) => list.map((x) => [...pre, k, lang, x])));
    await bulk('aliases', 'merchant_id,canonical,language,variant', flat(snap.aliases, [null]));
    await bulk('aspects', 'kind,language,keyword', flat(snap.aspects));
    await bulk('smalltalk_phrases', 'merchant_id,kind,language,phrase', flat(snap.smalltalk, [null]));
    await bulk('guard_phrases', 'merchant_id,kind,language,phrase', flat(snap.guard, [null]));
    await bulk('filler_words', 'language,word', Object.entries(snap.fillers).flatMap(([lang, list]) => list.map((w) => [lang, w])));
    for (const [code, list] of Object.entries(snap.mAliases)) if (mid.has(code))
      await bulk('aliases', 'merchant_id,language,variant,canonical', list.map((a) => [mid.get(code), a.language, a.variant, a.canonical]));

    // settings and tools
    for (const [code, s] of Object.entries(snap.settings)) {
      const id = mid.get(code); if (!id) continue;
      await c.query('UPDATE merchants SET handoff_group_id = ? WHERE id = ?', [s.handoff_group, id]);
      await c.query(`UPDATE merchant_settings SET tone=?, answer_threshold=?, clarify_threshold=?, abuse_close_after=?, kind_reply=?, closing_msg=?, handoff_msg=? WHERE merchant_id=?`,
        [s.tone, s.answer, s.clarify, s.abuse_close_after, JSON.stringify(s.kind), JSON.stringify(s.closing), JSON.stringify(s.handoff), id]);
      for (const [tool, enabled] of Object.entries(s.tools))
        await c.query('INSERT INTO merchant_tools(merchant_id,tool,enabled) VALUES(?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)', [id, tool, enabled]);
    }

    // knowledge base entries: update the ones that exist, add new ones, delete removed ones
    const keep = new Set<string>();
    for (const e of snap.kb) {
      const m = mid.get(e.merchant); if (!m) continue;
      keep.add(`${m}|${e.intent_key}`);
      let cat = (await rows(c, 'SELECT id FROM kb_categories WHERE merchant_id=? AND name=?', [m, e.category || 'General']))[0]?.id;
      if (!cat) cat = (await c.query<ResultSetHeader>('INSERT INTO kb_categories(merchant_id,name) VALUES(?,?)', [m, e.category || 'General']))[0].insertId;
      const found = (await rows(c, 'SELECT id FROM kb_entries WHERE merchant_id=? AND intent_key=?', [m, e.intent_key]))[0];
      let id: number;
      if (found) {
        id = Number(found.id);
        await c.query('UPDATE kb_entries SET category_id=?, title=?, topic=?, aspect=?, topic_optional=?, status=?, version=version+1 WHERE id=?',
          [cat, e.intent_key.replace(/_/g, ' '), e.topic, e.aspect || null, !!e.topic_optional, e.status, id]);
      } else {
        id = (await c.query<ResultSetHeader>('INSERT INTO kb_entries(merchant_id,category_id,intent_key,title,topic,aspect,topic_optional,status) VALUES(?,?,?,?,?,?,?,?)',
          [m, cat, e.intent_key, e.intent_key.replace(/_/g, ' '), e.topic, e.aspect || null, !!e.topic_optional, e.status]))[0].insertId;
      }
      await c.query('DELETE FROM kb_translations WHERE kb_id=?', [id]);
      for (const [lang, t] of Object.entries(e.translations)) {
        if (!t || (!(t.answer_text || '').trim() && !(t.question_examples || []).length)) continue;
        await c.query('INSERT INTO kb_translations(kb_id,language,question_examples,answer_text) VALUES(?,?,?,?)', [id, lang, JSON.stringify(t.question_examples || []), t.answer_text || '']);
      }
    }
    for (const r of await rows(c, 'SELECT id, merchant_id, intent_key FROM kb_entries'))
      if (known.includes(Number(r.merchant_id)) && !keep.has(`${r.merchant_id}|${r.intent_key}`)) await c.query('DELETE FROM kb_entries WHERE id=?', [r.id]);
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
