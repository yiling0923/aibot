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
