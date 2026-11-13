// The shapes the control panel and the server share. Pure types, no imports of server code, so the front end can use them too.
import type { Lang } from '../engine/types';

export type Words = Record<string, Record<string, string[]>>;
export interface SnapEntry {
  id: number; merchant: string; category: string; intent_key: string; topic: string; aspect: string | null; topic_optional: boolean;
  status: 'live' | 'draft'; updated?: string;
  /** answer (default) | needs_staff | promotion */
  entry_type?: 'answer' | 'needs_staff' | 'promotion';
  /** Last day the entry is used, YYYY-MM-DD; empty = no end. */
  ends_on?: string | null;
  translations: Partial<Record<Lang, { question_examples: string[]; answer_text: string }>>;
}
export interface SnapSettings {
  tone: 'friendly' | 'formal'; handoff_group: number | null; answer: number; clarify: number; abuse_close_after: number;
  kind: Record<string, string>; closing: Record<string, string>; handoff: Record<string, string>; tools: Record<string, boolean>;
  max_choices: number; more_help_on: boolean; more_help: Record<string, string>;
}
/** Everything the control panel edits. The panel works on a copy of this and sends it back on Publish. */
export interface Snapshot {
  kb: SnapEntry[]; aliases: Words; mAliases: Record<string, { language: string; variant: string; canonical: string; kind?: string | null }[]>;
  aspects: Words; smalltalk: Words; guard: Words; fillers: Record<string, string[]>; settings: Record<string, SnapSettings>;
}
export interface MerchantMeta { code: string; name: string; default_language: Lang; livechat_group_id: number | null }
