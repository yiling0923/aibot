type Fetch = typeof fetch;
/** A file in a message (a picture an agent sent). The link is complete: LiveChat sends a path like /uploads/abc.jpg and the address of LiveChat is put in front. */
export interface ChatAttachment { kind: string; name: string; url: string; mimeType: string; size: number | null }
export interface ChatLine { from: 'customer' | 'bot' | 'agent' | 'system'; sender: string; text: string; attachment?: ChatAttachment }
export interface ChatResult { conversationId: string | null; status: string | null; handoff: string | null; messages: ChatLine[]; replied: boolean }
export interface ChatOpts {
  /** The LiveChat address, for example http://localhost:8080 */
  baseUrl: string; /** LiveChat's tenant id (the local setup uses 1). */ tenant: string; /** One browser session of a visitor: the same id continues the same chat. */ visitor: string;
  /** What the customer writes. Empty: only read the chat as it is. */ text?: string;
  /** How long to wait for the bot's reply, in milliseconds. */ waitMs?: number; pollMs?: number;
  /** Who the customer is: a logged-in member (as the website would send it), or null for a customer who is not logged in. Missing: a sample member. */
  member?: { id: string; name: string; rank?: string } | null;
}

const kindOf = (sender: string): ChatLine['from'] => (/visitor|customer|member|user/i.test(sender) ? 'customer' : /agent|staff|human|operator/i.test(sender) ? 'agent' : /system|event/i.test(sender) ? 'system' : 'bot');

/**
 * Sends one customer message through a LiveChat the way its website widget does (the same calls as deploy/local-livechat/chat.ps1),
 * waits until the bot has answered, and returns the whole chat. Used by the LiveChat test page of the panel, which cannot call LiveChat
 * from the browser (another address), so the bot server makes the calls.
 */
export async function chatThroughLiveChat(o: ChatOpts, f: Fetch = fetch): Promise<ChatResult> {
  const base = o.baseUrl.trim().replace(/\/+$/, '');
  const headers = { 'X-Tenant-ID': o.tenant, 'content-type': 'application/json' };
  const call = async (path: string, method: 'GET' | 'POST', body?: unknown, okMissing = false): Promise<Record<string, any> | null> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    let r: Response;
    try { r = await f(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) }); }
    catch { throw new Error(`Could not reach LiveChat at ${base}. Is it running?`); }
    if (!r.ok) { if (okMissing && (r.status === 404 || r.status === 400)) return null; throw new Error(`LiveChat answered ${r.status} for ${method} ${path.split('?')[0]}. ${(await r.text().catch(() => '')).slice(0, 200)}`.trim()); }
    return (await r.json().catch(() => null)) as Record<string, any> | null;               // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const q = `visitor_session_id=${encodeURIComponent(o.visitor)}`;
  const read = async (id: string) => (await call(`/widget/conversations/${encodeURIComponent(id)}?${q}`, 'GET'))?.conversation ?? null;
  const attach = (m: any): ChatAttachment | undefined => {                                                          // eslint-disable-line @typescript-eslint/no-explicit-any
    const a = m?.attachment; const u = typeof a?.url === 'string' ? a.url.trim() : ''; if (!u) return undefined;
    const url = /^https?:\/\//i.test(u) ? u : u.startsWith('/') ? base + u : '';                                       // only an http(s) link or a path on LiveChat, never anything else
    return url ? { kind: String(a.kind ?? m.messageType ?? 'file'), name: String(a.name ?? m.body ?? 'file'), url, mimeType: String(a.mimeType ?? ''), size: Number.isFinite(Number(a.size)) ? Number(a.size) : null } : undefined;
  };
  const lines = (c: any): ChatLine[] => (Array.isArray(c?.messages) ? c.messages : []).map((m: any) => ({ from: kindOf(String(m.senderType ?? '')), sender: String(m.senderType ?? ''), text: String(m.body ?? ''), ...(attach(m) ? { attachment: attach(m) } : {}) }));   // eslint-disable-line   // eslint-disable-line @typescript-eslint/no-explicit-any
  const result = (id: string | null, c: any, replied: boolean): ChatResult => ({ conversationId: id, status: c?.status ?? null, handoff: c?.aiHandoffStatus ?? null, messages: lines(c), replied });   // eslint-disable-line @typescript-eslint/no-explicit-any

  const cur = (await call(`/widget/conversations/current?${q}`, 'GET', undefined, true))?.conversation;
  let id: string | null = cur?.publicId ?? null;
  const text = (o.text ?? '').trim();
  if (!text) return id ? result(id, await read(id), false) : { conversationId: null, status: null, handoff: null, messages: [], replied: false };

  const before = id ? lines(await read(id)).filter((m) => m.from !== 'customer').length : 0;
  const who = o.member === undefined ? { id: 'm-100', name: 'Tester', rank: 'GOLD' } : o.member;       // null: not logged in, so no member fields are sent
  const msg = { visitor_session_id: o.visitor, visitor_name: who?.name ?? 'Guest', body: text, ...(who ? { member_external_id: who.id, member_name: who.name, ...(who.rank ? { member_rank: who.rank } : {}) } : {}) };
  if (id) await call(`/widget/conversations/${encodeURIComponent(id)}/messages`, 'POST', msg);
  else id = (await call('/widget/conversations', 'POST', msg))?.conversation?.publicId ?? null;
  if (!id) throw new Error('LiveChat did not start a chat. Check the tenant id.');

  const until = Date.now() + (o.waitMs ?? 15_000); let c = await read(id);
  while (lines(c).filter((m) => m.from !== 'customer').length <= before && Date.now() < until) {
    await new Promise((r) => setTimeout(r, o.pollMs ?? 800)); c = await read(id);
  }
  return result(id, c, lines(c).filter((m) => m.from !== 'customer').length > before);
}
