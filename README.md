# LiveChat AI bot (runs on localhost)

A multi-merchant bot for a LiveChat account. Each merchant has its own knowledge base, topics, keywords and settings.
Everything here runs on your own computer. Nothing is connected to LiveChat yet (that is phase 8).

**Full system document** (how it works, technology, database design, screens and layout): [docs/SYSTEM_DESIGN.pdf](docs/SYSTEM_DESIGN.pdf), also as [docs/SYSTEM.md](docs/SYSTEM.md).

## What is built so far

| Phase | Status |
|---|---|
| 0. Project setup | done |
| 1. Database (schema, migrations, fake template data) | done |
| 2. Bot engine in TypeScript, **all 149 acceptance cases pass** | done |
| 3. AI layer (Claude picks, ChatGPT writes) | built, switches on when the keys are added |
| 4. Chat test page + automatic keyword saving | done |
| 5. Control panel | done |
| 6. Account lookup and login token | |
| 7. Hardening | |
| 8. LiveChat connection | |

## Set it up on your machine

You need **Node.js 20 or newer** and **MySQL 8**. Install MySQL from https://dev.mysql.com/downloads/installer/ (Windows) or `brew install mysql` (Mac) / `apt install mysql-server` (Linux).

```bash
cd aibot
cp .env.example .env              # default values work for localhost (Windows: copy .env.example .env)
mysql -u root -p < db/setup.sql   # creates the databases and the "bot" user (asks for your MySQL root password; in PowerShell use: mysql -u root -p -e "source db/setup.sql")
npm install
npm run db:migrate                # creates the tables, and one database for each merchant
npm run db:seed                   # loads the 6 fake merchants (LuckyPay, SwiftWallet, MegaPlay, BetKing, CashPoint, GameHub)
npm test                          # runs the tests
npm run dev                       # builds the front end, then starts the bot on http://localhost:3000
```

The front end (React + TypeScript + Vite) lives in `web/`. `npm run build` builds it into `web/dist`, which the bot serves.
If Windows does not allow writing to `web/dist` (for example it was once built from an Administrator window), the build picks a new folder by itself (`web/dist-<number>`, remembered in `web/.outdir`) and the server uses it. Nothing to fix by hand. Run `npm run dev` from a normal PowerShell opened in the project folder.
While you work on the screens, run `npm run dev:web` in a second terminal for instant reloads on http://localhost:5173 (it passes API calls to the bot on port 3000).

Open **http://localhost:3000** and sign in. The control panel is at `/admin`; the test chat page is `/chat` (and the **Test chat** screen inside the panel): pick a merchant, choose who is chatting, type like a customer, and read what the bot did on the right.
Every word you type is saved to that merchant's keyword store, and messages the bot did not understand are saved too. Demo logins (loaded by `npm run db:seed`):

| Username | Password | Can do |
|---|---|---|
| `admin` | `admin123` | everything, all merchants |
| `luckypay`, `swiftwallet`, `megaplay`, `betking`, `cashpoint`, `gamehub` | `demo123` | only their own merchant: the merchant is fixed, there is no picker |

Merchant staff can change their own entries, short forms, tone and fixed messages. The server refuses everything else
(other merchants, shared word lists, limits, tools, rolling back the shared lists), even if a request is sent by hand.
An admin adds merchants and logins in the panel under **Setup > Merchants & logins**: a new merchant starts with an empty knowledge base,
and its first staff login can be created in the same step. An admin resets a login's password with the key icon in the logins list.
The same can be done from the command line (the merchant must already exist):

```bash
npm run user:add -- <username> <password> staff <MERCHANT_CODE>
npm run user:add -- <username> <password> admin
```

Before real use, change the demo passwords and set `SESSION_SECRET` in `.env` to a long random value.

The control panel is at **http://localhost:3000/admin**. Edit entries, topics, keywords and settings, try them in the Test chat tab,
run the tests, and press **Publish**: the bot uses the new version straight away. Every publish is saved in History and can be rolled back.
Your edits stay a draft in the browser until you publish.

Or try the API directly:

```bash
curl localhost:3000/health
curl -X POST localhost:3000/api/analyze -H 'content-type: application/json' \
     -d '{"merchant":"MERCH_A","text":"I nak wd"}'
```

`npm run db:reset -- --force` wipes the database and loads the fake data again. **It deletes every merchant and their knowledge bases.** Without `--force` it refuses to run when there is data (the same for `npm run db:seed`). To keep your data and only bring the database up to date, use `npm run db:migrate` (the server also does this by itself when it starts).

## AI (optional)

Put the keys in `.env` (see `.env.example`) and restart. Without keys nothing changes: the bot answers from its own rules.

* **Claude** (`ANTHROPIC_API_KEY`): when no keyword matches a message, Claude is asked which knowledge base entry it is about.
  Its pick is checked against the real entries and ignored below 75% confidence, so the bot then asks again or hands off as before.
  Claude also writes a short note and suggests a type for every new keyword (the Keywords screen, and the **Describe new words with AI** button for older ones).
* **ChatGPT** (`OPENAI_API_KEY` and `OPENAI_MODEL`): phrases the knowledge base answer as a natural reply in the customer's language and the merchant's tone.
  A checker compares the reply with the answer: every number must be kept, and no new number, link or menu path may appear.
  If the checker refuses it, or the call fails, the standard wording is used.
* **What is sent:** the customer's message and the merchant's knowledge base text. Account data (balance, transactions, points) is never sent.
* **Cost control:** small models, short calls, a timeout, and `AI_MAX_CALLS_PER_HOUR`.

## Tests

* `npm test` runs the engine tests (no database needed): the 149 acceptance messages plus extra checks.
* The database tests run too when `TEST_DATABASE_URL` is set (it is in `.env.example`, and `db/setup.sql` creates it). They wipe that database (and the merchant databases that start with `livechat_bot_test_m_`) every time,
  so it must be the separate `livechat_bot_test` database, never your real data.
* `npm run typecheck` checks the TypeScript (back end and front end).
* Front end tests are in `web/src` (React Testing Library). They run with `npm test` too.
* `npm run eval:report` runs all ~3,000 sample customer messages (English, Malay, Chinese, Vietnamese, Thai, Filipino, slang and short forms) through the engine and lists every one that gets a different result than expected.
  Add a message by adding an entry to `eval_cases` in `data/kb_seed.json`.

The six fake merchants differ on purpose (tone, main language, limits, which entries and account tools they have), so a message can be answered by one merchant and handed to a human by another.

## How it is organised

```
src/engine/    the decision logic (no network, no AI): normalize, keywords, guards, greetings, amounts, buttons
src/db/        connection, migrations, seed loader, loadKnowledge() (database -> engine)
src/server/    the API (Fastify)
db/migrations/ SQL files, run in name order
db/setup.sql   creates the databases and the user (run once)
data/          the fake template data (kb_seed.json, fake_accounts.json)
test/          acceptance cases + database tests
```

## How a message is decided

1. Rude words, rule-change attempts, other merchants, secret requests (guards).
2. Greetings, thanks, call-outs and filler-only messages (never sent to a human).
3. Account data (balance, transactions, points), only when the merchant turned the tool on.
4. Keywords: the topic word and the question type are found anywhere in the sentence.
5. Amounts such as `cash 500`.
6. Buttons when the question is not clear, then similarity to example questions, then a human.

Each decision comes with a plain-language reason (`why`), which the control panel will show.

## One database for each merchant

The main database (`livechat_bot`) holds the merchant list, the logins and the words all merchants share.
Every merchant has its own database, `livechat_bot_m_<code>` (for example `livechat_bot_m_luckypay`), with that merchant's knowledge base, settings, keywords, chats, tests and publish history.
Adding a merchant in the control panel creates its database. Each merchant publishes and rolls back on its own.

**Updating from an older version (important):** the database user needs the right to create these databases. Run `db/setup.sql` again once as the MySQL admin (it is safe to repeat), then `npm run db:migrate`.
The migrate step moves the data of an older single-database installation into merchant databases. Nothing is lost, ids are kept.

To see the databases grouped in phpMyAdmin, add this line to `config.inc.php`:
`$cfg['NavigationTreeDbSeparator'] = '_m_';`

## Translating answers

In the entry editor, **Translate to Malay and Chinese** writes a draft translation of the English answer and example questions (on the MS and ZH tabs: **Translate from English**).
It needs the Anthropic key in `.env` (`ANTHROPIC_API_KEY`); without it the button is greyed out. The numbers, links and menu paths such as `Wallet > Deposit` must come back exactly as written, otherwise the translation is refused.
It is only a draft: check it, then **Save to draft** and publish as usual.

## Report and Not understood

Two screens under **Check** help to improve the bot:

* **Report** shows, for the open merchant and the last 7 or 30 days, how many messages the bot answered, did not understand or handed to a person, messages per day, and the answers used most. Messages typed in the Test chat are marked as test and can be left out.
* **Not understood** lists the messages the bot could not answer, most frequent first. Add one to an existing answer as an example question, make a new answer from it, or ignore it. Everything is a draft change until you publish.

After pulling, run `npm run db:migrate` once (it adds one column, `chat_sessions.source`, to every merchant database).

## LiveChat connection

The bot answers LiveChat's existing AI call, `POST {bot address}/api/v1/ai/ask` (see `docs`-free summary in the system document, section 11). LiveChat does not change.

1. Make a key for the merchant: `npm run key:create -- MERCH_A` (shown once; add `--replace` to stop the old keys), or as an admin `POST /api/admin/merchants/MERCH_A/bot-key`.
2. In LiveChat: Merchant Admin > Automation: set **AI Chat API base URL** to the bot's address (LiveChat's server must be able to reach it) and **AI Chat API key** to the key, then use **Test AI Chat**.
3. Try it by hand:

```bash
curl -X POST http://localhost:3000/api/v1/ai/ask -H "Authorization: Bearer aib_..." -H "Content-Type: application/json" -d '{"question":"depo how","history":[]}'
```

`ASK_TIMEOUT_MS` (default 8000) is how long the bot may take before the chat is handed to a person.



## Languages

The bot understands and answers in **English (en), Malay (ms), Chinese (zh), Vietnamese (vi), Thai (th) and Filipino (tl)**. It reads the language from the message itself (script and words), so a customer may switch language mid-chat; the reply follows the last message. `tl` is the code LiveChat uses for Filipino.

* **Replies.** Every fixed sentence of the bot (greetings, choices, account answers, refusals, kind replies to rude customers, "contact an agent") exists in all six languages and both tones: `src/bot/texts.ts` and `src/bot/texts_extra.ts`. A test fails if one is missing.
* **Words.** Topic words, question words, greetings, rude words, secret / rule-change / "talk to a person" phrases and filler words for the new languages are in `data/kb_seed.json`, and appear under the same screens as the others (Topics, Keywords, Keyword ranking), with a language filter.
* **Vietnamese accents.** Customers often type without accents (`nap tien` for `nạp tiền`). The bot ignores accents when it compares words, so one entry matches both. For the same reason the word lists avoid rude words that become everyday words without accents (for example `cặc` and `các`).
* **Thai.** Thai has no spaces, so Thai words are found as pieces of the sentence, and the sentence is cut into words (with the Node `Intl.Segmenter`) for the similarity check. Polite endings (ค่ะ ครับ นะ) are ignored. Keep Thai entries long enough not to sit inside other words.
* **Filipino.** Taglish works: English words customers really use (deposit, withdraw, agent) are listed next to the Filipino ones.
* **Knowledge bases.** Vietnamese, Thai and Filipino are optional for an entry (it is not marked "missing" for them). An entry with no answer in the customer's language answers in English. In the entry editor, **Translate to Vietnamese, Thai and Filipino** writes a draft with the AI. Please have a native speaker check it before publishing.
* **Existing databases** get the new word lists, the closing and hand-off messages, and the sample entries' translations automatically the first time the server starts (only where something is missing, and never over what you wrote).
* **Add or change the sample words:** edit `tools/seed-languages/build.py` and run `python3 tools/seed-languages/build.py`, or edit the words in the panel.
* **Not done yet:** amounts are still shown with `RM` and limits as written in each answer (a currency per merchant is a later step); the control panel itself is in English.


## How the bot decides

This follows the team plan ("AI Bot: Plan, Gap Study and Knowledge Base"). Every message goes through three steps, and the bot reports each one (in the reply as `keywords`, `topic`, `answer_id`, and in the panel's Test chat under "what the bot did"):

1. **Keywords:** the words the customer typed that the bot recognises (`depo`, `not in`, `充值`, `nạp tiền`). They are counted in the keyword reports. A keyword points to a topic (`depo` → deposit) or to a kind of question (`how long` → time).
2. **Topic:** what the customer wants (Deposit, Withdraw, Bonus, Account, Bank...). Each merchant owns its topic list: it starts from the shared template, and the merchant can add its own topics and keywords (staff too). Another merchant never sees them.
3. **Answer:** one answer per topic and, where needed, per kind of question. The rules decide first. Only when they are not sure does the AI pick an answer, from a **short list** (the closest entries, narrowed by topic), or say "none".

**The clarify rule**

* A clear question is answered straight away, with no choices.
* An unclear one (two topics score close, nothing is sure) gets **one** question with up to 3 choices, plus the agent. Example: "my money not in" has money words and a question about time but no topic, so the bot asks "deposits or withdrawals?".
* The customer may answer in their own words: "deposit", "depo", "1", "the first one". The bot reads that as an answer, and if the first message already said what was wanted (not in = how long it takes), it answers at once instead of asking a second question.
* If it is still unclear, a person takes over. The bot never asks twice. (A menu of questions about a known topic is part of the answer, not a clarifying question, but showing the same menu twice is.)

**LiveChat and its answer cache.** LiveChat remembers a reply by the words of the question only, for every customer, and checks that memory before it calls the bot. So the connector (a) never writes personal account data in a reply (those chats go to staff), and (b) marks every reply `cacheable: true|false`, with a confidence of 0.8 or less for the ones that must not be kept. LiveChat still needs one small change to honour the flag: see `docs/REQUEST_TO_LIVECHAT_TEAM.md`, which also has a no-code workaround.


## Topics: list and flowchart

The Topics screen has two views of the same data: **List** and **Flowchart**, a canvas with a block palette on the left (Topic, Keyword, Answer, If not clear) and connector lines: Keyword blocks → Topic block → Answer blocks → "If not clear" (asks once, then a person). Drag a block by its title to place it (places are remembered in the browser); drag from the round dot of a Keyword or Answer block onto a Topic block to move it there; drag Topic or Keyword from the palette onto the grid to add one; drag a word customers typed (not set yet) onto a topic. Zoom, Auto-arrange and Fit to screen are in the bar above the canvas. Every keyword and answer also has a ⇄ menu to move it, for keyboard and touch. Both views edit the same draft, so a change in one shows in the other. Shared keywords are read-only in the chart (admins edit them in the list).

## Report

The Report screen shows, per merchant and for 7 or 30 days: messages, share answered / not understood / handed to a person, messages per day, answers used most, **top topics**, **top keywords**, **topics handed to a person most** (a topic with many hand-offs needs a better answer) and the **wrong-answer rate**. The rate comes from staff marking recent answers *Right* or *Wrong* under "Check recent answers"; it is empty until some are marked. Topics and keywords are recorded from now on (older chats are not counted in those two lists).

## Knowledge base entry fields: type and end date

Each entry has two more optional fields (Knowledge base → Add/Edit entry):

- **Type:** *Answer* (default), *Needs staff* (the bot never answers it: the chat goes to a person; use it for anything about the customer's own account) or *Promotion*.
- **End date:** the entry is used until the end of that day, then hides itself (the bot behaves as if it did not exist). Works for any type, meant for promotions. The list shows "until" / "ended".

Saved through the same draft/publish path as every other entry change. Databases are updated when the server starts.

## Main keyword and the words under it

On the Topics screen the topic name is the **main keyword** (for example `deposit`). The words that point to it are grouped under it: **Short forms** (dep, depo, dp), **Slang**, **Same meaning** (topup, cash in) and **Other languages** (充值, tambah nilai). The panel groups them by itself: another language, or an abbreviation of the main word (the letters appear in order, starting with the same letter), or otherwise same meaning. When you add a keyword you can also choose its kind yourself (Kind: Short form / Slang / Same meaning) for your own merchant's words; the choice is saved and wins over the guess. Shared words (all merchants) are grouped by the guess only. The **Keywords** screen has the same arrangement: switch from *List* to *By main keyword* to see the words customers typed under their main keyword, in the same groups, with how many times each was heard. Each main keyword is one row: a bar shows how much of its typing came from each group (one colour in four strengths), and below it four columns list the words with a bar and the number of times each was heard. Words that still need a main keyword are in a box at the bottom (click one to make it a topic or put it under one); words that already have another job (filler, rude, question word, greeting) are in a separate box. The flowchart keeps its simple Keywords card. The bot's matching is not affected: every word still means the topic.
