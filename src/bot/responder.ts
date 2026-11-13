import type { AnalyzeResult, Knowledge, KbEntry, Lang, Option } from '../engine/types';
import { Engine } from '../engine/engine';
import { checkToken, type TokenCheck } from './token';
import { fakeMerchantApi, type MerchantApi, type Tx } from './merchantApi';
import * as Texts from './texts';
import { PICK_MIN_CONFIDENCE, type AiService } from '../ai/types';
import { checkReply } from '../ai/validator';
import { matchChoice } from './choices';

/** The texts are looked up by language, tone and key at run time, so they are used untyped here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const T: any = Texts;

/** One chat. The server keeps this between messages; the website only sends the signed token once. */
export interface Session {
  id: string; merchant: string; token: string | null;
  /** Who the customer is, when the channel (LiveChat) says so. Used for account answers instead of the signed token. */
  member?: { id: string; name: string; rank?: string } | null;
  draft: string | null; misses: number; abuseCount: number; lastTopic: string | null; clarifyCount: number; pending: string | null; closed: boolean; handed: boolean;
  /** What the bot last offered as choices, so the customer can answer with a word, a number or "the first one". */
  choices?: Button[] | null;
  /** The language of the last turn. */
  lang?: Lang | null;
  /** The kind of question the bot asked last, so it never asks twice: reask (not understood), clarify (two answers close), topics (two topics close), menu (which question about this topic). Null when nothing is open. */
  askKind?: 'reask' | 'clarify' | 'topics' | 'menu' | null;
  /** A channel that remembers replies by the words of the question (LiveChat) must never carry one customer's personal data to another: no account answers in a reply. */
  noPersonal?: boolean;
  /** Where the customer writes from (livechat, whatsapp, …). An entry may have its own wording for a channel. */
  channel?: string;
}
export const newSession = (id: string, merchant: string, token: string | null, draft: string | null = null): Session =>
  ({ id, merchant, token, draft, misses: 0, abuseCount: 0, lastTopic: null, clarifyCount: 0, pending: null, closed: false, handed: false });

export interface BotMsg { kind: 'bot' | 'sys' | 'sys warn' | 'sys bad'; text: string }
export interface Button { kind: 'intent' | 'topic' | 'status' | 'amt' | 'agent'; key: string; label: string; amt?: number }
export interface AccountInfo { chk: TokenCheck; verified: boolean; kind: string; agent: boolean; text: string; call?: string; json?: string; rows: Tx[] }

/** Everything the chat page needs: what to show the customer, and the steps for the "what the bot did" panel. */
export interface Turn {
  messages: BotMsg[]; buttons: Button[] | null; locked: boolean; status: string | null;
  trace: Record<string, unknown>;
  /** True when the reply depends on nothing but the words of the question (a plain answer): a channel that remembers replies by question may keep it. */
  cacheable?: boolean;
  /** A line to show after the choices ("if you need other help, contact an agent"). Null when it is off or there are no choices. */
  hint?: string | null;
  /** For the keyword store and the review list. */
  log: { text: string; lang: Lang; decision: string; notUnderstood: boolean } | null;
}

const ACCT_TOPICS = ['balance', 'transactions', 'points'];
const TOOLNAME: Record<string, string> = { balance: 'get_balance', transactions: 'get_recent_transactions', points: 'get_points' };
const sp = (lang: Lang) => (lang === 'zh' ? '' : ' ');   // Chinese has no space between sentences (Thai and Vietnamese do)

export class Bot {
  readonly engine: Engine;
  constructor(public readonly knowledge: Knowledge, private api: MerchantApi = fakeMerchantApi(), private ai?: AiService) { this.engine = new Engine(knowledge); }

  /** Who the customer is: the member the channel sent, else the signed token, else nobody. */
  private who(s: Session): TokenCheck { if (s.noPersonal) return { state: 'none' }; return s.member ? { state: 'valid', id: String(s.member.id), name: s.member.name } : checkToken(s.token); }

  /* ---------- small helpers ---------- */
  private cfg(s: Session) { return this.engine.merchant(s.merchant); }
  private ans(merchant: string, intent: string, lang: Lang, channel?: string) {
    const e: KbEntry | undefined = this.engine.entry(merchant, intent);
    const over = channel ? e?.channelAnswers?.[channel]?.[lang]?.trim() : '';       // a wording written for this channel wins
    if (over) return over;
    return e?.translations[lang]?.answerText || e?.translations.en?.answerText || '';
  }
  private wrap(s: Session, text: string, lang: Lang) { const t = T.TONE[this.cfg(s).tone]; return t.pre[lang] + text + t.post[lang]; }
  private label(o: { kind: string; key: string; amt?: number }, lang: Lang): string {
    if (o.kind === 'agent') return T.AGENT[lang];
    if (o.kind === 'status') return T.STATUS_LABEL[o.key][lang];
    if (o.kind === 'amt') return T.AMT_LABEL[o.key][lang](T.fmtAmt(o.amt!));
    if (o.kind === 'topic') return T.cap(T.tlab(o.key, lang));
    return T.cap(T.lblOf(o.key, lang));
  }
  private buttons(opts: { kind: string; key: string; amt?: number }[], lang: Lang): Button[] {
    return [...opts, { kind: 'agent', key: 'agent' }].map((o) => ({ kind: o.kind as Button['kind'], key: o.key, amt: o.amt, label: this.label(o, lang) }));
  }
  private handoff(s: Session, lang: Lang): { messages: BotMsg[]; status: string } {
    s.handed = true; const c = this.cfg(s);
    return { messages: [{ kind: 'bot', text: c.handoff[lang] ?? c.handoff.en ?? '' }, { kind: 'sys warn', text: `Transferred to human agents · group ${c.handoffGroupId}` }], status: 'Agent joining…' };
  }
  private kindReply(s: Session, lang: Lang, n: number) {
    const c = this.cfg(s); const custom = c.kindReply[lang]; if (custom && custom.trim()) return custom;
    const a = T.KIND_DEF[c.tone][lang]; return a[Math.min(n - 1, a.length - 1)];
  }

  /* ---------- account lookups (token checked, customer id never taken from the message) ---------- */
  private account(s: Session, kind: string, lang: Lang, kbAnswer: string): AccountInfo {
    const c = this.cfg(s), tone = T.TONE[c.tone], chk = this.who(s);
    const res: AccountInfo = { chk, verified: chk.state === 'valid', kind, agent: false, text: '', rows: [] };
    if (chk.state !== 'valid') {
      res.text = tone.pre[lang] + (ACCT_TOPICS.includes(kind) ? '' : kbAnswer + sp(lang)) + T.NOTVER[lang]; res.agent = true; return res;
    }
    const a = this.api.getAccount(s.merchant, chk.id);
    if (ACCT_TOPICS.includes(kind)) {
      res.call = `${TOOLNAME[kind]}(customer_id=${chk.id})`; let body: string;
      if (kind === 'balance') { res.json = JSON.stringify({ balance: a?.balance }); body = a?.balance ? T.TXT_BAL[lang](a.balance) : T.NODATA[lang]; }
      else if (kind === 'points') { res.json = JSON.stringify({ points: a?.points, level: a?.level }); body = a?.points ? T.TXT_PTS[lang](a.points, a.level) : T.NODATA[lang]; }
      else {
        const l = (a?.transactions ?? []).slice(0, 3);
        res.json = JSON.stringify(l.map((x) => ({ ref: x.ref, type: x.type, amount: x.amount, status: x.status })));
        body = l.length ? T.TXT_TXN[lang] + '\n' + l.map((x) => `• ${T.TYPE_W[x.type!][lang]} ${x.amount}, ${T.whenT(x, lang)}, ${T.STS[x.status][lang]} (${x.ref})`).join('\n') : T.NODATA[lang];
      }
      res.text = T.ACCT_PRE[c.tone][lang](chk.name) + body + (kind === 'transactions' ? '' : tone.post[lang]);
      return res;
    }
    const list = (kind === 'deposit' ? a?.deposits : a?.withdrawals) ?? [];
    res.call = `get_recent_${kind === 'deposit' ? 'deposits' : 'withdrawals'}(customer_id=${chk.id})`; res.rows = list.slice(0, 2);
    const kw = T.KIND_W[kind][lang]; let body: string; const x = list[0];
    if (!x) body = T.NOTX[lang](kw) + sp(lang) + kbAnswer;
    else {
      body = T.SENT[lang](kw, x.amount, x.ref, T.whenT(x, lang), T.ST[x.status][lang]);
      if (x.status === 'pending' || x.status === 'processing') body += sp(lang) + kbAnswer;
      if (x.status === 'failed') { body += T.FAILHINT[lang]; res.agent = true; }
    }
    res.text = T.ACCT_PRE[c.tone][lang](chk.name) + body + tone.post[lang];
    return res;
  }

  private amountAnswer(s: Session, kind: 'deposit' | 'withdraw', amt: number, lang: Lang) {
    const c = this.cfg(s), lim = c.limits[kind], a = T.fmtAmt(amt), parts: string[] = [];
    if (lim) { const [lo, hi] = lim; parts.push(amt < lo ? T.LIM_LOW[lang](a, T.KIND_W[kind][lang], T.fmtAmt(lo)) : amt > hi ? T.LIM_HIGH[lang](a, T.fmtAmt(hi)) : T.LIM_OK[lang](a, T.fmtAmt(lo), T.fmtAmt(hi))); }
    const how = this.ans(s.merchant, kind + '_how', lang); if (how) parts.push(how);
    parts.push(T.GUIDE_ONLY[lang]);
    return this.wrap(s, parts.join(sp(lang)), lang);
  }

  private amountCheck(s: Session, amt: number, lang: Lang): AccountInfo {
    const c = this.cfg(s), tone = T.TONE[c.tone], chk = this.who(s);
    const res: AccountInfo = { chk, verified: chk.state === 'valid', kind: 'check', agent: true, text: '', rows: [] };
    if (chk.state !== 'valid') { res.text = tone.pre[lang] + T.NOTVER[lang]; return res; }
    const list = this.api.getAccount(s.merchant, chk.id)?.transactions ?? [];
    res.call = `get_recent_transactions(customer_id=${chk.id})`;
    res.json = JSON.stringify(list.map((x) => ({ ref: x.ref, type: x.type, amount: x.amount, status: x.status })));
    const num = (v: string) => parseFloat(String(v).replace(/[^0-9.]/g, ''));
    const hit = list.find((x) => num(x.amount) === amt);
    if (hit) { res.agent = hit.status === 'failed'; res.text = T.ACCT_PRE[c.tone][lang](chk.name) + T.FOUND_TX[lang] + '\n• ' + `${T.TYPE_W[hit.type!][lang]} ${hit.amount}, ${T.whenT(hit, lang)}, ${T.STS[hit.status][lang]} (${hit.ref})`; }
    else res.text = T.ACCT_PRE[c.tone][lang](chk.name) + T.NOTFOUND_TX[lang](T.fmtAmt(amt));
    return res;
  }

  private choiceMenu(s: Session, topic: string, lang: Lang) {
    const opts: { kind: string; key: string }[] = this.engine.intentsOfTopic(s.merchant, topic).map((k) => ({ kind: 'intent', key: k }));
    if (this.who(s).state === 'valid' && (topic === 'deposit' || topic === 'withdraw')) opts.push({ kind: 'status', key: topic });
    return { message: { kind: 'bot' as const, text: T.CHOICE_TXT[lang](T.tlab(topic, lang)) }, buttons: this.buttons(opts, lang) };
  }

  /* ---------- a typed message ---------- */
  async message(s: Session, rawText: string): Promise<Turn | null> {
    const typed = rawText.trim(); if (!typed || s.closed) return null;
    // The customer may answer the choices in their own words: "deposit", "depo", "2", "the first one". That is an answer, not a new question.
    if (!s.handed && s.choices?.length) {
      const hit = matchChoice(typed, s.choices);
      if (hit) { const picked = this.pick(s, { kind: hit.kind, key: hit.key, amt: hit.amt, label: hit.label, lang: s.lang ?? this.cfg(s).defaultLanguage }); if (picked) { picked.trace = { ...picked.trace, typedReply: typed }; return picked; } }
    }
    const turn = await this.messageCore(s, rawText);
    return turn && this.finish(s, turn, (turn.log?.lang ?? (turn.trace.lang as Lang | undefined) ?? this.cfg(s).defaultLanguage) as Lang);
  }

  /** At most the merchant's number of choices (3 or fewer; "Talk to an agent" is extra and not counted), then the line after them. */
  private finish(s: Session, turn: Turn, lang: Lang): Turn {
    s.lang = lang; s.choices = null;
    if (turn.buttons?.length && s.noPersonal) turn.buttons = turn.buttons.filter((b) => b.kind !== 'status' && !(b.kind === 'amt' && b.key === 'check'));     // no account checks in a channel that remembers replies
    if (!turn.buttons?.length) { turn.buttons = null; return turn; }
    const c = this.cfg(s), max = Math.max(1, Math.min(3, Math.round(c.maxChoices || 3)));
    const agent = turn.buttons.filter((b) => b.kind === 'agent'), opts = turn.buttons.filter((b) => b.kind !== 'agent');
    let kept = opts;
    if (opts.length > max) {                                  // an account check ("where is my deposit") keeps its place; the rest are cut from the end
      const special = opts.filter((b) => b.kind === 'status' || (b.kind === 'amt' && b.key === 'check')), rest = opts.filter((b) => !special.includes(b));
      const keepSpecial = special.slice(0, max), room = max - keepSpecial.length;
      const set = new Set([...rest.slice(0, room), ...keepSpecial]);
      kept = opts.filter((b) => set.has(b));
    }
    turn.buttons = [...kept, ...agent];
    turn.hint = c.moreHelpOn && kept.length ? (c.moreHelp[lang]?.trim() || T.MORE_HELP[lang]) : null;
    if (kept.length < opts.length) turn.trace = { ...turn.trace, choicesCut: { shown: kept.length, had: opts.length, max } };
    s.choices = turn.buttons;                                  // what the customer may answer in their own words next
    return turn;
  }

  private async messageCore(s: Session, rawText: string): Promise<Turn | null> {
    const text = rawText.trim(); if (!text || s.closed) return null;
    const c = this.cfg(s);
    if (s.handed) return {
      messages: [{ kind: 'sys', text: 'The chat is with a human agent. The bot no longer replies.' }], buttons: null, locked: false, status: null,
      trace: { kind: 'skipped', note: 'Skipped: this chat is already with a human agent.' },
      log: { text, lang: this.engine.analyze(text, s.merchant, 0).lang, decision: 'HANDED', notUnderstood: false },
    };
    // A new message that is already clear on its own is NOT glued to the earlier unclear one.
    let query = text;
    if (s.pending) { const alone = this.engine.analyze(text, s.merchant, s.clarifyCount); if (['CHOICE', 'CLARIFY', 'HANDOFF'].includes(alone.decision)) query = s.pending + ' ' + text; }
    s.pending = null;
    let r = this.engine.analyze(query, s.merchant, s.clarifyCount, { lastTopic: s.lastTopic }); r.raw = text;
    // A second chance for a message no keyword matched: Claude may know which entry it is about. Its pick is checked
    // against the real entry list, and a low confidence is ignored, so the bot then asks again or hands off as before.
    let aiInfo: Record<string, unknown> | null = null;
    const unclear = r.decision === 'HANDOFF' && r.via === 'similarity' && !r.guard && !r.ks.T.length && !r.ks.A.length;
    const aiTry = unclear || (r.decision === 'CLARIFY' && r.via === 'similarity');          // nothing matched, or two answers are close: let the AI pick from a short list
    if (aiTry && this.ai?.canPick) {
      // The AI picks an answer from a SHORT list, never from the whole knowledge base: the entries of the topics the keywords point to, else the closest ones by their sample questions.
      const all = this.engine.entriesOf(s.merchant), byId = new Map(all.map((e) => [e.id, e] as const));
      const topics = new Set(r.topicScores.filter((t) => t.score >= 0.5).map((t) => t.topic));
      let pool = topics.size ? all.filter((e) => topics.has(e.topic)) : [];
      if (!pool.length) pool = r.cands.filter((x) => x.score > 0).slice(0, r.decision === 'CLARIFY' ? 4 : 8).map((x) => byId.get(x.id)!).filter(Boolean);
      if (!pool.length) pool = all.slice(0, 12);
      const pick = await this.ai.pickEntry({
        merchant: s.merchant, merchantName: c.name, text: query, lang: r.lang, keywords: r.keywords.map((k) => k.word), topics: [...topics],
        entries: pool.map((e) => ({ key: e.intentKey, topic: e.topic, aspect: e.aspect, examples: e.translations[r.lang]?.questionExamples ?? e.translations.en?.questionExamples ?? [] })),
      });
      const e = pick && pick.confidence >= PICK_MIN_CONFIDENCE ? this.engine.entry(s.merchant, pick.intent) : undefined;
      if (pick && e) {
        r = { ...r, decision: 'ANSWER', via: 'ai', conf: pick.confidence, topic: e.topic, options: [], top: { id: e.id, intent: e.intentKey, score: pick.confidence, example: '(Claude)' }, answerId: e.id,
          why: `The rules were not sure, so Claude picked "${e.intentKey}" from a short list (${Math.round(pick.confidence * 100)}% sure).` };
        aiInfo = { picked: e.intentKey, confidence: pick.confidence };
      } else aiInfo = { picked: null, confidence: pick ? pick.confidence : null };
    }
    if (s.noPersonal) {                                  // see Session.noPersonal: a general answer is fine, an answer about this customer's own account is for staff
      if (r.decision === 'ACCOUNT') r = { ...r, decision: 'HANDOFF', conf: 0.9, why: 'The customer asks for their own account data (needs staff). This channel remembers replies by their words, so it could reach another customer: no personal data is written here.' };
      if (r.account) r = { ...r, account: null };
    }
    if (r.decision === 'ANSWER' && /^(deposit|withdraw)/.test(r.top.intent)) s.lastTopic = r.top.intent.startsWith('deposit') ? 'deposit' : 'withdraw';
    if (r.decision === 'CHOICE' && (r.topic === 'deposit' || r.topic === 'withdraw')) s.lastTopic = r.topic;
    // Not understood = no topic or question word was found at all. The first time, ask again; only a second miss goes to a human.
    // (A message that names a topic the merchant has no answer for is not a miss: it goes to a human straight away.)
    const miss = r.decision === 'HANDOFF' && r.via === 'similarity' && !r.guard && !r.ks.T.length && !r.ks.A.length;
    let reask = miss && s.misses < 1 && s.clarifyCount === 0 && !(s.askKind && s.askKind !== 'menu');
    if (miss) s.misses++; else if (r.decision !== 'HANDOFF') s.misses = 0;
    // The clarify rule of the plan: one question with up to 3 choices, then a person. It never asks twice.
    // "Which question about this topic?" (menu) is part of the answer once the topic is known; it may follow any other question, but not itself.
    let asking: Session['askKind'] = reask ? 'reask' : r.decision === 'CLARIFY' ? 'clarify' : r.decision === 'AMOUNT' && !r.dir ? 'clarify'
      : r.decision === 'CHOICE' ? (r.options.some((o) => o.kind === 'topic') ? 'topics' : 'menu') : null;
    const prevAsk = s.askKind ?? null;
    if (asking && (asking === 'menu' ? prevAsk === 'menu' : !!prevAsk && prevAsk !== 'menu')) {
      r = { ...r, decision: 'HANDOFF', conf: r.conf, why: 'The bot already asked once and it is still unclear, so a person takes over. It never asks twice.' }; reask = false; asking = null;
    }
    if (r.decision === 'ANSWER' && this.engine.entry(s.merchant, r.top.intent)?.entryType === 'needs_staff') r = { ...r, decision: 'HANDOFF', why: `"${r.top.intent}" is marked "needs staff" in the knowledge base, so a person answers this, not the bot.` };
    const lang = r.lang;
    const out: { kbAnswer?: string; acct?: AccountInfo; small?: string; strike?: number; limit?: number; close?: boolean } = {};
    if (r.decision === 'ANSWER') out.kbAnswer = this.ans(s.merchant, r.top.intent, lang, s.channel);
    if (r.decision === 'ANSWER' && r.account) out.acct = this.account(s, r.account.kind, lang, out.kbAnswer ?? '');
    if (r.decision === 'ACCOUNT') out.acct = this.account(s, r.topic!, lang, '');
    if (r.decision === 'SMALLTALK') out.small = T.SMALL_REPLY[c.tone][r.small!][lang];
    if (r.decision === 'ABUSE') { s.abuseCount++; out.strike = s.abuseCount; out.limit = c.abuseCloseAfter; out.close = out.limit > 0 && s.abuseCount >= out.limit; }

    const turn: Turn = {
      messages: [], buttons: null, locked: false, status: null, log: null,
      trace: { kind: 'message', decision: r.decision, why: r.why, conf: r.conf, lang, via: r.via, normalized: r.normalized, hits: r.hits, raw: text,
        abuseHit: r.abuseHit, guard: r.guard, ks: { T: r.ks.T, A: r.ks.A }, kw: r.keywords.map((k) => k.word), keywords: r.keywords, topicScores: r.topicScores, answerId: r.answerId, cands: r.cands.slice(0, 3), top: r.top, small: r.small, smallFallback: r.smallFallback,
        amt: r.amt, dir: r.dir, ctxDir: r.ctxDir, topic: r.topic, options: r.options.map((o) => ({ ...o, label: this.label(o, lang) })),
        kbAnswer: out.kbAnswer, smallText: out.small, strike: out.strike, limit: out.limit, close: out.close,
        acct: out.acct ? { chk: out.acct.chk, verified: out.acct.verified, call: out.acct.call, json: out.acct.json, rows: out.acct.rows } : null,
        merchant: { name: c.name, tone: c.tone, handoffGroupId: c.handoffGroupId }, agentLabel: T.AGENT[lang],
        amtButtons: r.decision === 'AMOUNT' && !r.dir && r.amt ? this.amountOptions(r, lang).map((o) => this.label(o, lang)) : null },
    };
    const say = (t: string) => turn.messages.push({ kind: 'bot', text: t });
    switch (r.decision) {
      case 'ANSWER':
        s.clarifyCount = 0;
        if (out.acct) { say(out.acct.text); if (out.acct.agent) turn.buttons = this.buttons([], lang); } else say(await this.composeReply(s, text, out.kbAnswer!, lang, turn));
        break;
      case 'AMOUNT':
        if (r.dir) { s.lastTopic = r.dir; say(this.amountAnswer(s, r.dir, r.amt!.n, lang)); }
        else { const a = T.fmtAmt(r.amt!.n); say(r.ctxDir ? T.AMT_ASK2[lang](a, r.ctxDir) : T.AMT_ASK[lang](a)); turn.buttons = this.buttons(this.amountOptions(r, lang), lang); }
        break;
      case 'ACCOUNT': say(out.acct!.text); if (out.acct!.agent) turn.buttons = this.buttons([], lang); break;
      case 'REFUSE': {
        const hint = /password|kata laluan|密码/i.test(text) ? ' ' + this.ans(s.merchant, 'forgot_password', lang) : '';
        say(T.REFUSE_TXT[c.tone][lang] + hint); turn.buttons = this.buttons([], lang); break; }
      case 'SMALLTALK': say(out.small!); if (r.options.length) turn.buttons = this.buttons(r.options, lang); break;
      case 'CHOICE':
        s.clarifyCount = 0; s.pending = query;                   // a typed reply ("how long") is read together with this message
        if (r.topic) { const m = this.choiceMenu(s, r.topic, lang); turn.messages.push(m.message); turn.buttons = m.buttons; }
        else { say(T.PICK_TXT[lang]); turn.buttons = this.buttons(r.options, lang); }
        break;
      case 'CLARIFY': {
        s.clarifyCount++; s.pending = query;
        const [a, b] = r.options.map((o) => (o.kind === 'topic' ? T.tlab(o.key, lang) : T.lblOf(o.key, lang))); say(T.CLARIFY_TXT[lang](a, b)); turn.buttons = this.buttons(r.options, lang); break; }
      case 'HANDOFF': {
        if (reask) {
          s.pending = query;                                      // the next message is read together with this one
          say(T.REASK_TXT[c.tone][lang]); turn.buttons = this.buttons(this.engine.topicButtons(s.merchant), lang);
          turn.trace = { ...turn.trace, decision: 'REASK', why: 'Nothing in the message matched a topic or a question, so the bot asks again once before it hands off. A second miss goes to a human.',
            options: this.engine.topicButtons(s.merchant).map((o) => ({ ...o, label: this.label(o, lang) })) };
          break;
        }
        const h = this.handoff(s, lang); turn.messages.push(...h.messages); turn.status = h.status; break; }
      case 'ABUSE':
        if (out.close) {
          s.closed = true; say(c.closing[lang] ?? c.closing.en ?? ''); turn.messages.push({ kind: 'sys bad', text: `Chat closed after ${out.strike} rude messages` });
          turn.locked = true; turn.status = 'Chat closed';
        } else { say(this.kindReply(s, lang, out.strike!)); turn.buttons = this.buttons(this.engine.topicButtons(s.merchant), lang); }
        break;
    }
    if (aiInfo || turn.trace.ai) turn.trace.ai = { ...(aiInfo ?? {}), ...((turn.trace.ai as object) ?? {}) };
    turn.log = { text, lang, decision: reask ? 'REASK' : r.decision, notUnderstood: unclear || (r.decision === 'HANDOFF' && r.via === 'similarity' && !r.guard) };
    // what is open now: the question just asked, or nothing once the customer has an answer (a greeting or a rude word leaves it as it was)
    s.askKind = asking ?? (['ANSWER', 'ACCOUNT', 'HANDOFF'].includes(r.decision) || (r.decision === 'AMOUNT' && !!r.dir) ? null : (s.askKind ?? null));
    turn.cacheable = r.decision === 'ANSWER' && r.via !== 'ai' && query === text && !out.acct;       // depends only on the words of the question
    turn.trace.askKind = s.askKind;
    return turn;
  }

  /** ChatGPT phrases the knowledge base answer. If it is off, fails, or the checker finds a changed fact, the standard wording is used. */
  private async composeReply(s: Session, customerText: string, facts: string, lang: Lang, turn: Turn): Promise<string> {
    const c = this.cfg(s);
    if (this.ai?.canWrite && facts) {
      const w = await this.ai.writeReply({ merchant: s.merchant, merchantName: c.name, tone: c.tone, lang, customerText, facts });
      if (w) {
        const v = checkReply(w, facts);
        if (v.ok) { turn.trace.ai = { ...((turn.trace.ai as object) ?? {}), written: true }; return w.trim(); }
        turn.trace.ai = { ...((turn.trace.ai as object) ?? {}), written: false, rejected: v.reason };
      } else turn.trace.ai = { ...((turn.trace.ai as object) ?? {}), written: false };
    }
    return this.wrap(s, facts, lang);
  }

  private amountOptions(r: AnalyzeResult, lang: Lang) {
    void lang;
    const order = r.ctxDir ? [r.ctxDir, r.ctxDir === 'deposit' ? 'withdraw' : 'deposit'] : ['deposit', 'withdraw'];
    return order.map((k) => ({ kind: 'amt', key: k, amt: r.amt!.n })).concat([{ kind: 'amt', key: 'check', amt: r.amt!.n }]);
  }

  /* ---------- a tapped button (fixed value, so no guessing and no search) ---------- */
  pick(s: Session, p: { kind: string; key: string; amt?: number; label: string; lang: Lang }): Turn | null {
    const turn = this.pickCore(s, p);
    return turn && this.finish(s, turn, p.lang);
  }

  private pickCore(s: Session, p: { kind: string; key: string; amt?: number; label: string; lang: Lang }): Turn | null {
    if (s.closed || s.handed) return null;
    const { kind, key, lang, label } = p; const c = this.cfg(s);
    const pending = s.pending; s.pending = null; s.clarifyCount = 0; s.misses = 0; s.askKind = null;                       // the customer answered the question
    const turn: Turn = { messages: [], buttons: null, locked: false, status: null, log: null, cacheable: false, trace: { kind: 'pick', pickKind: kind, key, label, lang, merchant: { name: c.name, tone: c.tone, handoffGroupId: c.handoffGroupId }, agentLabel: T.AGENT[lang] } };
    const say = (t: string) => turn.messages.push({ kind: 'bot', text: t });
    if (kind === 'amt') {
      const amt = Number(p.amt);
      if (key === 'check') { const ac = this.amountCheck(s, amt, lang); turn.trace = { ...turn.trace, pickKind: 'amt', amt, acct: { chk: ac.chk, verified: ac.verified, call: ac.call, json: ac.json, rows: ac.rows } }; say(ac.text); if (ac.agent) turn.buttons = this.buttons([], lang); }
      else { s.lastTopic = key; turn.trace = { ...turn.trace, amt }; say(this.amountAnswer(s, key as 'deposit' | 'withdraw', amt, lang)); }
      return turn;
    }
    if (kind === 'status') {
      const ac = this.account(s, key, lang, this.ans(s.merchant, key === 'deposit' ? 'deposit_time' : 'withdraw_time', lang));
      turn.trace = { ...turn.trace, acct: { chk: ac.chk, verified: ac.verified, call: ac.call, json: ac.json, rows: ac.rows } };
      say(ac.text); if (ac.agent) turn.buttons = this.buttons([], lang); return turn;
    }
    const intentAnswer = (k: string) => {
      if (this.engine.entry(s.merchant, k)?.entryType === 'needs_staff') { const h = this.handoff(s, lang); turn.messages.push(...h.messages); turn.status = h.status; turn.trace = { ...turn.trace, pickKind: 'intent', key: k, why: 'Marked "needs staff": a person answers this.' }; return; }
      const a = this.ans(s.merchant, k, lang, s.channel); turn.trace = { ...turn.trace, pickKind: 'intent', key: k, extra: a }; say(this.wrap(s, a, lang)); };
    if (kind === 'intent') { intentAnswer(key); return turn; }
    if (kind === 'topic') {
      const list = this.engine.intentsOfTopic(s.merchant, key);
      if (list.length === 1) { intentAnswer(list[0]); return turn; }
      // "my money not in" + "deposit": the first message already said what is wanted (not in = time), so answer now instead of asking a second question
      if (pending) {
        const joined = this.engine.analyze(pending + ' ' + key, s.merchant, 0);
        if (joined.decision === 'ANSWER' && joined.via === 'keywords' && list.includes(joined.top.intent)) { turn.trace = { ...turn.trace, joinedWith: pending }; intentAnswer(joined.top.intent); return turn; }
      }
      const m = this.choiceMenu(s, key, lang); turn.messages.push(m.message); turn.buttons = m.buttons; s.askKind = 'menu';
      turn.trace = { ...turn.trace, extra: list.map((k) => this.label({ kind: 'intent', key: k }, lang)).join(' · ') + ' · ' + T.AGENT[lang] };
      return turn;
    }
    const h = this.handoff(s, lang); turn.messages.push(...h.messages); turn.status = h.status; return turn;
  }

  greeting(s: Session): BotMsg { const c = this.cfg(s); return { kind: 'bot', text: T.GREET[c.defaultLanguage](c.name) }; }
}

export type { Option };
