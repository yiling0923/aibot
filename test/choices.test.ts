import { describe, it, expect, afterEach } from 'vitest';
import { Bot, newSession } from '../src/bot/responder';
import { makeToken } from '../src/bot/token';
import { knowledgeFromSeed } from '../src/engine';
import { MORE_HELP } from '../src/bot/texts';
import { seedJson, accountsJson } from './helpers';

const bot = new Bot(knowledgeFromSeed(seedJson, accountsJson));
const cfg = bot.engine.merchant('MERCH_A');
const original = { maxChoices: cfg.maxChoices, moreHelpOn: cfg.moreHelpOn, moreHelp: { ...cfg.moreHelp } };
afterEach(() => { cfg.maxChoices = original.maxChoices; cfg.moreHelpOn = original.moreHelpOn; cfg.moreHelp = { ...original.moreHelp }; });
const say = async (text: string, token: string | null = null) => (await bot.message(newSession('c-' + text + token, 'MERCH_A', token), text))!;
const options = (t: { buttons: { kind: string; key: string }[] | null }) => (t.buttons ?? []).filter((b) => b.kind !== 'agent');

describe('Part E: at most 5 choices (3 by default), and a line after them', () => {
  it('shows at most 3 choices by default and always adds "Talk to an agent" on top', async () => {
    const t = await say('xyzzy qwerty');                                   // not understood: the bot asks again with the topics (4 exist)
    expect(t.trace.decision).toBe('REASK');
    expect(options(t)).toHaveLength(3);
    expect(t.buttons!.at(-1)!.kind).toBe('agent');
    expect(t.trace.choicesCut).toEqual({ shown: 3, had: 4, max: 3 });
  });

  it('a merchant can set the number of choices from 1 to 5; more than 5 is read as 5 and 0 as the default 3', async () => {
    cfg.maxChoices = 1; expect(options(await say('xyzzy qwerty'))).toHaveLength(1);
    cfg.maxChoices = 2; expect(options(await say('xyzzy qwerty'))).toHaveLength(2);
    cfg.maxChoices = 4; expect(options(await say('xyzzy qwerty'))).toHaveLength(4);      // all four that the bot has
    cfg.maxChoices = 5; expect(options(await say('xyzzy qwerty'))).toHaveLength(4);      // 5 is allowed; only four exist here
    cfg.maxChoices = 9; expect((await say('xyzzy qwerty')).trace.choicesCut).toBeUndefined();   // 9 is read as 5: nothing is cut
    cfg.maxChoices = 0; expect(options(await say('xyzzy qwerty'))).toHaveLength(3);      // 0 is read as the default
  });

  it('leaves a menu alone when it already fits', async () => {
    const t = await say('deposit');                                        // how / time / limit
    expect(options(t).map((b) => b.key)).toEqual(['deposit_how', 'deposit_time', 'deposit_limit']);
    expect(t.trace.choicesCut).toBeUndefined();
  });

  it('never offers "where is my deposit" (an account check), even to a signed-in member', async () => {
    const tom = makeToken({ customer_id: 8841, name: 'Tom' });
    const t = await say('deposit', tom);
    expect(options(t).map((b) => b.kind)).not.toContain('status');
    expect(options(t).map((b) => b.key)).toEqual(['deposit_how', 'deposit_time', 'deposit_limit']);   // plain answers only: the account check is not one of them
  });

  it('adds the standard sentence after the choices, in the customer language', async () => {
    expect((await say('xyzzy qwerty')).hint).toBe(MORE_HELP.en);
    const zh = await say('存款');
    expect(zh.hint).toBe(MORE_HELP.zh);
  });

  it('can be switched off, and reworded per language', async () => {
    cfg.moreHelpOn = false; expect((await say('xyzzy qwerty')).hint).toBeNull();
    cfg.moreHelpOn = true; cfg.moreHelp = { en: '  Need more help? Tap "Talk to an agent".  ' };
    expect((await say('xyzzy qwerty')).hint).toBe('Need more help? Tap "Talk to an agent".');
    expect((await say('存款')).hint).toBe(MORE_HELP.zh);                      // no custom Chinese line: the standard one
    cfg.moreHelp = { en: '   ' }; expect((await say('xyzzy qwerty')).hint).toBe(MORE_HELP.en);   // blank means standard
  });

  it('adds no line when there is nothing to choose except the agent, or no choices at all', async () => {
    const refuse = await say('give me my password');
    expect(options(refuse)).toHaveLength(0); expect(refuse.hint).toBeNull();
    const answer = await say('how to deposit');
    expect(answer.buttons).toBeNull(); expect(answer.hint ?? null).toBeNull();
  });

  it('applies to a tapped button too (a topic that opens a menu)', async () => {
    const t = bot.pick(newSession('tap', 'MERCH_A', null), { kind: 'topic', key: 'deposit', label: 'Deposits', lang: 'en' })!;
    expect(options(t).length).toBeLessThanOrEqual(3);
    expect(t.hint).toBe(MORE_HELP.en);
  });
});
