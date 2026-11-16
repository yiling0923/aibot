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
  /** A picture or a file the customer attaches (sent like the website widget sends one). */
  file?: { name: string; type: string; data: Uint8Array };
}

/** The field names tried, in this order, for the file in the upload (LiveChat answers 400, 415 or 422 when the name is not the one it reads). */
export const FILE_FIELDS = ['file', 'attachment', 'image'];
/** The upload addresses tried in turn ({id} is the chat). */
export const UPLOAD_PATHS = ['/widget/conversations/{id}/attachments', '/widget/conversations/{id}/uploads', '/widget/conversations/{id}/files', '/widget/attachments', '/widget/uploads', '/widget/upload'];

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
  if (!text && !o.file) return id ? result(id, await read(id), false) : { conversationId: null, status: null, handoff: null, messages: [], replied: false };

  const before = id ? lines(await read(id)).filter((m) => m.from !== 'customer').length : 0;
  const who = o.member === undefined ? { id: 'm-100', name: 'Tester', rank: 'GOLD' } : o.member;       // null: not logged in, so no member fields are sent
  const msg = { visitor_session_id: o.visitor, visitor_name: who?.name ?? 'Guest', body: text, ...(who ? { member_external_id: who.id, member_name: who.name, ...(who.rank ? { member_rank: who.rank } : {}) } : {}) };
  // A file cannot go in the message itself (LiveChat's message address answers "invalid_json" to a form), so it is uploaded to a separate address, as a form.
  // The address was not known when this was written: the likely ones are tried in turn (404 or 405: not this one, try the next; 400, 415 or 422: the address is right but
  // the form field is not, try the next field name) and every answer is kept, so a failure shows exactly what LiveChat said.
  const upload = async (convId: string): Promise<void> => {
    const file = o.file!; const tried: string[] = []; const cid = encodeURIComponent(convId);
    for (const path of UPLOAD_PATHS.map((p) => p.replace('{id}', cid))) {
      for (const field of FILE_FIELDS) {
        const form = new FormData();
        form.append('visitor_session_id', o.visitor); form.append('conversation_id', convId); if (text) form.append('body', text);
        form.append(field, new Blob([file.data as unknown as ArrayBuffer], { type: file.type }), file.name);
        let r: Response;
        try { r = await f(base + path, { method: 'POST', headers: { 'X-Tenant-ID': o.tenant }, body: form, signal: AbortSignal.timeout(30_000) }); }
        catch { throw new Error(`Could not reach LiveChat at ${base}. Is it running?`); }
        const full = await r.text().catch(() => ''); const body = full.slice(0, 200);
        tried.push(`POST ${path} (field "${field}") -> ${r.status} ${body}`.trim());
        if (r.ok) {
          let j: Record<string, any> | null = null; try { j = JSON.parse(full); } catch { /* an answer that is not JSON: the message is assumed to be made */ }   // eslint-disable-line @typescript-eslint/no-explicit-any
          const att = j?.attachment ?? (j?.url ? j : null);
          if (att && !j?.message && !j?.conversation) {                                              // the upload only stored the file: now the message that carries it
            const kind = file.type.startsWith('image/') ? 'image' : 'file';
            await call(`/widget/conversations/${cid}/messages`, 'POST', { ...msg, body: text || file.name, message_type: kind, attachment: att });
          }
          return;
        }
        if (r.status === 404 || r.status === 405) break;                                              // not the address: the next one
        if (![400, 415, 422].includes(r.status)) throw new Error(`LiveChat did not accept the file. ${tried.join(' | ')}`);
      }
    }
    throw new Error(`LiveChat did not accept the file. The addresses and form fields tried were: ${tried.join(' | ')}. Tell the developer this message so the upload can be matched to LiveChat.`);
  };
  if (o.file) {
    if (!id) id = (await call('/widget/conversations', 'POST', { ...msg, body: text || o.file.name }))?.conversation?.publicId ?? null;      // a chat must exist first
    if (!id) throw new Error('LiveChat did not start a chat. Check the tenant id.');
    await upload(id);
  }
  else if (id) await call(`/widget/conversations/${encodeURIComponent(id)}/messages`, 'POST', msg);
  else id = (await call('/widget/conversations', 'POST', msg))?.conversation?.publicId ?? null;
  if (!id) throw new Error('LiveChat did not start a chat. Check the tenant id.');

  const until = Date.now() + (o.waitMs ?? 15_000); let c = await read(id);
  while (lines(c).filter((m) => m.from !== 'customer').length <= before && Date.now() < until) {
    await new Promise((r) => setTimeout(r, o.pollMs ?? 800)); c = await read(id);
  }
  return result(id, c, lines(c).filter((m) => m.from !== 'customer').length > before);
}
