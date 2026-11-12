import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { claudeDescribe, claudePick, claudeTranslate, makeAnthropic } from './claude';
import { makeOpenAI, openaiWrite } from './openai';
import type { MerchantAiKeys } from './merchantKeys';
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

/** The AI service with each merchant's own keys: a merchant that saved a Claude or ChatGPT key uses it, the others use the shared key from .env.
 *  Callers say which merchant a call is for (the `merchant` field). Nothing changes for a merchant without its own key. */
export function createRoutedAi(base: AiOptions, keys: MerchantAiKeys): AiService {
  const shared = createAi(base);
  const built = new Map<string, { sig: string; svc: AiService }>();
  const forMerchant = async (merchant?: string): Promise<AiService> => {
    if (!merchant) return shared;
    const k = await keys.resolve(merchant);
    if (!k.anthropic && !k.openai) return shared;
    const sig = `${k.anthropic ?? ''}|${k.openai ?? ''}`, hit = built.get(merchant);
    if (hit && hit.sig === sig) return hit.svc;
    const svc = createAi({ ...base, anthropicKey: k.anthropic ?? base.anthropicKey, openaiKey: k.openai ?? base.openaiKey,
      anthropic: k.anthropic ? undefined : base.anthropic, openai: k.openai ? undefined : base.openai });
    built.set(merchant, { sig, svc }); return svc;
  };
  return {
    get canPick() { return shared.canPick || keys.anyHas.anthropic; },
    get canWrite() { return shared.canWrite || (keys.anyHas.openai && !!base.openaiModel); },
    get canDescribe() { return shared.canDescribe || keys.anyHas.anthropic; },
    get canTranslate() { return shared.canTranslate || keys.anyHas.anthropic; },
    pickEntry: async (i: PickInput) => (await forMerchant(i.merchant)).pickEntry(i),
    writeReply: async (i: WriteInput) => (await forMerchant(i.merchant)).writeReply(i),
    describeWord: async (i: DescribeInput) => (await forMerchant(i.merchant)).describeWord(i),
    translate: async (i: TranslateInput) => (await forMerchant(i.merchant)).translate(i),
  };
}
