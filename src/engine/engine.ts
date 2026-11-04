import type {
  Knowledge, MerchantCfg, KbEntry, AnalyzeResult, AnalyzeContext, Decision, Option, Amount, Candidate, KeywordScan, KeywordRow, Guard, Lang,
} from './types';

/* ------------------------------------------------------------------------------------------------
 * The bot engine: decides what to do with a customer message. No AI and no network in here, so it is
 * fast, free and fully testable. The AI layer (phase 3) only writes the wording of the reply.
 * Order of checks: rude words -> rule-change / other merchant / secrets -> greetings and fillers ->
 * account data -> keywords (topic + question type) -> amounts -> buttons -> similarity -> human.
 * ---------------------------------------------------------------------------------------------- */

const CJK_RE = /[一-鿿]/;
const escRe = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GAP = 0.05;   // the best match must beat the second by this much (the answer / clarify limits are per merchant)
const ASPECT_ORDER = ['time', 'limit', 'change', 'hours', 'how'];
const ACCT_TOPICS = ['balance', 'transactions', 'points'];
const TOOLNAME: Record<string, string> = { balance: 'get_balance', transactions: 'get_recent_transactions', points: 'get_points' };
const SMALL_KINDS = ['morning', 'greeting', 'callout', 'thanks', 'bye', 'ack'];
const CALL_PREFIX = ['boss', 'bos', 'bro', 'sis', 'sir', 'miss', 'kak', 'kakak', 'abang', 'bang', 'tuan', 'puan', 'oi', 'hoi', '老板'];
const AMT_RE = /(?:(?:rm|myr)\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(?:rm|myr|ringgit|块|元))?|([一二三四五六七八九])\s*(百|千)/i;
const CNUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const AMT_WORDS = new Set(['cash', 'duit', 'wang', 'money', 'rm', 'myr', 'ringgit', 'pls', 'please', 'mau', 'ok']);
const PAST_RE = /(deposited|withdrew|withdrawn|transferred|paid|sent|dah|sudah|tadi|semalam|yesterday|already|已经|昨天|刚才|刚刚)/i;
const PERSONAL_RE = /(^|[^a-z])(my|mine|saya|aku|sy|belum|not|still|pending|yet|stuck|lambat|lewat|slow|delayed|late|dah|sudah|already)($|[^a-z])|我|还没|没到|没收到|未到|怎么还/i;
const MS_WORDS = new Set(('abang kakak bang orang okey faham selamat pagi petang malam terima kasih tq tqvm jumpa salam helo hai khabar sama macam mana nak berapa lama tak belum cara saya ada pukul buka lupa tarik duit sila boleh tukar salah nombor sahkan akaun lambat sangat masuk bonus promosi korang betul ni lah ke').split(' '));
const BASE_FILLER = 'pls please plz tolong help nak nk mahu mau ingin want wanna gonna need would like can could may boleh to i im me my we saya sy aku kami ask tanya check about info any a the lah ke la ok yes ya';
const BASE_SMALL_FILL = ['ok', 'okay', 'ya', 'la', 'lah', 'boss', 'bos', 'sir', 'miss', 'admin', 'cs', 'there', 'all', 'team', 'everyone', 'kak', 'abang', 'so', 'very', 'much', 'banyak', 'you', 'a', 'lot', 'for', 'the', 'info', 'help', 'your', 'ur', 'assistance', 'reply'];

const flat = (m: Record<string, Record<string, string[]>> | undefined, key?: string): string[] =>
  key ? Object.values(m?.[key] ?? {}).flat() : Object.values(m ?? {}).flatMap((x) => Object.values(x).flat());
const compact = (s: string) => s.toLowerCase().replace(/[4@]/g, 'a').replace(/1/g, 'i').replace(/3/g, 'e').replace(/0/g, 'o').replace(/\$/g, 's').replace(/[^a-z]/g, '');
const toks = (t: string): Set<string> => {
  const s = new Set<string>();
  (t.match(/[a-z0-9_]+/g) || []).forEach((w) => s.add(w));
  (t.match(/[一-鿿]+/g) || []).forEach((r) => { if (r.length === 1) s.add(r); else for (let i = 0; i < r.length - 1; i++) s.add(r.slice(i, i + 2)); });
  return s;
};
const dice = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; a.forEach((x) => { if (b.has(x)) n++; }); return (2 * n) / (a.size + b.size); };
const reEsc = (p: string) => escRe(p) + (/[a-z]$/.test(p) ? '(?![a-z])' : '');

export function extractAmount(raw: string): Amount | null {
  const m = raw.match(AMT_RE); if (!m) return null;
  const n = m[1] ? parseFloat(m[1].replace(/,/g, '')) : CNUM[m[2]] * (m[3] === '百' ? 100 : 1000);
  return { n, text: m[0], hasCur: /rm|myr|ringgit|块|元/i.test(m[0]) };
}

export class Engine {
  private merchants = new Map<string, MerchantCfg>();
  private entries: Map<string, KbEntry[]> = new Map();
  private aliasCache = new Map<string, [string, string][]>();
  private exCache = new Map<string, Set<string>>();
  private topics: string[];
  private topicIntents: Record<string, string[]> = {};
  private FILLER: Set<string>; private SMALL_FILL: Set<string>; private DATA_FILLERS: string[];
  private abuseWords: string[]; private abuseSoft: string[]; private injection: string[]; private abuseCompact: string[];
  private aspectRes: [string, [string, RegExp][]][];
  private allSmall: [string, string][]; private greetRe: RegExp; private tailRe: RegExp;

  constructor(private k: Knowledge) {
    k.merchants.forEach((m) => { this.merchants.set(m.code, m); this.entries.set(m.code, []); });
    k.kbEntries.forEach((e) => this.entries.get(e.merchant)?.push(e));
    this.topics = Object.keys(k.globalAliases);
    k.kbEntries.forEach((e) => { const l = (this.topicIntents[e.topic] ??= []); if (!l.includes(e.intentKey)) l.push(e.intentKey); });

    this.DATA_FILLERS = Object.values(k.fillers ?? {}).flat().map((w) => w.toLowerCase());
    this.FILLER = new Set(BASE_FILLER.split(' ')); this.SMALL_FILL = new Set(BASE_SMALL_FILL);
    this.DATA_FILLERS.forEach((w) => { this.FILLER.add(w); this.SMALL_FILL.add(w); });

    this.abuseWords = flat(k.guard, 'abuse'); this.abuseSoft = flat(k.guard, 'abuse_soft'); this.injection = flat(k.guard, 'injection');
    this.abuseCompact = this.abuseWords.filter((w) => /^[a-z]{5,}$/.test(w) || w === 'fuck');

    this.aspectRes = ASPECT_ORDER.map((a) => [a, flat(k.aspects, a).map((w) => w.toLowerCase()).sort((x, y) => y.length - x.length)
      .map((w): [string, RegExp] => [w, CJK_RE.test(w) ? new RegExp(escRe(w), 'g') : new RegExp('(?<![a-z0-9_])' + escRe(w) + '(?![a-z0-9_])', 'g')])]);

    const sp = (kind: string) => flat(k.smalltalk, kind);
    this.allSmall = SMALL_KINDS.flatMap((kind) => sp(kind).map((p): [string, string] => [p, kind])).sort((a, b) => b[0].length - a[0].length);
    this.greetRe = new RegExp('^(?:\\s*(?:' + [...sp('greeting'), ...sp('morning'), ...CALL_PREFIX].sort((a, b) => b.length - a.length).map(reEsc).join('|') + ')[\\s,.!?，。！、:-]*)+', 'i');
    this.tailRe = new RegExp('(?:^|[\\s,])(?:boss|bos|bro|sir|miss|kak|kakak|abang|bang|pls|please|plz|ya|lah|la|ok|老板)[\\s,.!?，。！]*$', 'i');
  }

  hasMerchant(code: string) { return this.merchants.has(code); }
  merchant(code: string) { return this.merchants.get(code)!; }
  entriesOf(code: string) { return this.entries.get(code) ?? []; }
  entry(code: string, intentKey: string) { return this.entriesOf(code).find((e) => e.intentKey === intentKey); }
  /** The intents of a topic that this merchant has an answer for (the buttons shown after a topic word). */
  intentsOfTopic(code: string, topic: string) { const m = this.merchants.get(code); return m ? this.availIntents(m, topic) : []; }
  /** The first-level topic buttons (deposit, withdraw...) this merchant can answer. */
  topicButtons(code: string): Option[] { return ['deposit', 'withdraw', 'password', 'promotion'].filter((x) => this.intentsOfTopic(code, x).length).map((x): Option => ({ kind: 'topic', key: x })); }

  /* ---------- text helpers ---------- */
  private aliasesFor(m: MerchantCfg): [string, string][] {
    const hit = this.aliasCache.get(m.code); if (hit) return hit;
    const out: [string, string][] = [];
    for (const [canon, byLang] of Object.entries(this.k.globalAliases)) for (const vs of Object.values(byLang)) vs.forEach((v) => out.push([v.toLowerCase(), canon]));
    m.aliases.forEach((a) => out.push([a.variant.toLowerCase(), a.canonical]));
    out.sort((a, b) => b[0].length - a[0].length);
    this.aliasCache.set(m.code, out); return out;
  }
  /** Turns short forms into the topic word: "depo" -> "deposit". */
  normalize(raw: string, m: MerchantCfg): { text: string; hits: [string, string][] } {
    let t = ' ' + raw.toLowerCase() + ' '; const hits: [string, string][] = [];
    for (const [v, c] of this.aliasesFor(m)) {
      if (v === c) continue;
      if (CJK_RE.test(v)) { if (t.includes(v)) { t = t.split(v).join(' ' + c + ' '); hits.push([v, c]); } }
      else {
        const re = new RegExp('(^|[^a-z0-9_])' + escRe(v) + '(?=$|[^a-z0-9_])', 'g');
        if (re.test(t)) { re.lastIndex = 0; t = t.replace(re, '$1' + c); hits.push([v, c]); }
      }
    }
    return { text: t.replace(/\s+/g, ' ').trim(), hits };
  }
  detectLang(raw: string): Lang {
    if (CJK_RE.test(raw)) return 'zh';
    return (raw.toLowerCase().match(/[a-z]+/g) || []).some((x) => MS_WORDS.has(x)) ? 'ms' : 'en';
  }
  private exampleTokens(m: MerchantCfg, e: KbEntry, lg: string, ex: string) {
    const key = m.code + '|' + e.intentKey + '|' + lg + '|' + ex;
    let v = this.exCache.get(key); if (!v) { v = toks(this.normalize(ex, m).text); this.exCache.set(key, v); } return v;
  }
  private availIntents(m: MerchantCfg, t: string) {
    return (this.topicIntents[t] || []).filter((k) => this.entriesOf(m.code).some((e) => e.intentKey === k));
  }
  private toolOn(m: MerchantCfg, k: string) { return m.tools.includes(k); }

  /* ---------- greetings, thanks, fillers ---------- */
  private smallPhrases(kind: string) { return flat(this.k.smalltalk, kind); }
  private smalltalk(raw: string): string | null {
    const s = raw.toLowerCase().replace(/[^a-z一-鿿\s]/g, ' ').replace(/[啊呀哦呢吧哈]/g, '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const variants = [s, s.split(' ').filter((w) => !this.SMALL_FILL.has(w)).join(' ')];
    for (const kind of SMALL_KINDS) if (this.smallPhrases(kind).some((p) => variants.includes(p))) return kind;
    let rest = ' ' + s + ' '; const found = new Set<string>();   // several phrases in one message: "ok noted thanks"
    for (const [p, kind] of this.allSmall) {
      const re = CJK_RE.test(p) ? new RegExp(escRe(p), 'g') : new RegExp('(?<![a-z])' + escRe(p) + '(?![a-z])', 'g');
      if (re.test(rest)) { found.add(kind); rest = rest.replace(re, ' '); }
    }
    const left = rest.replace(/[你您了的]/g, '').split(/\s+/).filter((w) => w && !this.SMALL_FILL.has(w));
    if (found.size && !left.length) for (const kind of ['bye', 'thanks', 'morning', 'greeting', 'callout', 'ack']) if (found.has(kind)) return kind;
    const fl = new Set([...this.DATA_FILLERS, ...this.SMALL_FILL]); const tk = s.split(' ').filter(Boolean);
    if (tk.length && tk.every((w) => fl.has(w))) return 'callout';     // only filler words (语助词): "lah", "tolong lah"
    return null;
  }
  stripGreeting(raw: string): string {
    let s = raw.replace(this.greetRe, '').trim(), prev: string;
    do { prev = s; s = s.replace(this.tailRe, '').trim(); } while (s !== prev && s);
    return s || raw;
  }

  /* ---------- keywords: topic word + question type, found ANYWHERE in the sentence ---------- */
  private findAspects(text: string): Set<string> {
    let rest = ' ' + text + ' '; const found = new Set<string>();
    for (const [a, list] of this.aspectRes) for (const [, re] of list) { re.lastIndex = 0; if (re.test(rest)) { found.add(a); re.lastIndex = 0; rest = rest.replace(re, ' '); } }
    return found;
  }
  private keywordScan(text: string, m: MerchantCfg): KeywordScan {
    const T = [...new Set((text.match(/[a-z0-9_]+/g) || []).filter((x) => this.topics.includes(x)))];
    const A = this.findAspects(text); const strong: KeywordRow[] = [], partial: KeywordRow[] = [];
    for (const e of this.entriesOf(m.code)) {
      const tOk = T.includes(e.topic), aOk = !!e.aspect && A.has(e.aspect);
      const s = !e.aspect ? tOk : (e.topicOptional ? aOk : (tOk && aOk));
      const row: KeywordRow = { id: e.id, intent: e.intentKey, topic: e.topic, aspect: e.aspect, opt: e.topicOptional };
      if (s) strong.push(row); else if (tOk || aOk) partial.push({ ...row, tOk, aOk });
    }
    const nonOpt = strong.filter((s) => !s.opt);       // an "aspect only" match (hours) gives way to topic + aspect
    return { T, A: [...A], strong: nonOpt.length ? nonOpt : strong, partial };
  }

  /* ---------- guards: rule-change attempts, other merchants, secrets ---------- */
  private guardHit(raw: string, m: MerchantCfg): Guard | null {
    const lc = raw.toLowerCase();
    const inj = this.injection.filter((w) => lc.includes(w));
    if (inj.length) return { kind: 'injection', hit: inj, why: "The message tries to change the bot's rules, so it is not answered. A human takes over." };
    const cmp = lc.replace(/[^a-z]/g, '');
    const others = this.k.merchants.filter((x) => x.code !== m.code).flatMap((x) => [x.name.toLowerCase(), x.code.toLowerCase().replace(/[^a-z]/g, ''), 'merchant' + x.code.slice(-1).toLowerCase()]);
    const oh = others.filter((w) => cmp.includes(w));
    if (oh.length) return { kind: 'other-merchant', hit: oh, why: 'The customer asks about another merchant. This bot only answers for ' + m.name + ', so a human takes over.' };
    const hasP = (p: string) => CJK_RE.test(p) ? lc.includes(p) : new RegExp('(?<![a-z])' + escRe(p) + '(?![a-z])').test(lc);
    const g = (kind: string) => flat(this.k.guard, kind);
    const sp = g('secret_phrase').filter(hasP), ob = g('secret_object').filter(hasP);
    if (sp.length || (g('reveal_verb').some(hasP) && ob.length && !g('reveal_except').some(hasP)))
      return { kind: 'sensitive', hit: [...sp, ...ob], why: 'The customer asks to see a secret (password, OTP, or a full bank, card or ID number). The bot never shows these in chat.' };
    return null;
  }

  /* ---------- the decision ---------- */
  analyze(raw: string, merchantCode: string, clarifyCount = 0, ctx: AnalyzeContext = {}): AnalyzeResult {
    const m = this.merchants.get(merchantCode); if (!m) throw new Error('unknown merchant ' + merchantCode);
    const lc = raw.toLowerCase(); const cmp = compact(raw);
    const hasWord = (w: string) => CJK_RE.test(w) ? lc.includes(w) : new RegExp('(^|[^a-z])' + escRe(w) + '($|[^a-z])').test(lc);
    const strongHit = [...new Set([...this.abuseWords.filter(hasWord), ...this.abuseCompact.filter((w) => cmp.includes(w))])];
    const softHit = this.abuseSoft.filter(hasWord);
    const cleaned = lc.replace(/[^a-z一-鿿]/g, '');
    const softWhole = softHit.length > 0 && this.abuseSoft.some((w) => new RegExp('^(?:' + escRe(w) + ')+$').test(cleaned));
    const abuseHit = strongHit.length ? [...strongHit, ...softHit] : ((softWhole || new Set(softHit).size >= 2) ? softHit : []);

    const lang = this.detectLang(raw);
    const stripped = this.stripGreeting(raw); const n = this.normalize(stripped, m); const q = toks(n.text);
    const cands: Candidate[] = this.entriesOf(m.code).map((e) => {
      let best = 0, ex = '';
      for (const [lg, t] of Object.entries(e.translations)) for (const x of t!.questionExamples) { const s = dice(q, this.exampleTokens(m, e, lg, x)); if (s > best) { best = s; ex = x; } }
      return { id: e.id, intent: e.intentKey, score: best, example: ex };
    }).sort((a, b) => b.score - a.score);
    let top: Candidate = cands[0] ?? { id: 0, intent: '', score: 0, example: '' };
    const second: Candidate = cands[1] ?? { id: 0, intent: '', score: 0, example: '' };

    const ks = this.keywordScan(n.text, m);
    const acctKinds = ks.T.filter((x) => ACCT_TOPICS.includes(x));
    const Tav = ks.T.filter((t) => this.availIntents(m, t).length);
    const nonFill = (n.text.match(/[a-z0-9_]+/g) || []).filter((x) => !this.FILLER.has(x));
    const cjkLeft = (n.text.replace(/[我想要请问一下的吗啊呢]/g, '').match(/[一-鿿]/g) || []).length;
    const shortMsg = nonFill.length + Math.ceil(cjkLeft / 2) <= 3;
    const guard = abuseHit.length ? null : this.guardHit(raw, m);
    const amt = extractAmount(raw);
    const restRaw = amt ? raw.replace(AMT_RE, ' ').toLowerCase().replace(/[钱现金块元我要想请]/g, ' ') : '';
    const restTok = amt ? (this.normalize(restRaw, m).text.match(/[a-z0-9_]+/g) || []).filter((x) => !this.FILLER.has(x) && !AMT_WORDS.has(x)) : [];
    const restCJK = amt ? (restRaw.match(/[一-鿿]/g) || []).length : 0;
    const past = PAST_RE.test(lc);

    let small: string | null = (abuseHit.length || guard) ? null : this.smalltalk(raw); let smallFallback = false;
    const remTok = (n.text.match(/[a-z0-9_]+|[一-鿿]/g) || []).length;
    if (!small && !abuseHit.length && !guard && stripped !== raw && top.score < m.clarifyThreshold && remTok <= 3 && !ks.strong.length && !Tav.length && !acctKinds.length) { small = 'greeting'; smallFallback = true; }

    let decision: Decision, why: string, options: Option[] = [], topic: string | null = null, conf = top.score;
    let via: 'similarity' | 'keywords' = 'similarity'; let dir: 'deposit' | 'withdraw' | null = null; let ctxDir: string | null = null;
    const topicOptions = () => ['deposit', 'withdraw', 'password', 'promotion'].filter((x) => this.availIntents(m, x).length).map((x): Option => ({ kind: 'topic', key: x }));

    if (abuseHit.length) { decision = 'ABUSE'; why = (strongHit.length ? 'Rude or abusive word found.' : 'A mild word that is the whole message or comes with other insults.') + ' The bot replies kindly first and closes only if it keeps happening.'; conf = 0.99; }
    else if (guard && guard.kind === 'sensitive') { decision = 'REFUSE'; why = guard.why; conf = 0.99; }
    else if (guard) { decision = 'HANDOFF'; why = guard.why; conf = 0.99; }
    else if (small) { decision = 'SMALLTALK'; conf = 0.97; why = 'A greeting, thanks or goodbye is not a question, so the bot replies politely and does not hand off.'; if (['morning', 'greeting', 'callout'].includes(small)) options = topicOptions(); }
    else if (acctKinds.length) {
      const kd = acctKinds[0]; via = 'keywords'; topic = kd; conf = 0.95;
      if (kd === 'points' && ks.A.includes('how') && /(earn|redeem|collect|increase|upgrade|get more|dapat|tebus|kumpul|naik|赚|获得|兑换|升级|提高)/i.test(lc)) { decision = 'HANDOFF'; why = 'This asks how to earn or use points. The KB has no entry for the points programme, so a human takes over.'; }
      else if (!this.toolOn(m, kd)) { decision = 'HANDOFF'; why = m.name + ' has not turned on the "' + TOOLNAME[kd] + '" tool, so a human takes over.'; }
      else { decision = 'ACCOUNT'; why = 'The customer asks for personal account data ("' + kd + '"). This needs a verified customer and a lookup.'; }
    }
    else if (ks.strong.length === 1) {
      const s = ks.strong[0]; decision = 'ANSWER'; via = 'keywords'; conf = 0.97; top = { id: s.id, intent: s.intent, score: 1, example: '(keywords)' }; topic = s.topic;
      why = 'Keywords found in the sentence: topic "' + s.topic + '"' + (s.aspect ? ' + "' + s.aspect + '"' : '') + '. Other words are ignored.';
    }
    else if (ks.strong.length > 1) { decision = 'CHOICE'; via = 'keywords'; conf = 0.9; options = ks.strong.slice(0, 4).map((s): Option => ({ kind: 'intent', key: s.intent })); why = 'Several answers match the keywords in the sentence, so the customer picks one.'; }
    else if (amt && Tav.length === 1 && ['deposit', 'withdraw'].includes(Tav[0]) && !past) {
      decision = 'AMOUNT'; via = 'keywords'; conf = 0.95; dir = Tav[0] as 'deposit' | 'withdraw';
      why = 'An amount and one clear action ("' + dir + '") were found. The bot checks the amount against the merchant\'s limits and gives the steps.';
    }
    else if (amt && !ks.strong.length && !acctKinds.length && ((!Tav.length && restTok.length === 0 && restCJK === 0 && (amt.n >= 10 || amt.hasCur)) || (Tav.length === 1 && past))) {
      decision = 'AMOUNT'; via = 'keywords'; conf = 0.9; ctxDir = ctx.lastTopic || null;
      why = ctxDir ? 'An amount but no clear action. The earlier chat was about ' + ctxDir + ', so the bot asks to confirm.' : 'An amount but no clear action (deposit, withdraw, or a transaction that has not arrived). The bot asks instead of guessing.';
    }
    else if (Tav.length === 1) { decision = 'CHOICE'; via = 'keywords'; conf = 0.9; topic = Tav[0]; options = this.availIntents(m, topic).map((k): Option => ({ kind: 'intent', key: k })); why = 'The sentence has the topic "' + topic + '" but not what the customer wants to know, so show buttons instead of guessing.'; }
    else if (Tav.length > 1) { decision = 'CHOICE'; via = 'keywords'; conf = 0.9; options = Tav.map((x): Option => ({ kind: 'topic', key: x })); why = 'The sentence names several topics, so let the customer pick one.'; }
    else if (ks.A.length && shortMsg && ks.partial.some((p) => p.aOk) && !(top.score >= m.answerThreshold && top.score - second.score >= GAP)) {
      decision = 'CLARIFY'; via = 'keywords'; options = ks.partial.filter((p) => p.aOk).slice(0, 3).map((p): Option => ({ kind: 'intent', key: p.intent }));
      why = 'A keyword ("' + ks.A.join('", "') + '") but no topic, so show the matching questions as buttons.';
    }
    else if (top.score >= m.answerThreshold && top.score - second.score >= GAP) { decision = 'ANSWER'; why = 'No keywords, but the sentence is very close to a KB example.'; }
    else if (top.score >= m.clarifyThreshold) {
      if (clarifyCount < 1) { decision = 'CLARIFY'; options = [cands[0], cands[1]].map((c): Option => ({ kind: 'intent', key: c.intent })); why = top.score >= m.answerThreshold ? 'Two topics score almost the same, so show both as buttons.' : 'Score is in the middle, so show the two closest as buttons.'; }
      else { decision = 'HANDOFF'; why = 'Still unclear after one round of buttons, so a human takes over.'; }
    } else { decision = 'HANDOFF'; why = 'No keywords found and no KB entry is close enough.'; }

    let account: AnalyzeResult['account'] = null;
    if (decision === 'ANSWER' && (top.intent === 'deposit_time' || top.intent === 'withdraw_time') && PERSONAL_RE.test(lc)) account = { kind: top.intent === 'deposit_time' ? 'deposit' : 'withdraw' };
    return { raw, lang, normalized: n.text, hits: n.hits, abuseHit, guard, ks, via, cands, top, second, decision, why, conf, options, topic, small, smallFallback, account, amt, dir, ctxDir };
  }
}
