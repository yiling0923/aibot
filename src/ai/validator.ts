export interface Check { ok: boolean; reason?: string }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const numbers = (s: string) => new Set((s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, '')));
const links = (s: string) => s.match(/(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+/gi) ?? [];
const paths = (s: string) => s.match(/[A-Za-z]\w*(?:\s*>\s*[A-Za-z]\w*)+/g) ?? [];     // "Wallet > Deposit"

/**
 * Checks a reply written by the AI against the facts it was given (the knowledge base answer).
 * It must not contain a number, link or menu path that is not in the facts, and it must keep every number from the facts,
 * so a limit, a time or an amount can never be changed or dropped.
 */
export function checkReply(reply: string, facts: string): Check {
  const r = reply.trim();
  if (!r) return { ok: false, reason: 'empty reply' };
  if (r.length > 700) return { ok: false, reason: 'reply is too long' };
  const f = norm(facts);

  const have = numbers(facts), used = numbers(r);
  for (const n of used) if (!have.has(n)) return { ok: false, reason: `reply has the number ${n}, which is not in the answer` };
  for (const n of have) if (!used.has(n)) return { ok: false, reason: `reply left out the number ${n}` };

  for (const l of links(r)) if (!f.includes(norm(l))) return { ok: false, reason: `reply has a link that is not in the answer: ${l}` };
  for (const p of paths(r)) if (!f.includes(norm(p))) return { ok: false, reason: `reply has a menu path that is not in the answer: ${p.trim()}` };
  return { ok: true };
}
