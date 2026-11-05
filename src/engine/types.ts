export type Lang = 'en' | 'ms' | 'zh';
export const LANGS: Lang[] = ['en', 'ms', 'zh'];

/** Words grouped by key and language, for example aliases.deposit.en = ['dep','depo']. */
export type WordMap = Record<string, Record<string, string[]>>;

export interface Translation { questionExamples: string[]; answerText: string }

export interface KbEntry {
  id: number;
  merchant: string;            // merchant code
  category: string;
  intentKey: string;
  topic: string;
  aspect: string | null;       // question type (time, limit, how, change, hours) or null
  topicOptional: boolean;      // the question type alone is enough
  translations: Partial<Record<Lang, Translation>>;
}

export interface MerchantCfg {
  code: string; name: string; tone: 'friendly' | 'formal'; defaultLanguage: Lang;
  livechatGroupId: number | null; handoffGroupId: number | null;
  closing: Partial<Record<Lang, string>>; handoff: Partial<Record<Lang, string>>;
  abuseCloseAfter: number; answerThreshold: number; clarifyThreshold: number; kindReply: Partial<Record<Lang, string>>;
  aliases: { language: string; variant: string; canonical: string }[];   // merchant-only keywords
  tools: string[];                                                      // enabled account tools
  limits: Partial<Record<'deposit' | 'withdraw', [number, number]>>;
}

/** Everything the engine needs to know. It is loaded from the database (or from the seed JSON in tests). */
export interface Knowledge {
  merchants: MerchantCfg[];
  globalAliases: WordMap;      // topic -> language -> keywords
  smalltalk: WordMap;          // kind -> language -> phrases
  aspects: WordMap;            // kind -> language -> words
  guard: WordMap;              // kind -> language -> phrases
  fillers: Record<string, string[]>;
  kbEntries: KbEntry[];
}

export type Decision =
  | 'ANSWER' | 'CHOICE' | 'CLARIFY' | 'HANDOFF' | 'ABUSE' | 'SMALLTALK' | 'ACCOUNT' | 'REFUSE' | 'AMOUNT';

export interface Option { kind: 'intent' | 'topic'; key: string }
export interface Amount { n: number; text: string; hasCur: boolean }
export interface Candidate { id: number; intent: string; score: number; example: string }
export interface KeywordRow { id: number; intent: string; topic: string; aspect: string | null; opt: boolean; tOk?: boolean; aOk?: boolean }
export interface KeywordScan { T: string[]; A: string[]; rest: string; strong: KeywordRow[]; partial: KeywordRow[] }
export interface Guard { kind: 'injection' | 'other-merchant' | 'sensitive' | 'human'; hit: string[]; why: string }

export interface AnalyzeResult {
  raw: string; lang: Lang; normalized: string; hits: [string, string][];
  abuseHit: string[]; guard: Guard | null; ks: KeywordScan; via: 'similarity' | 'keywords' | 'ai';
  cands: Candidate[]; top: Candidate; second: Candidate;
  decision: Decision; why: string; conf: number; options: Option[]; topic: string | null;
  small: string | null; smallFallback: boolean;
  account: { kind: 'deposit' | 'withdraw' } | null;
  amt: Amount | null; dir: 'deposit' | 'withdraw' | null; ctxDir: string | null;
}

export interface AnalyzeContext { lastTopic?: string | null }
