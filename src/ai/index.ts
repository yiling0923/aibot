import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { claudeDescribe, claudePick, claudeTranslate, makeAnthropic } from './claude';
import { makeOpenAI, openaiWrite } from './openai';
import type { AiService, DescribeInput, PickInput, TranslateInput, WriteInput } from './types';

export * from './types';
export { checkReply, checkTranslation } from './validator';

export interface AiOptions {
  anthropicKey?: string; claudeModel?: string; openaiKey?: string; openaiModel?: string;
  /** Stops a runaway bill: after this many AI calls in an hour the bot answers without AI until the hour is over. */
  maxCallsPerHour?: number;
  fetch?: typeof fetch;
  /** Ready-made clients (tests). */
  anthropic?: Anthropic; openai?: OpenAI;
}

/** Builds the AI service from the settings. Anything that is not set up is simply switched off. */
export function createAi(o: AiOptions): AiService {
  const claude = o.anthropic ?? (o.anthropicKey ? makeAnthropic(o.anthropicKey, o.fetch) : null);
  const claudeModel = o.claudeModel || 'claude-haiku-5-5';
  const gpt = o.openai ?? (o.openaiKey && o.openaiModel ? makeOpenAI(o.openaiKey, o.fetch) : null);
  const max = o.maxCallsPerHour ?? 600;
  const calls: number[] = [];
  const warned = new Set<string>();

  /** Counts a call against the hourly limit. */
  const allow = () => {
    const now = Date.now();
    while (calls.length && calls[0] < now - 3600_000) calls.shift();
    if (calls.length >= max) return false;
    calls.push(now); return true;
  };
  /** Runs one AI call. Any failure (no network, timeout, bad key, odd answer) becomes null and a single quiet warning. */
  const run = async <T>(kind: string, fn: () => Promise<T | null>): Promise<T | null> => {
    if (!allow()) return null;
    try { return await fn(); }
    catch (e) {
      if (!warned.has(kind)) { warned.add(kind); console.warn(`AI (${kind}) failed, the bot answers without it: ${(e as Error).message}`); }
      return null;
    }
  };

  return {
    canPick: !!claude, canWrite: !!gpt, canDescribe: !!claude, canTranslate: !!claude,
    pickEntry: (i: PickInput) => (claude ? run('claude pick', () => claudePick(claude, claudeModel, i)) : Promise.resolve(null)),
    describeWord: (i: DescribeInput) => (claude ? run('claude describe', () => claudeDescribe(claude, claudeModel, i)) : Promise.resolve(null)),
    translate: (i: TranslateInput) => (claude ? run('claude translate', () => claudeTranslate(claude, claudeModel, i)) : Promise.resolve(null)),
    writeReply: (i: WriteInput) => (gpt ? run('chatgpt write', () => openaiWrite(gpt, o.openaiModel!, i)) : Promise.resolve(null)),
  };
}
