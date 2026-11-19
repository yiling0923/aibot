import { asJson } from '../db/pool';

/** A merchant needs at least this many live, ready answers before the bot is useful. */
export const MIN_READY_ANSWERS = 10;

export type CheckState = 'done' | 'todo' | 'optional' | 'warn';
/** Where a button of the checklist leads: another screen, or a part of the merchant page. */
export type CheckTo = 'users' | 'key' | 'livechat' | 'imp' | 'kb' | 'api' | 'lchat' | 'learn';
export interface CheckItem { key: string; title: string; state: CheckState; detail: string; action?: { to: CheckTo; label: string } }

export interface SetupInput {
  logins: number; activeKeys: number; keyLastUsed: string | null;
  entries: { id: number; status: string; type: string }[];
  translations: { kb_id: number; question_examples: unknown; answer_text: string }[];
  chats: number;
  /** True while the merchant only listens (the bot is silent and learns). */
  listening?: boolean;
}

const TO_WRITE = /^\s*TO WRITE:/i;
/** How many entries the bot can really use, and how many are not ready (draft, "TO WRITE", or fewer than 3 example questions). */
export function readiness(entries: SetupInput['entries'], translations: SetupInput['translations']) {
  const byKb = new Map<number, SetupInput['translations']>();
  for (const t of translations) byKb.set(Number(t.kb_id), [...(byKb.get(Number(t.kb_id)) ?? []), t]);
  let liveReady = 0, drafts = 0, toWrite = 0;
  for (const e of entries) {
    const trs = byKb.get(e.id) ?? [], staff = e.type === 'needs_staff';
    const ready = trs.some((t) => asJson<string[]>(t.question_examples, []).length >= 3 && (staff || ((t.answer_text ?? '').trim() && !TO_WRITE.test(t.answer_text))));
    if (!staff && trs.some((t) => TO_WRITE.test(t.answer_text ?? ''))) toWrite++;
    if (e.status === 'draft') drafts++;
    if (e.status === 'live' && ready) liveReady++;
  }
  return { liveReady, drafts, toWrite, total: entries.length };
}

/** The setup checklist of one merchant: what is done, what is still to do, and where to go for it. */
export function checklist(i: SetupInput): { items: CheckItem[]; done: number; total: number } {
  const r = readiness(i.entries, i.translations); const items: CheckItem[] = [];
  items.push(i.logins > 0
    ? { key: 'login', title: 'Staff login', state: 'done', detail: `${i.logins} staff login${i.logins === 1 ? '' : 's'} can sign in to the panel.` }
    : { key: 'login', title: 'Staff login', state: 'todo', detail: "No staff login yet. The merchant's staff cannot sign in to the panel.", action: { to: 'users', label: 'Add a login' } });
  items.push(i.activeKeys > 0
    ? { key: 'key', title: 'Bot key', state: 'done', detail: 'A bot key is active.' }
    : { key: 'key', title: 'Bot key', state: 'todo', detail: 'No bot key yet. LiveChat cannot use the bot.', action: { to: 'key', label: 'Make key' } });
  items.push(i.keyLastUsed
    ? { key: 'livechat', title: 'LiveChat calls the bot', state: 'done', detail: `LiveChat last called the bot on ${new Date(i.keyLastUsed).toISOString().slice(0, 16).replace('T', ' ')} (UTC).` }
    : { key: 'livechat', title: 'LiveChat calls the bot', state: 'todo', detail: i.activeKeys ? "LiveChat has not called the bot yet. Paste the address and key into this merchant's AI Bot page in LiveChat (the same merchant must exist in LiveChat: it keeps its own list), then press Test the link." : 'Make the bot key first, then put it into LiveChat.', action: { to: 'livechat', label: 'Show the address and key' } });
  if (r.liveReady >= MIN_READY_ANSWERS) items.push({ key: 'answers', title: 'Answers', state: 'done', detail: `${r.liveReady} live answers are ready.` });
  else items.push({ key: 'answers', title: 'Answers', state: 'todo', action: r.total ? { to: 'kb', label: 'Open the knowledge base' } : { to: 'imp', label: 'Open Import' },
    detail: r.total === 0 ? 'No answers yet, so the bot hands every question to a person. Load the starter pack in Import (Starter packs).'
      : `Only ${r.liveReady} live answer${r.liveReady === 1 ? ' is' : 's are'} ready. Aim for at least ${MIN_READY_ANSWERS}.${r.drafts ? ` ${r.drafts} ${r.drafts === 1 ? 'is a draft' : 'are drafts'}: set the good ones live and publish.` : ''}` });
  if (r.toWrite > 0) items.push({ key: 'towrite', title: 'No "TO WRITE" left', state: 'todo', detail: `${r.toWrite} ${r.toWrite === 1 ? 'entry still says' : 'entries still say'} TO WRITE. The bot ignores ${r.toWrite === 1 ? 'it' : 'them'} until the real answer is written.`, action: { to: 'kb', label: 'Open the knowledge base' } });
  else if (r.total > 0) items.push({ key: 'towrite', title: 'No "TO WRITE" left', state: 'done', detail: 'Every answer is written.' });
  items.push(i.chats > 0
    ? { key: 'tried', title: 'Tried it', state: 'done', detail: `${i.chats} chat${i.chats === 1 ? '' : 's'} so far (tests and real customers).` }
    : { key: 'tried', title: 'Tried it', state: 'todo', detail: 'Nobody has chatted with the bot yet. Try it in LiveChat test.', action: { to: 'lchat', label: 'Open LiveChat test' } });
  items.push(i.listening
    ? { key: 'mode', title: 'Bot is listening', state: 'todo', detail: 'The bot is silent and only learns from conversations. When its answers are ready, switch it to answering.', action: { to: 'learn', label: 'Open Learning' } }
    : { key: 'mode', title: 'Bot is answering', state: 'done', detail: 'The bot replies to customers from the live answers.' });
  return { items, done: items.filter((x) => x.state === 'done').length, total: items.length };
}
