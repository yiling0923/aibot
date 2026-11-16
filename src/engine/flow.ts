import type { Flow, FlowBlock, FlowNext, FlowState, FlowText } from './flowTypes';

/** What a step of a flow produces. */
export interface FlowOut {
  messages: string[];
  buttons: { key: string; label: string }[] | null;     // tap choices for the customer (key = the option id)
  state: FlowState | null;                              // where the customer waits (null when the flow is over)
  handed: boolean;                                      // a person takes over
  done: boolean;
}

const MAX_STEPS = 40;                                   // a flow that loops by mistake stops here
/** The value of "next" that means: stop here, do not continue below. */
export const STOP = '__end';
const say = (t: FlowText | undefined, lang: string, vars: Record<string, string>) =>
  ((t?.[lang] || t?.en || '') as string).replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '').trim();

/** The id of the block that comes after block `i`, following its own "next" or else the block below. null = the flow ends. */
function follow(flow: Flow, i: number, next: FlowNext): string | null {
  if (next === STOP) return null;
  if (next) return flow.blocks.some((b) => b.id === next) ? next : null;
  return flow.blocks[i + 1]?.id ?? null;
}

/** Walks the flow from block `from` until it must wait for the customer, hands over, or ends. */
function run(flow: Flow, from: string | null, vars: Record<string, string>, lang: string, answer: (intent: string) => string): FlowOut {
  const out: FlowOut = { messages: [], buttons: null, state: null, handed: false, done: false };
  let at = from;
  for (let n = 0; n < MAX_STEPS; n++) {
    const i = at ? flow.blocks.findIndex((b) => b.id === at) : -1;
    if (i < 0) { out.done = true; return out; }
    const b: FlowBlock = flow.blocks[i];
    switch (b.type) {
      case 'message': { const t = say(b.text, lang, vars); if (t) out.messages.push(t); at = follow(flow, i, b.next); break; }
      case 'answer': { const t = answer(b.intent); if (t) out.messages.push(t); at = follow(flow, i, b.next); break; }
      case 'question': {
        const t = say(b.text, lang, vars); if (t) out.messages.push(t);
        out.buttons = b.options.map((o) => ({ key: o.id, label: say(o.label, lang, vars) })).filter((o) => o.label);
        out.state = { flow: flow.id, at: b.id, vars, misses: 0 }; return out;
      }
      case 'ask': { const t = say(b.text, lang, vars); if (t) out.messages.push(t); out.state = { flow: flow.id, at: b.id, vars, misses: 0 }; return out; }
      case 'handoff': { const t = say(b.text, lang, vars); if (t) out.messages.push(t); out.handed = true; out.done = true; return out; }
      case 'end': { const t = say(b.text, lang, vars); if (t) out.messages.push(t); out.done = true; return out; }
    }
  }
  out.done = true; return out;
}

/** The customer enters the flow: it runs from the first block. */
export function startFlow(flow: Flow, lang: string, answer: (intent: string) => string): FlowOut {
  return run(flow, flow.blocks[0]?.id ?? null, {}, lang, answer);
}

/** The customer replies while the flow waits: they tapped a choice (`pick`) or typed something (`text`). */
export function continueFlow(flow: Flow, state: FlowState, input: { text?: string; pick?: string }, lang: string, answer: (intent: string) => string): FlowOut {
  const i = flow.blocks.findIndex((b) => b.id === state.at);
  const b = flow.blocks[i];
  if (!b) return { messages: [], buttons: null, state: null, handed: false, done: true };
  if (b.type === 'ask') {
    const v = (input.text ?? '').trim();
    if (!v) return run(flow, b.id, state.vars, lang, answer);                                       // nothing typed: ask again
    return run(flow, follow(flow, i, b.next), { ...state.vars, [b.field]: v.slice(0, 200) }, lang, answer);
  }
  if (b.type === 'question') {
    const typed = (input.text ?? '').trim().toLowerCase();
    const opt = b.options.find((o) => o.id === input.pick)
      ?? (typed ? b.options.find((o) => { const l = say(o.label, lang, state.vars).toLowerCase(); return !!l && (l === typed || typed.includes(l)); }) : undefined);
    if (opt) return run(flow, follow(flow, i, opt.next), state.vars, lang, answer);
    if (state.misses >= 1) return { messages: [], buttons: null, state: null, handed: true, done: true };   // asked twice, still unclear: a person helps
    const again = run(flow, b.id, state.vars, lang, answer);
    if (again.state) again.state = { ...again.state, misses: state.misses + 1 };
    return again;
  }
  return { messages: [], buttons: null, state: null, handed: false, done: true };
}
