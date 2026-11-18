import { describe, it, expect } from 'vitest';
import { readXlsx, rowsToCsv, writeXlsx } from './xlsx';
import { parseTable } from './model';

describe('xlsx', () => {
  it('writes a file that reads back the same, with commas, quotes, new lines, Chinese and & < >', () => {
    const rows = [['intent_key', 'topic', 'language', 'question_examples', 'answer_text'], ['deposit_time', 'deposit', 'en', 'how long | depo "late"', 'Within 5 min, "usually" & <fast>\nSecond line'], ['充值', '', 'zh', '', '充值通常在5分钟内到账。']];
    const back = readXlsx(writeXlsx(rows, [18, 14, 10, 40, 60]));
    expect(back).toEqual([rows[0], rows[1], ['充值', '', 'zh', '', '充值通常在5分钟内到账。']]);
  });
  it('keeps an empty cell in the middle in its place', () => {
    expect(readXlsx(writeXlsx([['a', 'b', 'c'], ['1', '', '3']]))[1]).toEqual(['1', '', '3']);
  });
  it('turns rows into CSV that the importer reads back', () => {
    const rows = [['a', 'b'], ['x, y', 'say "hi"\nnow']];
    expect(parseTable(rowsToCsv(rows))).toEqual(rows);
  });
  it('says plainly when the file is not an Excel file', () => {
    expect(() => readXlsx(new TextEncoder().encode('intent_key,topic'))).toThrow(/not an Excel/);
  });
  it('reads shared strings and numbers, as Excel itself saves them', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const data = zipSync({
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row><row r="2"><c r="B2" t="s"><v>1</v></c></row></sheetData></worksheet>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Entry</t></si><si><r><t>Hello </t></r><r><t>there</t></r></si></sst>'),
    });
    expect(readXlsx(data)).toEqual([['Entry', '', '42'], ['', 'Hello there']]);
  });
});
