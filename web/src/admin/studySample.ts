/**
 * About 140 made-up customer question -> staff reply chats (English and Malay), only to try the Study screen without real chats.
 * It holds the usual topics, a few filler rows and a phone number, so the cleaning has something to show.
 */
const GROUPS: { reply: string; questions: string[] }[] = [
  { reply: 'Deposits are usually credited within 5 minutes. If it takes longer, please send us your payment receipt.',
    questions: ['how long does deposit take', 'my deposit not in yet', 'depo still pending', 'deposit belum masuk', 'berapa lama deposit masuk', 'when will my deposit arrive', 'dep not arrive'] },
  { reply: 'Withdrawals are processed within 30 minutes. If it takes longer, please wait a little or contact us with your username.',
    questions: ['how long withdraw take', 'my withdrawal not received', 'wd still processing', 'tarik duit belum masuk', 'berapa lama withdraw', 'when will i get my withdrawal'] },
  { reply: 'Yes! VIP has 5 levels. Deposit more to move up and get bigger bonuses every week.',
    questions: ['do you have vip', 'how to join vip club', 'what is vip level', 'macam mana nak jadi vip', 'vip benefit apa', 'how to upgrade vip'] },
  { reply: 'New members get free credit after verifying the phone number. Please check the promotion page for the amount.',
    questions: ['is there free credit for new member', 'how to claim free credit', 'ada free credit tak', 'new user dapat free ke', 'any free bonus for new account'] },
  { reply: 'Please check your remaining turnover in the Wallet page under Promotion records.',
    questions: ['how much turnover left', 'wait for turnover how many', 'check turnover', 'berapa lagi turnover', 'turnover saya tinggal berapa', 'how to see my turnover'] },
  { reply: 'Please reset your password using Forgot Password on the login page, then try again.',
    questions: ['cannot login', 'forgot my password', 'lupa password', 'tak boleh login', 'login error what to do', 'how to reset password'] },
  { reply: 'The minimum deposit is RM30 and the maximum is RM30,000 for each transaction.',
    questions: ['minimum deposit', 'what is the min deposit', 'deposit minimum berapa', 'max deposit per day', 'what is the maximum deposit'] },
  { reply: 'Please contact us with the receipt and your username. We will check the bank account change for you.',
    questions: ['how to change bank account', 'want to change my bank', 'tukar akaun bank', 'update bank details please', 'change withdrawal bank'] },
  { reply: 'The bonus is credited automatically after your first deposit. Turnover of 10 times applies before you can withdraw.',
    questions: ['how to claim welcome bonus', 'first deposit bonus how', 'bonus deposit pertama macam mana', 'welcome bonus turnover', 'is there a bonus for first deposit'] },
];
const NOISE: [string, string][] = [
  ['hi', 'Hello'], ['hello', 'Hi there'], ['my deposit not in', 'wait'], ['deposit problem', 'Alright'], ['please check for me', 'one moment'],
  ['hi boss', 'ok'], ['check my slip', 'Done RM100 credited to your account'], ['pls call me 0123456789', 'Done, we have added RM50 to your account'], ['thanks', 'You are welcome, thank you'],
];
const cell = (s: string) => '"' + s.replace(/"/g, '""') + '"';

/** The sample as CSV (question, reply). Each question is repeated with small changes so the held-back test part is not empty. */
export function studySampleCsv(): string {
  const rows: [string, string][] = [];
  for (const g of GROUPS) g.questions.forEach((q, i) => { rows.push([q, g.reply]); rows.push([q + ' pls', g.reply]); if (i % 2 === 0) rows.push(['hi ' + q, g.reply]); });
  rows.push(...NOISE);
  return ['question,reply', ...rows.map(([q, r]) => cell(q) + ',' + cell(r))].join('\n');
}
