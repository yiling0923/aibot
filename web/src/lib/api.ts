export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Calls the bot server. Send a body to POST JSON, leave it out to GET. A signed-out person is sent to the login page. */
export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401 && !path.startsWith('/api/auth/login')) { window.location.assign('/login'); throw new ApiError('Please sign in.', 401); }
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(j.error || r.statusText, r.status);
  }
  return r.json() as Promise<T>;
}

export const LANGS = ['en', 'ms', 'zh'] as const;
export type Lang = (typeof LANGS)[number];
export const LN: Record<string, string> = { en: 'EN', ms: 'MS', zh: 'ZH' };
