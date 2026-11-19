const HEAD_ROW = ['intent_key', 'topic', 'language', 'question_examples', 'answer_text'];
export const WIDTHS = [22, 16, 11, 52, 70];
/** English only, the way a marketing team can fill it in. The AI can translate the other languages on import. */
export const EXAMPLE_ROWS: string[][] = [HEAD_ROW,
  ['deposit_time', 'deposit', 'en', 'how long does deposit take | depo not in yet | deposit still pending', 'Deposits are usually credited within 5 minutes. If it takes longer, please send us your payment receipt.'],
  ['deposit_limit', 'deposit', 'en', 'minimum deposit | max deposit per day | deposit limit', 'The minimum deposit is RM30 and the maximum is RM30,000 for each transaction.'],
  ['withdraw_time', 'withdraw', 'en', 'how long does withdraw take | wd still processing | when will i get my withdrawal', 'Withdrawals are processed within 30 minutes. Bank delays may add up to 1 hour.'],
  ['forgot_password', 'password', 'en', 'forgot password | cannot login | reset my password', 'Tap "Forgot password" on the login page and follow the steps. A reset link is sent to your registered phone.'],
  ['bonus_claim', 'promotion', 'en', 'how to claim bonus | bonus not received | where is my bonus', 'Bonuses are added to your wallet within 10 minutes after your first deposit. Check Wallet > History.']];
export const BLANK_ROWS: string[][] = [HEAD_ROW, ['example_entry', 'deposit', 'en', 'first example question | second example question | third example question', 'The answer the bot may use. Facts only.']];

/** An export of past chats: one row for each message. The bot learns the questions customers asked and the replies staff gave. */
export const CHAT_HEAD = ['chat_id', 'sender', 'text', 'time'];
export const CHAT_WIDTHS = [14, 12, 80, 20];
export const CHAT_EXAMPLE_ROWS: string[][] = [CHAT_HEAD,
  ['c1001', 'customer', 'deposit not in yet', '2026-10-01 10:02'], ['c1001', 'staff', 'Please send your receipt. We will check within 5 minutes.', '2026-10-01 10:03'], ['c1001', 'customer', 'ok sent', '2026-10-01 10:04'], ['c1001', 'staff', 'Thank you, it is credited now.', '2026-10-01 10:09'],
  ['c1002', 'customer', 'how long does withdraw take', '2026-10-01 11:15'], ['c1002', 'staff', 'Withdrawals are processed within 30 minutes.', '2026-10-01 11:16'],
  ['c1003', 'customer', 'forgot password', '2026-10-02 09:40'], ['c1003', 'staff', 'Tap Forgot password on the login page and follow the steps.', '2026-10-02 09:41']];
