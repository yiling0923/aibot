# LiveChat AI bot (runs on localhost)

A multi-merchant bot for a LiveChat account. Each merchant has its own knowledge base, topics, keywords and settings.
Everything here runs on your own computer. Nothing is connected to LiveChat yet (that is phase 8).

## What is built so far

| Phase | Status |
|---|---|
| 0. Project setup | done |
| 1. Database (schema, migrations, fake template data) | done |
| 2. Bot engine in TypeScript, **all 149 acceptance cases pass** | done |
| 3. AI layer (Claude picks, ChatGPT writes) | next |
| 4. Chat test page + automatic keyword saving | |
| 5. Control panel | |
| 6. Account lookup and login token | |
| 7. Hardening | |
| 8. LiveChat connection | |

## Set it up on your machine

You need **Node.js 20 or newer** and **Docker** (for the database).

```bash
cd livechat-bot
cp .env.example .env              # default values work for localhost
docker compose up -d              # starts PostgreSQL (also creates a separate test database)
npm install
npm run db:migrate                # creates the tables
npm run db:seed                   # loads the 3 fake merchants (LuckyPay, SwiftWallet, MegaPlay)
npm test                          # runs the tests
npm run dev                       # starts the API on http://localhost:3000
```

Try it:

```bash
curl localhost:3000/health
curl -X POST localhost:3000/api/analyze -H 'content-type: application/json' \
     -d '{"merchant":"MERCH_A","text":"I nak wd"}'
```

`npm run db:reset` wipes the database and loads the fake data again.

## Tests

* `npm test` runs the engine tests (no database needed): the 149 acceptance messages plus extra checks.
* The database tests run too when `TEST_DATABASE_URL` is set (it is in `.env.example`). They wipe that database every time,
  so it must be the separate `livechat_bot_test` database, never your real data.
* `npm run typecheck` checks the TypeScript.

## How it is organised

```
src/engine/    the decision logic (no network, no AI): normalize, keywords, guards, greetings, amounts, buttons
src/db/        connection, migrations, seed loader, loadKnowledge() (database -> engine)
src/server/    the API (Fastify)
db/migrations/ SQL files, run in name order. *.optional.sql may be skipped (pgvector)
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
