import type { RowDataPacket } from 'mysql2/promise';
import { asJson, type Pool } from './pool';
import type { Knowledge, KbEntry, MerchantCfg, WordMap, Lang } from '../engine/types';

const group = (rows: RowDataPacket[]): WordMap => {
  const out: WordMap = {};
  for (const r of rows) ((out[r.k] ??= {})[r.language] ??= []).push(r.w);
  return out;
};

/** Reads the live knowledge of ALL merchants from the database into the engine's data shape. */
export async function loadKnowledge(pool: Pool): Promise<Knowledge> {
  const q = async (sql: string) => (await pool.query<RowDataPacket[]>(sql))[0];
  const [merchants, aliases, limits, tools, entries, trans, aspects, small, guard, fillers] = await Promise.all([
    q(`SELECT m.id, m.code, m.name, m.default_language, m.livechat_group_id, m.handoff_group_id, s.tone, s.closing_msg, s.handoff_msg, s.abuse_close_after, s.answer_threshold, s.clarify_threshold, s.kind_reply
       FROM merchants m JOIN merchant_settings s ON s.merchant_id = m.id WHERE m.status = 'active' ORDER BY m.id`),
    q('SELECT merchant_id, language, variant, canonical FROM aliases ORDER BY id'),
    q('SELECT merchant_id, kind, CAST(min_amount AS DOUBLE) AS lo, CAST(max_amount AS DOUBLE) AS hi FROM merchant_limits'),
    q('SELECT merchant_id, tool FROM merchant_tools WHERE enabled ORDER BY tool'),
    q(`SELECT e.id, m.code AS merchant, c.name AS category, e.intent_key, e.topic, e.aspect, e.topic_optional
       FROM kb_entries e JOIN merchants m ON m.id = e.merchant_id LEFT JOIN kb_categories c ON c.id = e.category_id
       WHERE e.status = 'live' AND m.status = 'active' ORDER BY e.id`),
    q('SELECT kb_id, language, question_examples, answer_text FROM kb_translations ORDER BY id'),
    q('SELECT kind AS k, language, keyword AS w FROM aspects ORDER BY id'),
    q('SELECT kind AS k, language, phrase AS w FROM smalltalk_phrases WHERE merchant_id IS NULL ORDER BY id'),
    q('SELECT kind AS k, language, phrase AS w FROM guard_phrases WHERE merchant_id IS NULL ORDER BY id'),
    q('SELECT language, word FROM filler_words ORDER BY id'),
  ]);

  const byMerchantId = new Map<number, MerchantCfg>();
  const cfgs: MerchantCfg[] = merchants.map((m) => {
    const cfg: MerchantCfg = {
      code: m.code, name: m.name, tone: m.tone, defaultLanguage: m.default_language,
      livechatGroupId: m.livechat_group_id, handoffGroupId: m.handoff_group_id,
      closing: asJson(m.closing_msg, {}), handoff: asJson(m.handoff_msg, {}), abuseCloseAfter: m.abuse_close_after, answerThreshold: Number(m.answer_threshold), clarifyThreshold: Number(m.clarify_threshold), kindReply: asJson(m.kind_reply, {}),
      aliases: [], tools: [], limits: {},
    };
    byMerchantId.set(Number(m.id), cfg);
    return cfg;
  });
  for (const a of aliases) if (a.merchant_id != null) byMerchantId.get(Number(a.merchant_id))?.aliases.push({ language: a.language, variant: a.variant, canonical: a.canonical });
  for (const l of limits) { const c = byMerchantId.get(Number(l.merchant_id)); if (c) c.limits[l.kind as 'deposit' | 'withdraw'] = [l.lo, l.hi]; }
  for (const t of tools) byMerchantId.get(Number(t.merchant_id))?.tools.push(t.tool);

  const transByKb = new Map<number, KbEntry['translations']>();
  for (const t of trans) {
    const m = transByKb.get(Number(t.kb_id)) ?? {};
    m[t.language as Lang] = { questionExamples: asJson<string[]>(t.question_examples, []), answerText: t.answer_text };
    transByKb.set(Number(t.kb_id), m);
  }
  const kbEntries: KbEntry[] = entries.map((e) => ({
    id: Number(e.id), merchant: e.merchant, category: e.category ?? '', intentKey: e.intent_key, topic: e.topic,
    aspect: e.aspect, topicOptional: !!e.topic_optional, translations: transByKb.get(Number(e.id)) ?? {},
  }));

  const globalAliases: WordMap = {};
  for (const a of aliases) if (a.merchant_id == null) ((globalAliases[a.canonical] ??= {})[a.language] ??= []).push(a.variant);
  const fillerMap: Record<string, string[]> = {};
  for (const f of fillers) (fillerMap[f.language] ??= []).push(f.word);

  return { merchants: cfgs, kbEntries, globalAliases, aspects: group(aspects), smalltalk: group(small), guard: group(guard), fillers: fillerMap };
}
