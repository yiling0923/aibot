/**
 * A starter set of entries made from the team's "LIVECHAT FAQ CATEGORY" list (the tags the agents choose from).
 * It loads through the Import screen as DRAFTS: every answer says "TO WRITE: ..." until the merchant writes the real one, and the panel flags
 * (and the Publish window warns about) any answer that still says so. Entries marked "staff" hand the chat to a person when matched.
 * The seven named promotions and VIP of the list are not here: they belong to one merchant and are added for it.
 */
export const TO_WRITE = 'TO WRITE:';

type Row = {
  key: string; topic: string; type: 'answer' | 'needs_staff'; tag: string;
  en: { q: string[]; a: string }; ms: { q: string[]; a: string }; words?: string[];     // words: keywords for a topic that is new
};

const ROWS: Row[] = [
  { key: 'free_credit_info', topic: 'free_credit', type: 'answer', tag: 'FREE CREDIT · CONSULT FREE CREDIT', words: ['free credit', 'free', 'percuma', 'kredit percuma', 'freecredit', '免费', '免费彩金'],
    en: { q: ['is there free credit', 'how to claim free credit', 'do new users get free credit', 'any free bonus for new member'], a: TO_WRITE + ' whether there is free credit, and how a member claims it.' },
    ms: { q: ['ada free ke', 'macam mana nak claim free credit', 'new user dapat free ke', 'ada kredit percuma tak'], a: TO_WRITE + ' sama ada ada kredit percuma, dan cara untuk menuntutnya.' } },
  { key: 'free_credit_request', topic: 'free_credit', type: 'needs_staff', tag: 'FREE CREDIT · REQUIRE FREE CREDIT',
    en: { q: ['give me some free', 'i want free today', 'please give free credit to play', 'boss give me free credit'], a: TO_WRITE + ' (a person answers a direct request for free credit).' },
    ms: { q: ['boss kasi saya free sikit boleh', 'saya nak free je hari ni', 'amoi kasi sikit free utk main', 'kasi free la'], a: TO_WRITE + ' (seorang pegawai menjawab permintaan terus untuk kredit percuma).' } },
  { key: 'referral_detail', topic: 'referral', type: 'answer', tag: 'REFERRAL · ASK REFERRAL DETAIL', words: ['referral', 'refer', 'refer friend', 'invite friend', 'jemput kawan', 'rujuk', '推荐'],
    en: { q: ['what is the referral bonus', 'referral details', 'how much referral commission', 'tell me about referral'], a: TO_WRITE + ' the referral rules and the bonus.' },
    ms: { q: ['apa bonus referral', 'detail referral', 'berapa komisen referral', 'terangkan pasal referral'], a: TO_WRITE + ' peraturan referral dan bonusnya.' } },
  { key: 'referral_bonus_missing', topic: 'referral', type: 'needs_staff', tag: 'REFERRAL · ASK NO GET REFERRAL BONUS',
    en: { q: ['i did not get my referral bonus', 'referral bonus not received', 'my friend joined but no bonus', 'where is my referral bonus'], a: TO_WRITE + ' (a person checks the referral).' },
    ms: { q: ['saya tak dapat bonus referral', 'bonus referral belum masuk', 'kawan saya dah daftar tapi tak ada bonus', 'mana bonus referral saya'], a: TO_WRITE + ' (seorang pegawai menyemak referral).' } },
  { key: 'referral_how', topic: 'referral', type: 'answer', tag: 'REFERRAL · ASK HOW TO REFERRAL FRIEND',
    en: { q: ['how to refer a friend', 'how do i invite my friend', 'where is my referral link', 'how to refer'], a: TO_WRITE + ' the steps to refer a friend.' },
    ms: { q: ['macam mana nak refer kawan', 'cara jemput kawan', 'mana link referral saya', 'cara refer'], a: TO_WRITE + ' langkah untuk refer kawan.' } },
  { key: 'cannot_login', topic: 'password', type: 'answer', tag: 'ACCOUNT ISSUE · CANNOT LOGIN ACCOUNT',
    en: { q: ['cannot login to my account', 'login failed', 'i cannot enter my account', 'account will not log in'], a: TO_WRITE + ' what to check when login fails.' },
    ms: { q: ['tak boleh login akaun', 'login gagal', 'tak boleh masuk akaun', 'akaun tak boleh login'], a: TO_WRITE + ' apa yang perlu disemak bila login gagal.' } },
  { key: 'update_details', topic: 'profile', type: 'needs_staff', tag: 'ACCOUNT ISSUE · UPDATE DETAILS', words: ['profile', 'update details', 'change details', 'change name', 'tukar maklumat', 'kemaskini maklumat', '资料'],
    en: { q: ['i want to update my details', 'change my name on the account', 'how to change my profile details', 'update my information'], a: TO_WRITE + ' (a person updates details after checking the member).' },
    ms: { q: ['saya nak kemaskini maklumat saya', 'tukar nama dalam akaun', 'macam mana nak tukar maklumat profil', 'update maklumat saya'], a: TO_WRITE + ' (seorang pegawai mengemaskini maklumat selepas menyemak ahli).' } },
  { key: 'verify_phone', topic: 'verify', type: 'answer', tag: 'ACCOUNT ISSUE · VERIFY PHONE',
    en: { q: ['how to verify my phone number', 'phone verification not working', 'i did not get the verification code', 'verify phone'], a: TO_WRITE + ' how a member verifies the phone number.' },
    ms: { q: ['macam mana nak sahkan nombor telefon', 'pengesahan telefon tak jadi', 'saya tak dapat kod pengesahan', 'verify phone'], a: TO_WRITE + ' cara ahli mengesahkan nombor telefon.' } },
  { key: 'register_issue', topic: 'register', type: 'answer', tag: 'ACCOUNT ISSUE · REGISTER ISSUE',
    en: { q: ['i cannot register', 'registration failed', 'how to register an account', 'sign up not working'], a: TO_WRITE + ' how to register and what to do when it fails.' },
    ms: { q: ['saya tak boleh daftar', 'pendaftaran gagal', 'macam mana nak daftar akaun', 'daftar tak jadi'], a: TO_WRITE + ' cara mendaftar dan apa nak buat bila gagal.' } },
  { key: 'deposit_bank_details', topic: 'deposit', type: 'needs_staff', tag: 'DEPOSIT / WITHDRAW · BANK DETAILS (TO DEPOSIT)',
    en: { q: ['bank details to deposit', 'which account do i transfer to', 'give me the bank account for deposit', 'send me the paynow qr'], a: TO_WRITE + ' (a person gives the latest bank account, because it changes).' },
    ms: { q: ['butiran bank untuk deposit', 'akaun mana nak transfer', 'bagi akaun bank untuk deposit', 'hantar qr paynow'], a: TO_WRITE + ' (seorang pegawai memberi akaun bank terkini, kerana ia berubah).' } },
  { key: 'reset_turnover', topic: 'turnover', type: 'answer', tag: 'DEPOSIT / WITHDRAW · ASK RESET TURNOVER',
    en: { q: ['how to reset turnover', 'can you reset my turnover', 'turnover reset', 'clear my turnover'], a: TO_WRITE + ' whether turnover can be reset, and how.' },
    ms: { q: ['macam mana nak reset turnover', 'boleh reset turnover saya', 'reset turnover', 'kosongkan turnover saya'], a: TO_WRITE + ' sama ada turnover boleh direset, dan caranya.' } },
  { key: 'withdraw_cant', topic: 'withdraw', type: 'needs_staff', tag: 'DEPOSIT / WITHDRAW · CANT WITHDRAW',
    en: { q: ['i cannot withdraw', 'withdraw failed', 'why can i not withdraw', 'my withdraw is rejected'], a: TO_WRITE + ' (a person checks why the withdraw does not work).' },
    ms: { q: ['saya tak boleh withdraw', 'withdraw gagal', 'kenapa tak boleh withdraw', 'withdraw saya ditolak'], a: TO_WRITE + ' (seorang pegawai menyemak kenapa withdraw tak jadi).' } },
  { key: 'check_turnover', topic: 'turnover', type: 'answer', tag: 'GAME ISSUE · CHECK TURNOVER',
    en: { q: ['how much turnover do i have left', 'check my turnover', 'how to see my turnover', 'what is my turnover'], a: TO_WRITE + ' how a member sees the turnover left.' },
    ms: { q: ['berapa turnover saya tinggal', 'semak turnover saya', 'macam mana nak tengok turnover', 'turnover saya berapa'], a: TO_WRITE + ' cara ahli melihat baki turnover.' } },
  { key: 'credit_missing', topic: 'game', type: 'needs_staff', tag: 'GAME ISSUE · CREDIT MISSING', words: ['game', 'slot', 'spin', 'credit missing', 'kredit hilang', 'permainan', '游戏'],
    en: { q: ['my credit is missing in the game', 'credit not in game', 'the credit disappeared', 'game credit not showing'], a: TO_WRITE + ' (a person checks the game credit).' },
    ms: { q: ['kredit saya hilang dalam game', 'kredit tak masuk game', 'kredit lesap', 'kredit game tak keluar'], a: TO_WRITE + ' (seorang pegawai menyemak kredit game).' } },
  { key: 'game_tips', topic: 'game', type: 'answer', tag: "PLAYER'S INQUIRY · GAME TIPS",
    en: { q: ['any game tips', 'how to win', 'which game is easy to win', 'give me a playing strategy'], a: TO_WRITE + ' what the bot says when a member asks for game tips (for example that tips are not given).' },
    ms: { q: ['ada tips game', 'macam mana nak menang', 'game mana senang menang', 'bagi strategi main'], a: TO_WRITE + ' apa yang bot cakap bila ahli minta tips game (contohnya tips tidak diberi).' } },
  { key: 'complaint_lost_game', topic: 'complaint', type: 'needs_staff', tag: 'COMPLAINT · LOSE GAME', words: ['complaint', 'complain', 'aduan', 'rigged', 'scam', 'tipu', '投诉'],
    en: { q: ['i lost all my money, i want to complain', 'the game is rigged', 'i keep losing', 'complaint about losing'], a: TO_WRITE + ' (a person handles the complaint).' },
    ms: { q: ['saya kalah semua duit, nak complain', 'game ni tipu', 'saya asyik kalah', 'aduan pasal kalah'], a: TO_WRITE + ' (seorang pegawai mengendalikan aduan).' } },
  { key: 'complaint_other', topic: 'complaint', type: 'needs_staff', tag: 'COMPLAINT · OTHER',
    en: { q: ['i want to make a complaint', 'i am not happy with the service', 'this is unacceptable', 'complaint about your staff'], a: TO_WRITE + ' (a person handles the complaint).' },
    ms: { q: ['saya nak buat aduan', 'saya tak puas hati dengan servis', 'ini tak boleh diterima', 'aduan pasal staf'], a: TO_WRITE + ' (seorang pegawai mengendalikan aduan).' } },
  { key: 'rule_violation', topic: 'violation', type: 'needs_staff', tag: "PLAYER'S INQUIRY · VIOLATION OF RULES", words: ['violation', 'blocked', 'suspended', 'banned', 'akaun disekat', 'bonus dibatalkan', '封号'],
    en: { q: ['why is my account blocked', 'my bonus was cancelled', 'my account is suspended', 'why was my bonus removed'], a: TO_WRITE + ' (a person explains why the account or bonus was affected).' },
    ms: { q: ['kenapa akaun saya disekat', 'bonus saya dibatalkan', 'akaun saya digantung', 'kenapa bonus saya dibuang'], a: TO_WRITE + ' (seorang pegawai menerangkan kenapa akaun atau bonus terjejas).' } },
  { key: 'promo_poster', topic: 'promotion', type: 'needs_staff', tag: "PLAYER'S INQUIRY · ADS",
    en: { q: ['i saw this promotion in your ad', 'the promo in the poster', 'is this promotion still valid', 'i want the promo from your advertisement'], a: TO_WRITE + ' (a person checks the ad or poster the member sent).' },
    ms: { q: ['saya nampak promosi ni dalam iklan', 'promo dalam poster', 'promosi ni masih ada ke', 'saya nak promo dari iklan awak'], a: TO_WRITE + ' (seorang pegawai menyemak iklan atau poster yang dihantar).' } },
];

const cell = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
const HEAD = 'intent_key,topic,question_type,language,entry_type,question_examples,answer_text,topic_short_forms';

/** The tags of the list that the bot does not need an entry for, and why (shown beside the pack). */
export const COVERED_ELSEWHERE: [string, string][] = [
  ['DEPOSIT STATUS, WITHDRAW STATUS, MIN IN / OUT', 'Already answered by deposit_time, withdraw_time, deposit_limit and withdraw_limit (and the live account lookup for a logged-in customer).'],
  ['FORGET PASSWORD, REQUEST CHANGE BANK ACCOUNT', 'Already in the knowledge base as forgot_password and change_bank.'],
  ['CHAT ONLY: UNCLEAR QUESTION, NO ASK QUESTION', 'The bot asks once when it is unsure, and a plain "hi" or a sticker gets a friendly reply, so these need no entry.'],
  ['COMPLAINT and OTHER', 'Complaints, rude words and anything the bot cannot match already go to a person.'],
];

export const STARTER_ENTRIES = ROWS.length;
export const STARTER_TOPICS_NEW = [...new Set(ROWS.filter((r) => r.words).map((r) => r.topic))];

/** The pack as a CSV for the Import screen: English and Malay for every entry. */
export function starterCsv(): string {
  const out = [HEAD];
  for (const r of ROWS) for (const [lang, x] of [['en', r.en], ['ms', r.ms]] as const)
    out.push([r.key, r.topic, '', lang, r.type, x.q.join(' | '), x.a, lang === 'en' && r.words ? r.words.join(' | ') : ''].map(cell).join(','));
  return out.join('\n');
}
/** Which category of the list each entry came from, for the tags column shown on the Import screen. */
export const STARTER_TAGS: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r.key, r.tag]));
