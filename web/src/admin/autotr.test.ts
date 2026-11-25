import { describe, expect, it } from 'vitest';
import { langOptions, wordLang, sourceLang, targetLangs } from './autotr';

describe('merchant languages', () => {
  const vn = { code: 'V', name: 'V', default_language: 'vi', languages: 'vi,en' } as never;
  const my = { code: 'M', name: 'M', default_language: 'ms', languages: null } as never;
  it('lists the main language first, then the others, then languages that have words', () => {
    expect(sourceLang(vn)).toBe('vi'); expect(targetLangs(vn)).toEqual(['en']);
    expect(langOptions(vn, ['zh', 'en']).map(([k]) => k)).toEqual(['vi', 'en', 'zh']);
    expect(langOptions(my).map(([k]) => k)).toEqual(['ms', 'en', 'zh']);                       // a merchant that never chose
  });
  it('a plain Latin word gets the main language when that is also plain Latin; the letters decide otherwise', () => {
    expect(wordLang('depo', my)).toBe('ms'); expect(wordLang('depo', vn)).toBe('en');
    expect(wordLang('充值', my)).toBe('zh'); expect(wordLang('nạp tiền', my)).toBe('vi');
  });
});
