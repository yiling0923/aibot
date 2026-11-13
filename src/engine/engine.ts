import type {
  Knowledge, MerchantCfg, KbEntry, AnalyzeResult, AnalyzeContext, Decision, Option, Amount, Candidate, KeywordScan, KeywordRow, KeywordHit, Guard, Lang,
} from './types';

/* ------------------------------------------------------------------------------------------------
 * The bot engine: decides what to do with a customer message. No AI and no network in here, so it is
 * fast, free and fully testable. The AI layer (phase 3) only writes the wording of the reply.
 * Order of checks: rude words -> rule-change / other merchant / secrets -> greetings and fillers ->
 * account data -> keywords (topic + question type) -> amounts -> buttons -> similarity -> human.
 * ---------------------------------------------------------------------------------------------- */

const CJK_RE = /[一-鿿]/;
/** Scripts written without spaces between words (Chinese, Thai): their words are found as pieces of the text, not between spaces. */
const NOSP_RE = /[฀-๿一-鿿]/;
const THAI_RE = /[฀-๿]/;
/** Vietnamese is written with many accents, and customers often leave them out. Both the message and every word list are folded to plain letters
 *  (nạp tiền = nap tien), so one list entry matches both ways of typing. Other Latin-script languages have no accents here, so nothing changes. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFC');
const VI_ACCENT_RE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỷỹỵ]/i;
const thaiSeg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
/** The words of a Thai text (Thai has no spaces). Falls back to pieces of 3 letters when the runtime has no word list. */
const thaiWords = (t: string): string[] => {
  const runs = t.match(/[฀-๿]+/g) ?? [];
  if (!thaiSeg) return runs.flatMap((r) => r.match(/.{1,3}/g) ?? []);
  return runs.flatMap((r) => [...thaiSeg.segment(r)].filter((x) => x.isWordLike).map((x) => x.segment));
};
/** The polite endings of Thai (ครับ ค่ะ คะ นะ ...) are whole words, never single letters. */
const TH_PART = '(?:นะคะ|นะครับ|ครับ|ค่ะ|คะ|นะ|จ้ะ|จ๊ะ|ฮะ)';
const TH_PARTICLES = new RegExp(TH_PART, 'g');
const escRe = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GAP = 0.05;   // the best match must beat the second by this much (the answer / clarify limits are per merchant)
// Kinds of question words. "problem" (rejected, failed, complaint) always goes to a human; "help" (what to do) is just noise.
const ASPECT_ORDER = ['time', 'limit', 'change', 'hours', 'how', 'problem', 'help'];
const ACCT_TOPICS = ['balance', 'transactions', 'points'];
const TOOLNAME: Record<string, string> = { balance: 'get_balance', transactions: 'get_recent_transactions', points: 'get_points' };
const SMALL_KINDS = ['morning', 'greeting', 'callout', 'thanks', 'bye', 'ack'];
const CALL_PREFIX = ['boss', 'bos', 'bro', 'sis', 'sir', 'miss', 'kak', 'kakak', 'abang', 'bang', 'tuan', 'puan', 'oi', 'hoi', '老板', 'kuya', 'ate', 'maam', 'po', 'opo', 'anh oi', 'chi oi', 'em oi', 'แอดมิน', 'พี่'];
const CUR = 'rm|myr|ringgit|块|元|vnd|dong|thb|baht|บาท|php|piso|₱';
const AMT_RE = new RegExp('(?:(?:rm|myr|php|thb|vnd|₱)\\s*)?(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)(?:\\s*(?:' + CUR + '|k(?![a-z])))?|([一二三四五六七八九])\\s*(百|千)', 'i');
const CNUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const AMT_WORDS = new Set(['cash', 'duit', 'wang', 'money', 'rm', 'myr', 'ringgit', 'pls', 'please', 'mau', 'ok', 'tien', 'pera', 'salapi', 'php', 'piso', 'vnd', 'dong', 'thb', 'baht', 'po']);
const PAST_RE = /(deposited|withdrew|withdrawn|transferred|paid|sent|dah|sudah|tadi|semalam|yesterday|already|已经|昨天|刚才|刚刚|hom qua|vua nap|vua rut|da nap|da rut|da chuyen|เมื่อวาน|เมื่อกี้|เพิ่งฝาก|เพิ่งถอน|ฝากแล้ว|ถอนแล้ว|โอนแล้ว|kahapon|kanina|nag-deposit na|nag-withdraw na|nagdeposit na|nagwithdraw na)/i;
const PERSONAL_RE = /(^|[^a-z])(my|mine|saya|aku|sy|belum|not|still|pending|yet|stuck|lambat|lewat|slow|delayed|late|dah|sudah|already|cua toi|cua minh|chua|van|ko|akin|wala|hindi|pa rin|pa)($|[^a-z])|我|还没|没到|没收到|未到|怎么还|ของฉัน|ของผม|ของดิฉัน|ยังไม่/i;   // ownership, not just "I": in Vietnamese, Thai and Filipino "I / me" is also how a customer politely starts any question
const MS_WORDS = new Set(('abang kakak bang orang okey faham selamat pagi petang malam terima kasih tq tqvm jumpa salam helo hai khabar sama macam mana nak berapa lama tak belum cara saya ada pukul buka lupa tarik duit sila boleh tukar salah nombor sahkan akaun lambat sangat masuk bonus promosi korang betul ni lah ke').split(' '));
const VI_WORDS = new Set('khong nap rut tien lau nao lam sao cach toi minh xin chao khau quen khoan ngan chua roi duoc muon giup dich khuyen mai thuong ky nhe nha vay gio phut ngay hom nay oi alo cam on'.split(' '));
const TL_WORDS = new Set("po opo paano magkano kailan gaano katagal ilang gusto ko mo ba naman salamat pwede puwede hindi wala bakit saan nasaan ang ng mga ako ikaw kayo namin natin pera hulog kuha pasok dumating sino ano anong yung nung lang din rin sige ayos kuya ate paki magandang umaga hapon gabi kumusta kamusta walang anuman tulong tulungan nakalimutan nakalimutang magdeposit magwithdraw mag nag tangina putangina gago tanga ulol bobo pota".split(' '));
const BASE_FILLER = 'pls please plz tolong help nak nk mahu mau ingin want wanna gonna need would like can could may boleh to i im me my we saya sy aku kami ask tanya check about info any a the lah ke la ok yes ya';
const BASE_SMALL_FILL = ['ok', 'okay', 'ya', 'la', 'lah', 'boss', 'bos', 'sir', 'miss', 'admin', 'cs', 'there', 'all', 'team', 'everyone', 'kak', 'abang', 'so', 'very', 'much', 'banyak', 'you', 'a', 'lot', 'for', 'the', 'info', 'help', 'your', 'ur', 'assistance', 'reply'];

const flat = (m: Record<string, Record<string, string[]>> | undefined, key?: string): string[] =>
  (key ? Object.values(m?.[key] ?? {}).flat() : Object.values(m ?? {}).flatMap((x) => Object.values(x).flat())).map(fold);
const compact = (s: string) => s.toLowerCase().replace(/[4@]/g, 'a').replace(/1/g, 'i').replace(/3/g, 'e').replace(/0/g, 'o').replace(/\$/g, 's').replace(/[^a-z]/g, '');
const SIM_STOP = new Set('what is the a an to of do does i my me you your it its this that are can will be for and or if so at in on'.split(' '));
const toks = (t: string): Set<string> => {
  const s = new Set<string>();
  const words = t.match(/[a-z0-9_]+/g) || [];
  const keep = words.filter((w) => !SIM_STOP.has(w));
  (keep.length ? keep : words).forEach((w) => s.add(w));          // never remove every word
  thaiWords(t).forEach((w) => s.add(w));
  (t.match(/[一-鿿]+/g) || []).forEach((r) => { if (r.length === 1) s.add(r); else for (let i = 0; i < r.length - 1; i++) s.add(r.slice(i, i + 2)); });
  return s;
};
const dice = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; a.forEach((x) => { if (b.has(x)) n++; }); return (2 * n) / (a.size + b.size); };
const reEsc = (p: string) => escRe(p) + (/[a-z]$/.test(p) ? '(?![a-z])' : '');

export function extractAmount(raw: string): Amount | null {
  const m = raw.match(AMT_RE); if (!m) return null;
  let n = m[1] ? parseFloat(m[1].replace(/,/g, '')) : CNUM[m[2]] * (m[3] === '百' ? 100 : 1000);
  if (m[1] && /\dk$/i.test(m[0].trim())) n *= 1000;                      // 500k = 500,000 (the usual way to write it in Vietnamese chat)
  return { n, text: m[0], hasCur: new RegExp(CUR + '|₱', 'i').test(m[0]) };
}

export class Engine {
  private merchants = new Map<string, MerchantCfg>();
  private entries: Map<string, KbEntry[]> = new Map();
  private aliasCache = new Map<string, [string, string][]>();
  private exCache = new Map<string, Set<string>>();
  private topics: string[];
  /** The topics of each merchant: the shared template, plus the topics the merchant made itself (keywords with a topic name of their own, and the topics of its own entries). */
  private topicSets = new Map<string, Set<string>>();
  private topicIntents: Record<string, string[]> = {};
  private FILLER: Set<string>; private SMALL_FILL: Set<string>; private DATA_FILLERS: string[];
  private abuseWords: string[]; private abuseSoft: string[]; private injection: string[]; private abuseCompact: string[];
  private aspectWords: [string, RegExp][] = [];
  /** Words about money in general (money, funds, duit, 钱, เงิน). With a question about time and no topic they mean "is it my deposit or my withdrawal?". */
  private moneyWords: RegExp[] = [];
  private allSmall: [string, string][]; private greetRe: RegExp; private tailRe: RegExp;

  constructor(private k: Knowledge) {
    k.merchants.forEach((m) => { this.merchants.set(m.code, m); this.entries.set(m.code, []); });
    k.kbEntries.forEach((e) => this.entries.get(e.merchant)?.push(e));
    this.topics = Object.keys(k.globalAliases);
    k.merchants.forEach((m) => this.topicSets.set(m.code, new Set([...this.topics, ...m.aliases.map((a) => a.canonical), ...(this.entries.get(m.code) ?? []).map((e) => e.topic)])));
    k.kbEntries.forEach((e) => { const l = (this.topicIntents[e.topic] ??= []); if (!l.includes(e.intentKey)) l.push(e.intentKey); });

    this.DATA_FILLERS = Object.values(k.fillers ?? {}).flat().map((w) => fold(w.toLowerCase()));
    this.FILLER = new Set(BASE_FILLER.split(' ')); this.SMALL_FILL = new Set(BASE_SMALL_FILL);
    this.DATA_FILLERS.forEach((w) => { this.FILLER.add(w); this.SMALL_FILL.add(w); });

    this.abuseWords = flat(k.guard, 'abuse'); this.abuseSoft = flat(k.guard, 'abuse_soft'); this.injection = flat(k.guard, 'injection');
    this.abuseCompact = this.abuseWords.filter((w) => /^[a-z]{5,}$/.test(w) || w === 'fuck');

    // every question word of every kind, longest first, so "what time" (opening hours) wins over "time", and "how much" over "how"
    const all: [string, string][] = ASPECT_ORDER.flatMap((a) => flat(k.aspects, a).map((w): [string, string] => [a, w.toLowerCase()]));
    all.sort((x, y) => y[1].length - x[1].length);
    this.aspectWords = all.map(([a, w]): [string, RegExp] => [a, NOSP_RE.test(w) ? new RegExp(escRe(w), 'g') : new RegExp('(?<![a-z0-9_])' + escRe(w) + '(?![a-z0-9_])', 'g')]);
    this.moneyWords = [...new Set(flat(k.aspects, 'money').map((w) => w.toLowerCase()))].sort((a, b) => b.length - a.length)
      .map((w) => (NOSP_RE.test(w) ? new RegExp(escRe(w), 'g') : new RegExp('(?<![a-z0-9_])' + escRe(w) + '(?![a-z0-9_])', 'g')));
    const sp = (kind: string) => flat(k.smalltalk, kind);
    this.allSmall = SMALL_KINDS.flatMap((kind) => sp(kind).map((p): [string, string] => [p, kind])).sort((a, b) => b[0].length - a[0].length);
    this.greetRe = new RegExp('^(?:\\s*(?:' + [...sp('greeting'), ...sp('morning'), ...CALL_PREFIX].sort((a, b) => b.length - a.length).map(reEsc).join('|') + ')[\\s,.!?，。！、:-]*)+', 'i');
    this.tailRe = new RegExp('(?:^|[\\s,])(?:boss|bos|bro|sir|miss|kak|kakak|abang|bang|pls|please|plz|ya|lah|la|ok|老板|po|opo|kuya|ate|nhe|nha|ha)[\\s,.!?，。！]*$', 'i');
  }

  hasMerchant(code: string) { return this.merchants.has(code); }
  merchant(code: string) { return this.merchants.get(code)!; }
  /** The entries in use today: an entry past its end date is hidden (the bot then answers as if it did not exist). */
  entriesOf(code: string) {
    const all = this.entries.get(code) ?? []; if (!all.some((e) => e.endsOn)) return all;
    const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return all.filter((e) => !e.endsOn || today <= e.endsOn);
  }
  entry(code: string, intentKey: string) { return this.entriesOf(code).find((e) => e.intentKey === intentKey); }
  /** The intents of a topic that this merchant has an answer for (the buttons shown after a topic word). */
  intentsOfTopic(code: string, topic: string) { const m = this.merchants.get(code); return m ? this.availIntents(m, topic) : []; }
  /** The first-level topic buttons (deposit, withdraw...) this merchant can answer. */
  topicButtons(code: string): Option[] {
    const std = ['deposit', 'withdraw', 'password', 'promotion'];
    const own = [...(this.topicSets.get(code) ?? [])].filter((t) => !this.topics.includes(t) && this.intentsOfTopic(code, t).length)       // only topics the merchant made itself
      .sort((a, b) => this.intentsOfTopic(code, b).length - this.intentsOfTopic(code, a).length);        // the merchant's own topics follow the usual ones, the biggest first
    return [...std, ...own].filter((x) => this.intentsOfTopic(code, x).length).map((x): Option => ({ kind: 'topic', key: x }));
  }
  /** Is this word a topic of this merchant? */
  isTopic(code: string, word: string) { return this.topicSets.get(code)?.has(word) ?? this.topics.includes(word); }

  /* ---------- text helpers ---------- */
  private aliasesFor(m: MerchantCfg): [string, string][] {
    const hit = this.aliasCache.get(m.code); if (hit) return hit;
    const out: [string, string][] = [];
    for (const [canon, byLang] of Object.entries(this.k.globalAliases)) for (const vs of Object.values(byLang)) vs.forEach((v) => out.push([fold(v.toLowerCase()), canon]));
    m.aliases.forEach((a) => out.push([fold(a.variant.toLowerCase()), a.canonical]));
    out.sort((a, b) => b[0].length - a[0].length);
    this.aliasCache.set(m.code, out); return out;
  }
  /** Turns short forms into the topic word: "depo" -> "deposit". */
  normalize(raw: string, m: MerchantCfg): { text: string; hits: [string, string][] } {
    let t = ' ' + fold(raw.toLowerCase()) + ' '; const hits: [string, string][] = [];
    for (const [v, c] of this.aliasesFor(m)) {
      if (v === c) continue;
      if (NOSP_RE.test(v)) { if (t.includes(v)) { t = t.split(v).join(' ' + c + ' '); hits.push([v, c]); } }
      else {
        const re = new RegExp('(^|[^a-z0-9_])' + escRe(v) + '(?=$|[^a-z0-9_])', 'g');
        if (re.test(t)) { re.lastIndex = 0; t = t.replace(re, '$1' + c); hits.push([v, c]); }
      }
    }
    return { text: t.replace(/\s+/g, ' ').trim(), hits };
  }
  /** The language of a message, from its script and its words. Looks at the message as typed (accents and all), before it is folded. */
  detectLang(raw: string): Lang {
    if (CJK_RE.test(raw)) return 'zh';
    if (THAI_RE.test(raw)) return 'th';
    if (VI_ACCENT_RE.test(raw.normalize('NFC'))) return 'vi';
    const words = fold(raw.toLowerCase()).match(/[a-z]+/g) || [];
    const n = (set: Set<string>) => words.filter((x) => set.has(x)).length;
    const hits: [Lang, number][] = [['ms', n(MS_WORDS)], ['tl', n(TL_WORDS)], ['vi', n(VI_WORDS)]];    // a tie keeps the earlier one: Malay, then Filipino, then Vietnamese
    const best = hits.reduce((a, b) => (b[1] > a[1] ? b : a));
    return best[1] > 0 ? best[0] : 'en';
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
    const s = raw.toLowerCase().replace(/[^a-z฀-๿一-鿿\s]/g, ' ').replace(/[啊呀哦呢吧哈]/g, '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const variants = [s, s.split(' ').filter((w) => !this.SMALL_FILL.has(w)).join(' ')];
    for (const kind of SMALL_KINDS) if (this.smallPhrases(kind).some((p) => variants.includes(p))) return kind;
    let rest = ' ' + s + ' '; const found = new Set<string>();   // several phrases in one message: "ok noted thanks"
    for (const [p, kind] of this.allSmall) {
      const re = NOSP_RE.test(p) ? new RegExp(escRe(p), 'g') : new RegExp('(?<![a-z])' + escRe(p) + '(?![a-z])', 'g');
      if (re.test(rest)) { found.add(kind); rest = rest.replace(re, ' '); }
    }
    for (const f of this.SMALL_FILL) if (NOSP_RE.test(f)) rest = rest.split(f).join(' ');          // filler words of Thai and Chinese are pieces of the text
    const left = rest.replace(/[你您了的]/g, '').replace(TH_PARTICLES, '').split(/\s+/).filter((w) => w && !this.SMALL_FILL.has(w));
    if (found.size && !left.length) for (const kind of ['bye', 'thanks', 'morning', 'greeting', 'callout', 'ack']) if (found.has(kind)) return kind;
    const fl = new Set([...this.DATA_FILLERS, ...this.SMALL_FILL]); const tk = s.split(' ').filter(Boolean);
    if (tk.length && tk.every((w) => fl.has(w))) return 'callout';     // only filler words (语助词): "lah", "tolong lah"
    return null;
  }
  stripGreeting(raw: string): string {
    let s = raw.replace(this.greetRe, '').trim(), prev: string;
    if (s !== raw.trim()) s = s.replace(new RegExp('^(?:' + TH_PART + '\\s*)+'), '').trim();           // the polite ending after a Thai greeting (only when a greeting was taken off)
    do { prev = s; s = s.replace(this.tailRe, '').replace(new RegExp('(?:\\s*' + TH_PART + ')+\\s*$'), '').trim(); } while (s !== prev && s);
    return s || raw;
  }

  /* ---------- keywords: topic word + question type, found ANYWHERE in the sentence ---------- */
  private findAspects(text: string, hasTopic: boolean): { found: Set<string>; rest: string; words: KeywordHit[] } {
    let rest = ' ' + text + ' '; const found = new Set<string>(); const words: KeywordHit[] = [];
    // A number with a unit (2 hours, 30 minit, 3天) is about time, when the sentence also names a topic (deposit 2 hours already).
    // "24 hours" is opening hours and is left for the word list, and an amount such as rm500 is not a number of days.
    const duration = /(?<![\d/]|rm|myr)(?!24\s*(?:hours?|hrs?|jam|gio|oras|ชั่วโมง|小时))\d+(?:\.\d+)?\s*(?:hours?(?![a-z])|hrs?(?![a-z])|minutes?(?![a-z])|mins?(?![a-z])|days?(?![a-z])|jam(?![a-z])|minit(?![a-z])|hari(?![a-z])|gio(?![a-z])|phut(?![a-z])|ngay(?![a-z])|oras(?![a-z])|minuto(?![a-z])|araw(?![a-z])|ชั่วโมง|นาที|วัน|小时|分钟|天)/g;
    if (hasTopic) { duration.lastIndex = 0; const d = rest.match(duration); if (d) { found.add('time'); d.forEach((w) => words.push({ word: w.trim(), kind: 'question', to: 'time' })); rest = rest.replace(duration, ' '); } }
    for (const [a, re] of this.aspectWords) { re.lastIndex = 0; if (re.test(rest)) { found.add(a); re.lastIndex = 0; (rest.match(re) ?? []).forEach((w) => words.push({ word: w.trim(), kind: 'question', to: a })); re.lastIndex = 0; rest = rest.replace(re, ' '); } }
    return { found, rest, words };
  }
  private keywordScan(text: string, m: MerchantCfg): KeywordScan {
    const mine = this.topicSets.get(m.code) ?? new Set(this.topics);
    const T = [...new Set((text.match(/[a-z0-9_]+/g) || []).filter((x) => mine.has(x)))];
    const { found: A, rest, words } = this.findAspects(text, T.length > 0); const strong: KeywordRow[] = [], partial: KeywordRow[] = [];
    for (const e of this.entriesOf(m.code)) {
      const tOk = T.includes(e.topic), aOk = !!e.aspect && A.has(e.aspect);
      const s = !e.aspect ? tOk : (e.topicOptional ? aOk : (tOk && aOk));
      const row: KeywordRow = { id: e.id, intent: e.intentKey, topic: e.topic, aspect: e.aspect, opt: e.topicOptional };
      if (s) strong.push(row); else if (tOk || aOk) partial.push({ ...row, tOk, aOk });
    }
    const nonOpt = strong.filter((s) => !s.opt);       // an "aspect only" match (hours) gives way to topic + aspect
    const money = this.moneyWords.flatMap((re) => { re.lastIndex = 0; return (text.match(re) ?? []).map((w) => w.trim()); });
    return { T, A: [...A], rest, strong: nonOpt.length ? nonOpt : strong, partial, words, money: [...new Set(money)] };
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
    const hasP = (p: string) => NOSP_RE.test(p) ? lc.includes(p) : new RegExp('(?<![a-z])' + escRe(p) + '(?![a-z])').test(lc);
    const g = (kind: string) => flat(this.k.guard, kind);
    const sp = g('secret_phrase').filter(hasP), ob = g('secret_object').filter(hasP);
    if (sp.length || (g('reveal_verb').some(hasP) && ob.length && !g('reveal_except').some(hasP)))
      return { kind: 'sensitive', hit: [...sp, ...ob], why: 'The customer asks to see a secret (password, OTP, or a full bank, card or ID number). The bot never shows these in chat.' };
    // asking for a person: hand over straight away instead of showing buttons
    const hr = g('human_request').filter(hasP);
    if (hr.length) return { kind: 'human', hit: hr, why: 'The customer asks for a human agent, so the chat is handed over.' };
    return null;
  }

  /* ---------- the decision ---------- */
  analyze(rawIn: string, merchantCode: string, clarifyCount = 0, ctx: AnalyzeContext = {}): AnalyzeResult {
    const m = this.merchants.get(merchantCode); if (!m) throw new Error('unknown merchant ' + merchantCode);
    const raw = fold(rawIn);                                  // accents are left out of every comparison (the language is detected from the message as typed, below)
    const lc = raw.toLowerCase(); const cmp = compact(raw);
    const hasWord = (w: string) => NOSP_RE.test(w) ? lc.includes(w) : new RegExp('(^|[^a-z])' + escRe(w) + '($|[^a-z])').test(lc);
    const strongHit = [...new Set([...this.abuseWords.filter(hasWord), ...this.abuseCompact.filter((w) => cmp.includes(w))])];
    const softHit = this.abuseSoft.filter(hasWord);
    const cleaned = lc.replace(/[^a-z฀-๿一-鿿]/g, '');
    const softWhole = softHit.length > 0 && this.abuseSoft.some((w) => new RegExp('^(?:' + escRe(w) + ')+$').test(cleaned));
    const abuseHit = strongHit.length ? [...strongHit, ...softHit] : ((softWhole || new Set(softHit).size >= 2) ? softHit : []);

    const lang = this.detectLang(rawIn);
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
    const thN = (t: string) => thaiWords(t.replace(TH_PARTICLES, '')).length;
    const shortMsg = nonFill.length + Math.ceil(cjkLeft / 2) + thN(n.text) <= 3;
    // A question word with nothing else (how long?) can show buttons. With other unknown words around it (bila cuti sekolah) it cannot.
    const leftTok = (ks.rest.match(/[a-z0-9_]+/g) || []).filter((x) => !this.FILLER.has(x)).length;
    const leftCJK = Math.ceil((ks.rest.replace(/[我想要请问一下的吗啊呢]/g, '').match(/[一-鿿]/g) || []).length / 2);
    const aspectOnly = leftTok + leftCJK + thN(ks.rest) <= 1;
    const guard = abuseHit.length ? null : this.guardHit(raw, m);
    const amt = extractAmount(raw);
    const restRaw = amt ? raw.replace(AMT_RE, ' ').toLowerCase().replace(/[钱现金块元我要想请]/g, ' ') : '';
    const restTok = amt ? (this.normalize(restRaw, m).text.match(/[a-z0-9_]+/g) || []).filter((x) => !this.FILLER.has(x) && !AMT_WORDS.has(x)) : [];
    const restCJK = amt ? (restRaw.match(/[一-鿿]/g) || []).length + thN(restRaw) : 0;
    const past = PAST_RE.test(lc);

    let small: string | null = (abuseHit.length || guard) ? null : this.smalltalk(raw); let smallFallback = false;
    const remTok = (n.text.match(/[a-z0-9_]+|[一-鿿]/g) || []).length + thN(n.text);
    if (!small && !abuseHit.length && !guard && stripped !== raw && top.score < m.clarifyThreshold && remTok <= 3 && !ks.strong.length && !Tav.length && !acctKinds.length) { small = 'greeting'; smallFallback = true; }

    let decision: Decision, why: string, options: Option[] = [], topic: string | null = null, conf = top.score;
    let via: 'similarity' | 'keywords' = 'similarity'; let dir: 'deposit' | 'withdraw' | null = null; let ctxDir: string | null = null;
    const topicOptions = () => this.topicButtons(m.code);

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
    else if (ks.A.includes('problem') && !acctKinds.length) {
      decision = 'HANDOFF'; via = 'keywords'; conf = 0.9; topic = ks.T[0] ?? null;
      why = 'The customer reports a problem (a rejected or failed transaction, an error, or a complaint). The bot cannot see the reason, so a human takes over.';
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
    else if (ks.T.length && !Tav.length) {
      decision = 'HANDOFF'; via = 'keywords'; conf = 0.9; topic = ks.T[0];
      why = 'The customer asks about "' + ks.T[0] + '", which ' + m.name + ' has no answer for, so a human takes over.';
    }
    else if (!ks.T.length && ks.money.length && ks.A.includes('time') && topicOptions().filter((o) => ['deposit', 'withdraw'].includes(o.key)).length === 2) {
      // "my money not in": money, and a question about time, but nothing says deposit or withdrawal. Two topics score the same, so ask once.
      decision = 'CLARIFY'; via = 'keywords'; conf = 0.6; options = topicOptions().filter((o) => ['deposit', 'withdraw'].includes(o.key));
      why = 'Money words ("' + ks.money.join('", "') + '") and a question about time, but no topic. Deposit and withdrawal score the same, so ask once which one it is.';
    }
    else if (ks.A.length && shortMsg && aspectOnly && ks.partial.some((p) => p.aOk) && !(top.score >= m.answerThreshold && top.score - second.score >= GAP)) {
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
    // The three steps of the flow, reported: the words typed, the topic scores, the answer
    const typed = new Set<string>(); const keywords: KeywordHit[] = [];
    for (const [v, c] of n.hits) if (this.isTopic(m.code, c) && !typed.has(v)) { typed.add(v); keywords.push({ word: v.trim(), kind: 'topic', to: c }); }
    for (const t of ks.T) if (!keywords.some((k) => k.to === t)) keywords.push({ word: t, kind: 'topic', to: t });
    keywords.push(...ks.words, ...ks.money.map((w): KeywordHit => ({ word: w, kind: 'money', to: 'money' })));
    const topicOf = new Map(this.entriesOf(m.code).map((e) => [e.id, e.topic] as const)); const ts = new Map<string, number>(ks.T.map((t) => [t, 1] as const));
    for (const c of cands) { const t = topicOf.get(c.id); if (t && !ks.T.includes(t) && c.score > (ts.get(t) ?? 0)) ts.set(t, Math.min(0.99, c.score)); }
    const topicScores = [...ts].map(([topic, score]) => ({ topic, score: Math.round(score * 100) / 100 })).sort((a, b) => b.score - a.score).slice(0, 5);
    return { raw: rawIn, lang, normalized: n.text, hits: n.hits, keywords, topicScores, answerId: decision === 'ANSWER' ? top.id : null, abuseHit, guard, ks, via, cands, top, second, decision, why, conf, options, topic, small, smallFallback, account, amt, dir, ctxDir };
  }
}
