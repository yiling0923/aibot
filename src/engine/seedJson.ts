import type { Knowledge, KbEntry, MerchantCfg, Lang } from './types';

/** Reads data/kb_seed.json + data/fake_accounts.json (the fake template data) into the engine's data shape. */
export function knowledgeFromSeed(seed: any, accounts: any): Knowledge {
  const tools: Record<string, string[]> = accounts._tools ?? {};
  const merchants: MerchantCfg[] = seed.merchants.map((m: any) => ({
    code: m.code, name: m.name, tone: m.tone, defaultLanguage: m.default_language,
    livechatGroupId: m.livechat_group_id, handoffGroupId: m.handoff_group_id,
    closing: m.settings.closing, handoff: m.settings.handoff, maxChoices: 3, moreHelpOn: true, moreHelp: {}, abuseCloseAfter: 3, answerThreshold: 0.72, clarifyThreshold: 0.45, kindReply: {},
    aliases: (m.aliases as [string, string, string][]).map(([language, variant, canonical]) => ({ language, variant, canonical })),
    tools: ['deposit_status', 'withdraw_status', ...(tools[m.code] ?? [])],   // the two status tools are always on
    limits: Object.fromEntries(Object.entries(seed.limits?.[m.code] ?? {})) as MerchantCfg['limits'],
  }));
  const kbEntries: KbEntry[] = seed.kb_entries.map((e: any, i: number) => ({
    id: i + 1, merchant: e.merchant, category: e.category, intentKey: e.intent_key, topic: e.topic ?? '',
    aspect: e.aspect ?? null, topicOptional: !!e.topic_optional,
    translations: Object.fromEntries(Object.entries(e.translations).map(([lg, t]: [string, any]) =>
      [lg as Lang, { questionExamples: t.question_examples, answerText: t.answer_text }])),
  }));
  return {
    merchants, kbEntries,
    globalAliases: seed.global_aliases, smalltalk: seed.smalltalk, aspects: seed.aspects, guard: seed.guard, fillers: seed.fillers,
  };
}
