import type { Lang, Step, StepKind } from './types';
import { LANGS, STEP_KINDS } from './types';

export const MAX_STEPS = 3, MAX_ASK = 300;

/** Reads a list of steps from the database or the panel: keeps only valid ones (known kind, some text), at most 3, trimmed. */
export function cleanSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return [];
  const out: Step[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as { kind?: unknown; ask?: unknown };
    if (!STEP_KINDS.includes(o.kind as StepKind)) continue;
    const ask: Partial<Record<Lang, string>> = {};
    if (o.ask && typeof o.ask === 'object') for (const l of LANGS) { const v = (o.ask as Record<string, unknown>)[l]; if (typeof v === 'string' && v.trim()) ask[l] = v.trim().slice(0, MAX_ASK); }
    if (!Object.keys(ask).length) continue;
    out.push({ kind: o.kind as StepKind, ask });
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}
