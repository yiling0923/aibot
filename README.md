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
mysql -u root -p < db/setup.sql   # creates the databases and the "bot" user (asks for your MySQL root password)
npm install
npm run db:migrate                # creates the tables
npm run db:seed                   # loads the 6 fake merchants (LuckyPay, SwiftWallet, MegaPlay, BetKing, CashPoint, GameHub)
npm test                          # runs the tests
npm run dev                       # builds the front end, then starts the bot on http://localhost:3000
```

The front end (React + TypeScript + Vite) lives in `web/`. `npm run build` builds it into `web/dist`, which the bot serves.
While you work on the screens, run `npm run dev:web` in a second terminal for instant reloads on http://localhost:5173 (it passes API calls to the bot on port 3000).

Open **http://localhost:3000** for the test chat page: pick a merchant, choose who is chatting, type like a customer, and read what the bot did on the right.
Every word you type is saved to the keyword store, and messages the bot did not understand are saved for review.

Open **http://localhost:3000** and sign in. Demo logins (loaded by `npm run db:seed`):

| Username | Password | Can do |
|---|---|---|
| `admin` | `admin123` | everything, all merchants |
| `luckypay`, `swiftwallet`, `megaplay`, `betking`, `cashpoint`, `gamehub` | `demo123` | only their own merchant: the merchant is fixed, there is no picker |

Merchant staff can change their own entries, short forms, tone and fixed messages. The server refuses everything else
(other merchants, shared word lists, limits, tools, roll back), even if a request is sent by hand.
An admin adds merchants and logins in the panel under **Setup > Merchants & logins**: a new merchant starts with an empty knowledge base,
and its first staff login can be created in the same step. Everyone can change their own password with **Change my password**.
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

`npm run db:reset` wipes the database and loads the fake data again.

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
* The database tests run too when `TEST_DATABASE_URL` is set (it is in `.env.example`, and `db/setup.sql` creates it). They wipe that database every time,
  so it must be the separate `livechat_bot_test` database, never your real data.
* `npm run typecheck` checks the TypeScript (back end and front end).
* Front end tests are in `web/src` (React Testing Library). They run with `npm test` too.
* `npm run eval:report` runs all ~1,900 sample customer messages (English, Malay, Chinese, slang and short forms) through the engine and lists every one that gets a different result than expected.
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

## Looking at one merchant in phpMyAdmin

Open `livechat_bot` and use the views that start with `v_` (`v_merchants`, `v_answers`, `v_keywords`, `v_unmatched`, `v_settings`, `v_words`, `v_chats`, `v_logins`).
Each shows the merchant first: open one and filter the `merchant_code` column. They are read-only, so make changes in the control panel.
Run `npm run db:migrate` once after pulling to create them.
