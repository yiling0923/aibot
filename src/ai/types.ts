/** What the bot needs from the AI services. Everything returns null when the AI is off, slow, fails, or gives an unusable answer,
 *  and the bot then carries on exactly as it does without AI. */
export interface PickInput {
  /** The merchant code: the AI key saved for that merchant is used (else the shared one). */
  merchant?: string; merchantName: string; text: string; lang: string;
  entries: { key: string; topic: string; aspect: string | null; examples: string[] }[];
}
export interface Pick { intent: string; confidence: number }

export interface WriteInput { merchant?: string; merchantName: string; tone: 'friendly' | 'formal'; lang: string; customerText: string; facts: string }

export const WORD_TYPES = ['filler', 'slang', 'topic', 'question', 'rude', 'greeting', 'negation', 'other'] as const;
export type WordType = (typeof WORD_TYPES)[number];
export interface DescribeInput { merchant?: string; word: string; sample: string; merchantName: string; topics: string[] }
export interface WordNote { note: string; type: WordType }

export type TranslateLang = 'en' | 'ms' | 'zh';
export interface TranslateInput { merchant?: string; merchantName: string; from: TranslateLang; to: TranslateLang; answer: string; examples: string[] }
export interface Translation { answer: string; examples: string[] }

export interface AiService {
  /** Claude can match a message to a knowledge base entry. */
  canPick: boolean;
  /** ChatGPT can write the reply. */
  canWrite: boolean;
  /** Claude can describe a new keyword. */
  canDescribe: boolean;
  /** Claude can translate an answer and its example questions into another language (always checked by a person afterwards). */
  canTranslate: boolean;
  pickEntry(input: PickInput): Promise<Pick | null>;
  writeReply(input: WriteInput): Promise<string | null>;
  describeWord(input: DescribeInput): Promise<WordNote | null>;
  translate(input: TranslateInput): Promise<Translation | null>;
}

/** Claude's match must be at least this sure before the bot answers with it. */
export const PICK_MIN_CONFIDENCE = 0.75;
