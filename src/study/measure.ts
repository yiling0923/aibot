import type { Engine } from '../engine/engine';
import { norm } from './clean';
import type { Lang } from '../engine/types';

export interface StudyPair { id: number; question: string; reply: string; split: 'learn' | 'test' }

/** Words used to compare two texts: whole words, or single characters for Chinese. */
const tokens = (s: string) => new Set(norm(s).split(' ').flatMap((w) => (/[一-鿿]/.test(w) ? [...w] : w.length > 1 ? [w] : [])));
/** How much two texts share (0 to 1): twice the shared words over all words. */
const dice = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return (2 * i) / (a.size + b.size); };
/** Staff reply and a merchant answer count as "the same answer" from this much overlap. Staff rarely copy an answer word for word, so this is deliberately forgiving. */
const SAME_ANSWER = 0.4;

export interface Measure {
  /** False when every saved pair was used (a small file has no held-back pairs): the numbers are then too good, because the bot may have been written from the same chats. */
  fair: boolean;
  /** Pairs the bot was tested on (the held-back 20%). */
  tested: number;
  /** Share of the test questions the bot answered by itself. */
  coverage: number | null;
  /** Of the questions where staff sent one of the merchant's own answers: share where the bot picked that same answer. */
  accuracy: number | null; scored: number;
  /** Answers the bot gave that were not the answer staff sent, as a share of the answers it could be checked on. */
  wrongRate: number | null; judged: number;
  handoverRate: number | null; clarifyRate: number | null;
  /** Test questions with a staff reply that matches none of the merchant's answers: the answers that are missing. */
  noAnswerYet: number;
  mistakes: { question: string; staffReply: string; botSaid: string; expected: string }[];
}

export interface Gap { question: string; count: number; topic: string | null; lang: Lang; reply: string; examples: string[] }

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Runs the published bot (rules only, no AI) on the held-back test pairs and compares it with what staff really sent. */
export function measure(engine: Engine, code: string, pairs: StudyPair[], all = false): Measure {
  const entries = engine.entriesOf(code).map((e) => ({ e, tks: Object.values(e.translations).map((t) => tokens(t?.answerText ?? '')).filter((t) => t.size) })).filter((x) => x.tks.length);
  const test = all ? pairs : pairs.filter((p) => p.split === 'test');
  const m: Measure = { fair: !all, tested: test.length, coverage: null, accuracy: null, scored: 0, wrongRate: null, judged: 0, handoverRate: null, clarifyRate: null, noAnswerYet: 0, mistakes: [] };
  let answered = 0, handed = 0, clarify = 0, right = 0, wrong = 0;
  for (const p of test) {
    const r = engine.analyze(p.question, code, 0);
    const reply = tokens(p.reply);
    let best: { intent: string; s: number } | null = null;
    for (const x of entries) { const s = Math.max(...x.tks.map((t) => dice(reply, t))); if (s >= SAME_ANSWER && (!best || s > best.s)) best = { intent: x.e.intentKey, s }; }
    if (!best) m.noAnswerYet++;
    if (r.decision === 'ANSWER') answered++; else if (r.decision === 'HANDOFF' || r.decision === 'REFUSE' || r.decision === 'ACCOUNT') handed++; else if (r.decision === 'CHOICE' || r.decision === 'CLARIFY') clarify++;
    const picked = r.decision === 'ANSWER' ? r.top.intent : null;
    if (best) { m.scored++; if (picked === best.intent) right++; }
    if (picked && best) { m.judged++; if (picked !== best.intent) { wrong++; if (m.mistakes.length < 25) { const g = engine.entry(code, picked); m.mistakes.push({ question: p.question, staffReply: tidy(p.reply).slice(0, 200), botSaid: tidy(Object.values(g?.translations ?? {})[0]?.answerText ?? picked).slice(0, 200), expected: best.intent }); } } }
  }
  const n = test.length;
  if (n) { m.coverage = answered / n; m.handoverRate = handed / n; m.clarifyRate = clarify / n; }
  if (m.scored) m.accuracy = right / m.scored;
  if (m.judged) m.wrongRate = wrong / m.judged;
  return m;
}

const top = <T>(counts: Map<T, number>): T | null => { let best: T | null = null, n = 0; for (const [k, c] of counts) if (c > n) { best = k; n = c; } return best; };

/**
 * The answers that are missing. Questions the bot cannot answer yet are grouped by the staff reply that was sent: one group is one possible answer,
 * with the questions customers asked before it (the examples). They come ONLY from the learn pairs (the test pairs stay untouched, so the test stays honest).
 */
export function gaps(engine: Engine, code: string, pairs: StudyPair[], limit = 30): Gap[] {
  const groups = new Map<string, { reply: string; questions: Map<string, number>; topics: Map<string, number>; langs: Map<Lang, number>; count: number }>();
  for (const p of pairs.filter((x) => x.split === 'learn')) {
    const r = engine.analyze(p.question, code, 0);
    if (r.decision === 'ANSWER' || r.decision === 'SMALLTALK' || r.decision === 'ABUSE' || r.decision === 'CHOICE') continue;       // already handled by the bot
    const key = norm(p.reply);
    const g = groups.get(key) ?? { reply: p.reply, questions: new Map(), topics: new Map(), langs: new Map(), count: 0 };
    g.count++; g.questions.set(p.question, (g.questions.get(p.question) ?? 0) + 1); g.langs.set(r.lang, (g.langs.get(r.lang) ?? 0) + 1);
    if (r.topic) g.topics.set(r.topic, (g.topics.get(r.topic) ?? 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.count >= 1).sort((a, b) => b.count - a.count).slice(0, limit).map((g) => {
    const qs = [...g.questions.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    return { question: qs[0], count: g.count, topic: top(g.topics), lang: top(g.langs) ?? 'en', reply: g.reply, examples: qs.slice(0, 6) };
  });
}
