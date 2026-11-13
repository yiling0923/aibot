import type { RowDataPacket } from 'mysql2/promise';
import { asJson, type Pool } from './pool';
import { Tenants, tbl } from './tenants';
import type { Knowledge, KbEntry, MerchantCfg, WordMap, Lang } from '../engine/types';

const group = (rows: RowDataPacket[]): WordMap => {
  const out: WordMap = {};
  for (const r of rows) ((out[r.k] ??= {})[r.language] ??= []).push(r.w);
  return out;
};

/** Reads the live knowledge of ALL merchants into the engine's data shape: each merchant from its own database, the shared word lists from the main one. */
export async function loadKnowledge(pool: Pool): Promise<Knowledge> {
  const q = async (sql: string) => (await pool.query<RowDataPacket[]>(sql))[0];
  const tenants = await new Tenants(pool).list();
  const [aliases, aspects, small, guard, fillers, merchantRows] = await Promise.all([
    q('SELECT language, variant, canonical FROM shared_aliases ORDER BY id'),
    q('SELECT kind AS k, language, keyword AS w FROM aspects ORDER BY id'),
    q('SELECT kind AS k, language, phrase AS w FROM shared_smalltalk ORDER BY id'),
    q('SELECT kind AS k, language, phrase AS w FROM shared_guard ORDER BY id'),
    q('SELECT language, word FROM filler_words ORDER BY id'),
    q("SELECT code, name, default_language, livechat_group_id, handoff_group_id FROM merchants WHERE status = 'active' ORDER BY id"),
  ]);
  const meta = new Map(merchantRows.map((m) => [m.code as string, m]));

  const cfgs: MerchantCfg[] = []; const kbEntries: KbEntry[] = [];
  for (const t of tenants) {
    const m = meta.get(t.code)!; const D = (table: string) => tbl(t.db, table);
    const [[s], own, limits, tools, entries, trans] = await Promise.all([
      q(`SELECT * FROM ${D('settings')} WHERE id = 1`),
      q(`SELECT language, variant, canonical FROM ${D('aliases')} ORDER BY id`),
      q(`SELECT kind, CAST(min_amount AS DOUBLE) AS lo, CAST(max_amount AS DOUBLE) AS hi FROM ${D('limits')}`),
      q(`SELECT tool FROM ${D('tools')} WHERE enabled ORDER BY tool`),
      q(`SELECT e.id, c.name AS category, e.intent_key, e.topic, e.aspect, e.topic_optional, e.entry_type, e.channel_overrides, DATE_FORMAT(e.valid_to, '%Y-%m-%d') AS ends_on FROM ${D('kb_entries')} e LEFT JOIN ${D('kb_categories')} c ON c.id = e.category_id WHERE e.status = 'live' ORDER BY e.id`),
      q(`SELECT kb_id, language, question_examples, answer_text FROM ${D('kb_translations')} ORDER BY id`),
    ]);
    if (!s) continue;
    const cfg: MerchantCfg = {
      code: t.code, name: m.name, tone: s.tone, defaultLanguage: m.default_language, livechatGroupId: m.livechat_group_id, handoffGroupId: m.handoff_group_id,
      closing: asJson(s.closing_msg, {}), handoff: asJson(s.handoff_msg, {}), maxChoices: Math.max(1, Math.min(3, Number(s.max_choices ?? 3))), moreHelpOn: !!(s.more_help_on ?? 1), moreHelp: asJson(s.more_help_msg, {}), abuseCloseAfter: s.abuse_close_after, answerThreshold: Number(s.answer_threshold), clarifyThreshold: Number(s.clarify_threshold),
      kindReply: asJson(s.kind_reply, {}), aliases: own.map((a) => ({ language: a.language, variant: a.variant, canonical: a.canonical })), tools: tools.map((x) => x.tool), limits: {},
    };
    for (const l of limits) cfg.limits[l.kind as 'deposit' | 'withdraw'] = [l.lo, l.hi];
    cfgs.push(cfg);
    const byKb = new Map<number, KbEntry['translations']>();
    for (const x of trans) {
      const tr = byKb.get(Number(x.kb_id)) ?? {};
      tr[x.language as Lang] = { questionExamples: asJson<string[]>(x.question_examples, []), answerText: x.answer_text };
      byKb.set(Number(x.kb_id), tr);
    }
    for (const e of entries) kbEntries.push({ id: Number(e.id), merchant: t.code, category: e.category ?? '', intentKey: e.intent_key, topic: e.topic, aspect: e.aspect, topicOptional: !!e.topic_optional, translations: byKb.get(Number(e.id)) ?? {}, entryType: e.entry_type ?? 'answer', endsOn: e.ends_on ?? null, channelAnswers: asJson(e.channel_overrides, {}) });
  }

  const globalAliases: WordMap = {};
  for (const a of aliases) ((globalAliases[a.canonical] ??= {})[a.language] ??= []).push(a.variant);
  const fillerMap: Record<string, string[]> = {};
  for (const f of fillers) (fillerMap[f.language] ??= []).push(f.word);
  return { merchants: cfgs, kbEntries, globalAliases, aspects: group(aspects), smalltalk: group(small), guard: group(guard), fillers: fillerMap };
}
