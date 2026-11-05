import type { SessionUser } from '../auth/session';
import type { Snapshot } from './snapshot';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** What a signed-in person is allowed to see. Staff get the shared word lists (read only) and only their own merchant. */
export function scopeSnapshot(user: SessionUser, snap: Snapshot): Snapshot {
  if (user.role === 'admin') return snap;
  const m = user.merchant!;
  const out = clone(snap);
  out.kb = out.kb.filter((e) => e.merchant === m);
  out.mAliases = { [m]: out.mAliases[m] ?? [] };
  out.settings = { [m]: out.settings[m] };
  return out;
}

/**
 * Turns what the browser sent into what may be saved.
 * An admin may change everything. Staff may only change their own merchant's entries, short forms, tone and fixed messages.
 * Everything else in the request (other merchants, shared word lists, handoff group, limits, tools, abuse limit) is ignored,
 * so a staff member cannot change it even by sending the request by hand.
 */
export function effectiveSnapshot(user: SessionUser, current: Snapshot, incoming: Snapshot): Snapshot {
  if (user.role === 'admin') return incoming;
  const m = user.merchant!;
  const out = clone(current);
  const mine = (incoming.kb ?? []).filter((e) => e.merchant === m);
  const used = new Set(current.kb.map((e) => e.id));
  let next = Math.max(0, ...current.kb.map((e) => e.id), ...mine.map((e) => e.id)) + 1;
  const owned = new Map(current.kb.filter((e) => e.merchant === m).map((e) => [e.intent_key, e.id]));
  out.kb = [
    ...current.kb.filter((e) => e.merchant !== m),
    ...mine.map((e) => ({ ...clone(e), merchant: m, id: owned.get(e.intent_key) ?? (used.has(e.id) ? next++ : e.id) })),
  ];
  if (Array.isArray(incoming.mAliases?.[m])) out.mAliases[m] = clone(incoming.mAliases[m]).map((a) => ({ ...a }));
  const inc = incoming.settings?.[m], cur = out.settings[m];
  if (inc && cur) {
    if (inc.tone === 'friendly' || inc.tone === 'formal') cur.tone = inc.tone;
    for (const k of ['kind', 'closing', 'handoff'] as const) if (inc[k] && typeof inc[k] === 'object') cur[k] = { ...cur[k], ...clone(inc[k]) };
  }
  return out;
}
