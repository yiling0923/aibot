import type { Lang } from '../lib/api';

export interface Acct {
  chk: { state: 'none' | 'invalid' | 'valid'; id?: string; name?: string };
  verified: boolean; call?: string; json?: string;
  rows?: { ref: string; amount: string; status: string }[];
}
export interface Opt { kind: string; key: string; label: string }
export interface MerchantInfo { name: string; tone: string; handoffGroupId: number | null }

/** What the server says about one typed message (shown in the "what the bot did" panel). */
export interface MessageTrace {
  kind: 'message'; decision: string; why: string; conf: number; lang: Lang; via: string; normalized: string; hits: [string, string][]; raw: string;
  abuseHit: string[]; guard: { kind: string; hit: string[]; why: string } | null; ks: { T: string[]; A: string[] };
  cands: { id: number; intent: string; score: number; example: string }[]; top: { id: number; intent: string; score: number; example: string };
  small: string | null; smallFallback: boolean; amt: { n: number } | null; dir: string | null; ctxDir: string | null; topic: string | null;
  options: Opt[]; kbAnswer?: string; smallText?: string; strike?: number; limit?: number; close?: boolean; acct: Acct | null;
  merchant: MerchantInfo; agentLabel: string; amtButtons: string[] | null;
  ai?: { picked?: string | null; confidence?: number | null; written?: boolean; rejected?: string };
  /** The flow of the plan: the words typed, the topic scores, the answer, and the question the bot has open (it never asks twice). */
  keywords?: { word: string; kind: string; to: string }[]; topicScores?: { topic: string; score: number }[]; answerId?: number | null; askKind?: string | null;
}
/** What the server says about a tapped button. */
export interface PickTrace {
  kind: 'pick'; pickKind: string; key: string; label: string; lang: Lang; merchant: MerchantInfo; agentLabel: string;
  amt?: number; acct?: Acct; extra?: string;
}
export interface SkippedTrace { kind: 'skipped'; note: string }
export type Trace = MessageTrace | PickTrace | SkippedTrace;

export interface Button { kind: string; key: string; label: string; amt?: number }
export interface Turn {
  messages: { kind: string; text: string }[]; buttons: Button[] | null; hint?: string | null; locked: boolean; status: string | null; trace: Trace;
}
export interface TurnResponse { closed: boolean; handed: boolean; turn: Turn | null; saved?: { fresh: string[]; unmatched: boolean } }
export interface StartResponse {
  sessionId: string; greeting: { kind: string; text: string };
  identity: { state: 'none' | 'invalid' | 'valid'; id?: string; name?: string };
}
export interface MerchantRow { code: string; name: string; tone: string; defaultLanguage: string }
export interface Customer { key: string; label: string; token: string | null }
