import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import type { SessionUser } from '../auth/session';
import { readSnapshot, type Snapshot, type SnapEntry, type SnapSettings, type Words } from './snapshot';

/** Publish history is kept per merchant, so every merchant publishes and rolls back on its own.
 *  The word lists shared by all merchants have a history of their own ("shared"). */
export interface MerchantSlice { kb: SnapEntry[]; mAliases: Snapshot['mAliases'][string]; settings: SnapSettings }
export interface SharedSlice { aliases: Words; aspects: Words; smalltalk: Words; guard: Words; fillers: Snapshot['fillers'] }
export type Scope = { kind: 'merchant'; code: string } | { kind: 'shared' };

const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export const merchantSlice = (s: Snapshot, code: string): MerchantSlice => ({ kb: s.kb.filter((e) => e.merchant === code), mAliases: s.mAliases[code] ?? [], settings: s.settings[code] });
export const sharedSlice = (s: Snapshot): SharedSlice => ({ aliases: s.aliases, aspects: s.aspects, smalltalk: s.smalltalk, guard: s.guard, fillers: s.fillers });

/** Puts a saved merchant slice into a snapshot (a copy is returned). */
export function withMerchantSlice(s: Snapshot, code: string, slice: MerchantSlice): Snapshot {
  const out = clone(s);
  out.kb = [...out.kb.filter((e) => e.merchant !== code), ...slice.kb.map((e) => ({ ...e, merchant: code }))];
  out.mAliases[code] = slice.mAliases; out.settings[code] = slice.settings;
  return out;
}
export function withSharedSlice(s: Snapshot, slice: SharedSlice): Snapshot {
  return { ...clone(s), aliases: slice.aliases, aspects: slice.aspects, smalltalk: slice.smalltalk, guard: slice.guard, fillers: slice.fillers };
}

/* ---------- has anything really changed? (ids, update times, empty languages and key order do not count) ---------- */
const sortKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sortKeys(x)])) : v;
const words = (w: Words | Record<string, string[]>): unknown => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Array.isArray(v) ? v : words(v as Words)])
  .filter(([, v]) => (Array.isArray(v) ? v.length : Object.keys(v as object).length)));
const texts = (m: Record<string, string> | undefined) => Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => v));
const sig = (v: unknown) => JSON.stringify(sortKeys(v));
export const merchantSig = (sl: MerchantSlice) => sig({
  kb: sl.kb.map((e) => ({ k: e.intent_key, c: e.category, t: e.topic, a: e.aspect || null, o: !!e.topic_optional, s: e.status,
    tr: Object.fromEntries(Object.entries(e.translations).filter(([, t]) => t && ((t.answer_text || '').trim() || (t.question_examples || []).length))) })).sort((a, b) => (a.k < b.k ? -1 : 1)),
  m: sl.mAliases.map((a) => `${a.language}|${a.variant}|${a.canonical}`).sort(),
  s: { ...sl.settings, kind: texts(sl.settings?.kind), closing: texts(sl.settings?.closing), handoff: texts(sl.settings?.handoff) },
});
export const sharedSig = (sl: SharedSlice) => sig({ a: words(sl.aliases), s: words(sl.aspects), t: words(sl.smalltalk), g: words(sl.guard), f: words(sl.fillers) });

/* ---------- reading and writing versions ---------- */
async function merchantIds(pool: Pool): Promise<Map<string, number>> {
  return new Map((await q(pool, "SELECT id, code FROM merchants WHERE status = 'active'")).map((m) => [m.code as string, Number(m.id)]));
}
const latest = async (pool: Pool, scope: Scope, ids: Map<string, number>) => {
  const [r] = scope.kind === 'merchant'
    ? await q(pool, "SELECT COALESCE(MAX(version), 0) AS v FROM kb_versions WHERE kind = 'merchant' AND merchant_id = ?", [ids.get(scope.code)])
    : await q(pool, "SELECT COALESCE(MAX(version), 0) AS v FROM kb_versions WHERE kind = 'shared'");
  return Number(r.v);
};

/** Saves a new version for one merchant (or the shared lists) and returns its number. */
export async function recordVersion(pool: Pool, scope: Scope, actor: string, summary: string, slice: MerchantSlice | SharedSlice): Promise<number> {
  const ids = await merchantIds(pool);
  const ver = (await latest(pool, scope, ids)) + 1;
  await pool.query('INSERT INTO kb_versions(kind, merchant_id, version, actor, summary, snapshot) VALUES(?,?,?,?,?,?)',
    [scope.kind, scope.kind === 'merchant' ? ids.get(scope.code) : null, ver, actor, summary.slice(0, 500), JSON.stringify(slice)]);
  return ver;
}

/** Every merchant and the shared lists get a first version, so there is always something to roll back to. */
export async function ensureVersions(pool: Pool): Promise<void> {
  const ids = await merchantIds(pool); let snap: Snapshot | null = null;
  for (const [code] of ids) {
    if (await latest(pool, { kind: 'merchant', code }, ids)) continue;
    snap ??= await readSnapshot(pool);
    if (snap.settings[code]) await recordVersion(pool, { kind: 'merchant', code }, 'system', 'Template data loaded', merchantSlice(snap, code));
  }
  if (!(await latest(pool, { kind: 'shared' }, ids))) await recordVersion(pool, { kind: 'shared' }, 'system', 'Template data loaded', sharedSlice(snap ?? (await readSnapshot(pool))));
}

export interface HistoryRow { id: number; kind: 'merchant' | 'shared'; merchant: string | null; version: number; actor: string; summary: string; created_at: Date }

/** The live version of each merchant a person may see (and of the shared lists, for an admin), plus the history rows. */
export async function versionState(pool: Pool, user: SessionUser, codes: string[]) {
  const ids = await merchantIds(pool);
  const versions: Record<string, number> = {};
  for (const code of codes) versions[code] = await latest(pool, { kind: 'merchant', code }, ids);
  const sharedVer = user.role === 'admin' ? await latest(pool, { kind: 'shared' }, ids) : null;
  const rows = await q<RowDataPacket>(pool, `SELECT v.id, v.kind, m.code AS merchant, v.version, v.actor, v.summary, v.created_at FROM kb_versions v LEFT JOIN merchants m ON m.id = v.merchant_id
    WHERE v.kind <> 'legacy' ${user.role === 'admin' ? '' : "AND v.kind = 'merchant' AND m.code = ?"} ORDER BY v.id DESC LIMIT 200`, user.role === 'admin' ? [] : [user.merchant]);
  const [s] = await q(pool, "SELECT COALESCE(MAX(id), 0) AS id FROM kb_versions WHERE kind <> 'legacy'");
  return { versions, sharedVer, stamp: Number(s.id), history: rows as unknown as HistoryRow[] };
}
