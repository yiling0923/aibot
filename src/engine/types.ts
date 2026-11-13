/** English, Malay, Chinese, Vietnamese, Thai and Filipino (tl, the code LiveChat uses too). */
export type Lang = 'en' | 'ms' | 'zh' | 'vi' | 'th' | 'tl';
export const LANGS: Lang[] = ['en', 'ms', 'zh', 'vi', 'th', 'tl'];

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
  /** answer (default), needs_staff (a person must answer: the bot hands over) or promotion (an answer that hides itself after endsOn). */
  entryType?: EntryType;
  /** The last day the entry is used (YYYY-MM-DD). Empty: no end. */
  endsOn?: string | null;
}
export type EntryType = 'answer' | 'needs_staff' | 'promotion';
export const ENTRY_TYPES: EntryType[] = ['answer', 'needs_staff', 'promotion'];

export interface MerchantCfg {
  code: string; name: string; tone: 'friendly' | 'formal'; defaultLanguage: Lang;
  livechatGroupId: number | null; handoffGroupId: number | null;
  closing: Partial<Record<Lang, string>>; handoff: Partial<Record<Lang, string>>;
  maxChoices: number; moreHelpOn: boolean; moreHelp: Partial<Record<Lang, string>>;   // choices shown at once (1-3), and the line after them
  abuseCloseAfter: number; answerThreshold: number; clarifyThreshold: number; kindReply: Partial<Record<Lang, string>>;
  aliases: { language: string; variant: string; canonical: string; kind?: string | null }[];   // merchant-only keywords (kind: short | slang | meaning, only for the panel)
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
/** A word the customer typed that the bot recognised: a topic word (depo, 充值, nạp tiền) or a question word (how long, 'not in'). `to` is what it points to (the topic, or the question type). */
export interface KeywordHit { word: string; kind: 'topic' | 'question' | 'money'; to: string }
export interface KeywordScan { T: string[]; A: string[]; rest: string; strong: KeywordRow[]; partial: KeywordRow[]; words: KeywordHit[]; money: string[] }
export interface Guard { kind: 'injection' | 'other-merchant' | 'sensitive' | 'human'; hit: string[]; why: string }

export interface AnalyzeResult {
  raw: string; lang: Lang; normalized: string; hits: [string, string][];
  /** Step 1 of the flow (keywords): the words the customer typed that the bot recognised. Step 2 (topic): how likely each topic is, best first. Step 3 (answer): the entry id when the decision is ANSWER. */
  keywords: KeywordHit[]; topicScores: { topic: string; score: number }[]; answerId: number | null;
  abuseHit: string[]; guard: Guard | null; ks: KeywordScan; via: 'similarity' | 'keywords' | 'ai';
  cands: Candidate[]; top: Candidate; second: Candidate;
  decision: Decision; why: string; conf: number; options: Option[]; topic: string | null;
  small: string | null; smallFallback: boolean;
  account: { kind: 'deposit' | 'withdraw' } | null;
  amt: Amount | null; dir: 'deposit' | 'withdraw' | null; ctxDir: string | null;
}

export interface AnalyzeContext { lastTopic?: string | null }
