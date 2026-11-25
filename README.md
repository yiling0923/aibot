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

Open **http://localhost:3000** and sign in. The control panel is at `/admin`. To try the bot as a customer, use **Check → LiveChat test** in the panel: it chats through a LiveChat, the way the website widget does.
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

The control panel is at **http://localhost:3000/admin**. Edit entries, topics, keywords and settings, try them with **Check → LiveChat test** after you publish,
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

The six fake merchants differ on purpose (tone, main language, limits, which entries they have), so a message can be answered by one merchant and handed to a human by another.

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
3. Nothing about the customer's account: the bot reads no account data.
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

## Report

**Check → Report** shows, for the open merchant and the last 7 or 30 days, how many messages the bot answered, did not understand or handed to a person, messages per day, the answers used most, the top topics and keywords, and the wrong-answer rate. Its **Not understood most** list shows the messages the bot could not answer, most frequent first; to fix one, add a keyword or an answer for it. (The separate *Not understood* and *Test chat* screens were removed: use **LiveChat test** to try the bot, and publish first, because it reaches the published bot.)

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

* **Replies.** Every fixed sentence of the bot (greetings, choices, refusals, kind replies to rude customers, "contact an agent") exists in all six languages and both tones: `src/bot/texts.ts` and `src/bot/texts_extra.ts`. A test fails if one is missing.
* **Words.** Topic words, question words, greetings, rude words, secret / rule-change / "talk to a person" phrases and filler words for the new languages are in `data/kb_seed.json`, and appear under the same screens as the others (Topics, Keywords, Keyword ranking), with a language filter.
* **Vietnamese accents.** Customers often type without accents (`nap tien` for `nạp tiền`). The bot ignores accents when it compares words, so one entry matches both. For the same reason the word lists avoid rude words that become everyday words without accents (for example `cặc` and `các`).
* **Thai.** Thai has no spaces, so Thai words are found as pieces of the sentence, and the sentence is cut into words (with the Node `Intl.Segmenter`) for the similarity check. Polite endings (ค่ะ ครับ นะ) are ignored. Keep Thai entries long enough not to sit inside other words.
* **Filipino.** Taglish works: English words customers really use (deposit, withdraw, agent) are listed next to the Filipino ones.
* **Knowledge bases.** Vietnamese, Thai and Filipino are optional for an entry (it is not marked "missing" for them). An entry with no answer in the customer's language answers in English. In the entry editor, **Translate to Vietnamese, Thai and Filipino** writes a draft with the AI. Please have a native speaker check it before publishing.
* **Existing databases** get the new word lists, the closing and hand-off messages, and the sample entries' translations automatically the first time the server starts (only where something is missing, and never over what you wrote).
* **Add or change the sample words:** edit `tools/seed-languages/build.py` and run `python3 tools/seed-languages/build.py`, or edit the words in the panel.
* **Not done yet:** amounts are still shown with `RM` and limits as written in each answer (a currency per merchant is a later step); the control panel itself is in English.


## How the bot decides

This follows the team plan ("AI Bot: Plan, Gap Study and Knowledge Base"). Every message goes through three steps, and the bot reports each one (in the reply as `keywords`, `topic`, `answer_id`):

1. **Keywords:** the words the customer typed that the bot recognises (`depo`, `not in`, `充值`, `nạp tiền`). They are counted in the keyword reports. A keyword points to a topic (`depo` → deposit) or to a kind of question (`how long` → time).
2. **Topic:** what the customer wants (Deposit, Withdraw, Bonus, Account, Bank...). Each merchant owns its topic list: it starts from the shared template, and the merchant can add its own topics and keywords (staff too). Another merchant never sees them.
3. **Answer:** one answer per topic and, where needed, per kind of question. The rules decide first. Only when they are not sure does the AI pick an answer, from a **short list** (the closest entries, narrowed by topic), or say "none".

**The clarify rule**

* A clear question is answered straight away, with no choices.
* An unclear one (two topics score close, nothing is sure) gets **one** question with up to 3 choices (the merchant can set 1 to 5 in Merchant settings → Replies → "Most choices shown at once"), plus the agent. Example: "my money not in" has money words and a question about time but no topic, so the bot asks "deposits or withdrawals?".
* The customer may answer in their own words: "deposit", "depo", "1", "the first one". The bot reads that as an answer, and if the first message already said what was wanted (not in = how long it takes), it answers at once instead of asking a second question.
* If it is still unclear, a person takes over. The bot never asks twice. (A menu of questions about a known topic is part of the answer, not a clarifying question, but showing the same menu twice is.)

**LiveChat and its answer cache.** LiveChat remembers a reply by the words of the question only, for every customer, and checks that memory before it calls the bot. So the connector (a) never writes personal account data in a reply (those chats go to staff), and (b) marks every reply `cacheable: true|false`, with a confidence of 0.8 or less for the ones that must not be kept. LiveChat still needs one small change to honour the flag: see `docs/REQUEST_TO_LIVECHAT_TEAM.md`, which also has a no-code workaround.


## Topics: list, flowchart and "How it works"

The Topics screen has two views of the same data: **List** and **Flowchart**, a canvas with a block palette on the left (Topic, Keyword, Answer, If not clear) and connector lines: Keyword blocks → Topic block → Answer blocks → "If not clear" (asks once, then a person). Drag a block by its title to place it (places are remembered in the browser); drag from the round dot of a Keyword or Answer block onto a Topic block to move it there; drag Topic or Keyword from the palette onto the grid to add one; drag a word customers typed (not set yet) onto a topic. Zoom, Auto-arrange and Fit to screen are in the bar above the canvas. Every keyword and answer also has a ⇄ menu to move it, for keyboard and touch. Both views edit the same draft, so a change in one shows in the other. Shared keywords are read-only in the chart (admins edit them in the list).

## Report

The Report screen shows, per merchant and for 7 or 30 days: messages, share answered / not understood / handed to a person, messages per day, answers used most, **top topics**, **top keywords**, **topics handed to a person most** (a topic with many hand-offs needs a better answer) and the **wrong-answer rate**. The rate comes from staff marking recent answers *Right* or *Wrong* under "Check recent answers"; it is empty until some are marked. Topics and keywords are recorded from now on (older chats are not counted in those two lists).

## Knowledge base entry fields: type and end date

Each entry has two more optional fields (Knowledge base → Add/Edit entry):

- **Type:** *Answer* (default), *Needs staff* (the bot never answers it: the chat goes to a person; use it for anything about the customer's own account) or *Promotion*.
- **End date:** the entry is used until the end of that day, then hides itself (the bot behaves as if it did not exist). Works for any type, meant for promotions. The list shows "until" / "ended".

Saved through the same draft/publish path as every other entry change. Databases are updated when the server starts.

## Main keyword and the words under it

On the Topics screen the topic name is the **main keyword** (for example `deposit`). The words that point to it are grouped under it: **Short forms** (dep, depo, dp), **Slang**, **Same meaning** (topup, cash in) and **Other languages** (充值, tambah nilai). The panel groups them by itself: another language, or an abbreviation of the main word (the letters appear in order, starting with the same letter), or otherwise same meaning. When you add a keyword you can also choose its kind yourself (Kind: Short form / Slang / Same meaning) for your own merchant's words; the choice is saved and wins over the guess. Shared words (all merchants) are grouped by the guess only. The **Keywords** screen has the same arrangement: switch from *List* to *By main keyword* to see the words customers typed under their main keyword, in the same groups, with how many times each was heard. Each main keyword is one row: a bar shows how much of its typing came from each group (soft blue, rose, green and lavender, one per group), and below it four columns list the words with a bar and the number of times each was heard. Words that still need a main keyword are in a table at the bottom (one row per word with a bar, the count and the buttons Make a main keyword / Add under one / Ignore; tick words to act on many at once). Words that already have another job are in a separate box, grouped as Rude words, Question words, Fillers and Greetings; click a word to change what it is. The flowchart keeps its simple Keywords card. The bot's matching is not affected: every word still means the topic.

## Merchants & logins, and the merchant page

**Merchants & logins** lists each merchant with its tone, number of answers, staff login and a **LiveChat link** tag: *Connected · used 2h ago* when the merchant has an active bot key (and when LiveChat last used it), or *No bot key yet*. Logins show their role as a tag. The actions on both tables are small icon buttons (open, key = change password, bin = delete); the words show when you hover. The **merchant page** is four numbered steps, each with a status tag and a tick when done: 1 LiveChat connection (bot address and key), 2 Test the link, 3 Handoff number (synced with LiveChat), 4 AI keys.

## Merchant settings: basics, token limit, languages, bot instructions

At the top of **Merchant settings** each merchant has four tiles (answers, questions today, AI tokens today, average confidence of today's answers), then:

- **Basics** (admin only, saved at once with *Save basics*): the merchant's **name**, an optional **domain**, a **monthly AI token limit** and the **languages the bot answers in**. When the monthly limit is used up (counted from the usage table, from the 1st of the month) the bot keeps answering from the knowledge base; only the AI help (choosing an answer, describing new words, translating, rewording) stops until next month. A customer writing in a language that is switched off still gets understood, and the reply is in the merchant's main language, which always stays on.
- **Bot instructions (style rules)**, up to 5000 characters, with quick presets (formal tone, "Dear Member", 2 sentences...). Staff may write them for their own merchant; they go to the draft like the other settings. They are added to the prompt of the wording jobs: **translating answers, describing new words and rewording a reply**. They only shape wording and tone and the prompt tells the AI never to add facts or change numbers. Choosing an answer from the short list does not use them. A fixed reply such as "if the customer asks about promotions, always say..." belongs in the Knowledge base as an answer, because the bot answers word for word from there and never invents replies.

## Handoff rules and cleaning up (per merchant)

On **Merchant settings**, under *Handoff rules*, every on/off setting is a switch row:

- **Customer asks for a person** and **Same question again, or the bot cannot answer** are always on (a customer must always be able to reach a person; the bot asks once, then hands over). **Picture or file sent** is shown but not available: LiveChat does not send files to the bot.
- **Complaint or dispute** (admin only): on = a rejected or failed transaction, "money not received", "scam" and similar go to a person. Off = the bot answers from the knowledge base as for any question.
- **Account details written in the chat** (admin only): 8 to 16 digits in a row (single spaces or dashes allowed), like a phone or bank account number, go to a person and the bot never repeats them. A short amount such as 100000, or 1,000,000 with commas, is not mistaken for one.
- **Custom trigger phrases** (staff may edit): comma separated, any language. A message containing one of them (as a whole word) goes straight to a person.

*Cleaning up* (admin only): **Keep conversations for (days)**. Chats older than this are deleted by a sweep every 6 hours (`RETENTION_SWEEP_MS`, 0 = never), together with their messages, the connector's chat memory and request log. Empty or 0 keeps everything, which is the default. The Report counts only chats that are kept; the keyword counts and the words list are separate and are not changed.

## Merchant settings in tabs

The Merchant settings page is grouped in tabs under the four tiles: **General** (name, domain, monthly AI token limit, keep conversations for N days, languages; saved at once with *Save basics*, which turns green when something changed), **Replies** (tone, match levels, the choices the bot offers, rude customers), **Handoff** (handoff rules, trigger phrases, and a link to the Human Handoff number on the merchant page), **AI help** (bot instructions and presets), **Messages** (fixed messages per language). The page remembers the last tab. Everything except the General tab goes to the draft; when you change something a dark bar at the bottom shows how many unsaved changes there are and which groups (for example "Complaint or dispute · Trigger phrases") with **Discard** and **Save to draft**.

## LiveChat test (a chat window through LiveChat)

**Check → LiveChat test** (admin only) is a chat window whose messages go through a LiveChat, the way its website widget sends them: the bot server starts (or continues) a chat in LiveChat with the same calls as `deploy/local-livechat/chat.ps1`, waits until the bot has answered, and shows the whole chat as bubbles. It tests the real link, with the bot as published. *Settings* holds the LiveChat address (default `http://localhost:8080`, the local setup) and the tenant id (default `1`); they are remembered in the browser. *New chat* starts a fresh visitor. If LiveChat does not answer within about 15 seconds the page says so; press Send with an empty box to look again. The bot server makes the calls, so the address must be reachable from the computer that runs the bot.

## Merchant API (switched off)

This section used to describe how the bot read a logged-in customer's balance, points, deposits and withdrawals from the merchant's own system. **The bot no longer does this** (see "Who the customer is, and no account data" below): the panel has no Account data step, no Account tools tab and no account switch, and a balance or deposit question goes to a person. The code is still in the repository (`src/bot/merchantApi.ts`, `src/bot/merchantApiHttp.ts`, `src/admin/merchantApiRoutes.ts`) but nothing in the bot calls it.

## Pictures in the LiveChat test page

What LiveChat takes from a customer is fixed by LiveChat itself: **JPEG and PNG pictures (5 MB), MP4 or MOV videos (15 MB) and PDF files (10 MB)**. Its upload needs a `kind` field (`image`, `video` or `file`); without it every file counts as a document and only PDFs pass. The test page sends `kind` and the member fields with each file. Emoji are plain text and work in any message.

A picture or file an agent sends shows in the chat (LiveChat sends `messageType: "image"` with an `attachment` holding `name`, `url`, `mimeType` and `size`; the `url` is a path on LiveChat, so the page puts the LiveChat address in front). The paperclip button sends a picture or file as the customer: a picture, PDF, text file or Office document up to 10 MB. LiveChat's message address takes plain JSON only (it answers `invalid_json` to a form), so a file needs a separate upload step. The upload address was found from LiveChat's own answers: `POST /widget/conversations/{id}/attachments` with the form field `file`; LiveChat answers `attachment_invalid` ("Unsupported attachment type.") for a file kind it does not take, and the page then says which file was refused. The chat is made first, then the bot server tries the addresses in turn (`UPLOAD_PATHS` in `src/livechat/chat.ts`, with the form field names `FILE_FIELDS`) and, when LiveChat answers with a stored file but no message, posts the message that carries it. If none works, the page shows every address tried with what LiveChat answered. Pass that text on, and the address and field can be matched to it. A message that is only a file name (what LiveChat sends the bot for a picture) is answered by handing the chat to a person.

The Greetings, Fillers and Block lists tabs have no flowchart (only topics connect to answers), but a read-only **How it works** view: each list on the left and what the bot does with it on the right (a friendly hello, dropped before matching, reply kindly and close, hand to a person, refuse politely). Click a list to open it. Every tab shows how many words it holds and one line about what it is for.

## FAQ category starter pack

Open **Import** and press **Load the FAQ category starter**, then **Import**. It adds 19 entries
(free credit, referral, login, verify phone, deposit, turnover, withdraw, complaints, rule violation, poster/ads and more).
Each has example questions in English and Malay.

- Everything starts as a **draft**. Nothing is live until you publish.
- Answers say `TO WRITE: …`. The editor and the Publish dialog flag them. The bot never says them to a customer.
- Entries that need a person (complaint, rule violation, ads, free credit request, and so on) are type **needs staff** and hand over to an agent.
- The seven named promotions and VIP belong to **LuckyPay** only. When LuckyPay is the chosen merchant, Import also shows **Load the LuckyPay promotions** (8 draft entries, English and Malay, answers say `TO WRITE`). Other merchants do not see it.

### Make LiveChat send the member to the bot (so the bot can tell a member from a visitor)

The bot uses the member only to note whether a customer is a logged-in member or a visitor (it reads no account data). The text below was written for account answers; the patch itself is unchanged.

LiveChat's call to the bot carries only `question`, `history` and `session_id`, so the bot sees every customer as a guest. The patch `deploy/local-livechat/patches/001-member-to-bot.patch` makes LiveChat add `member: { id, name, rank }` (from the chat's customer, when they signed in with a member id) and skip its answer cache for that member's chats. Apply it to your LiveChat folder (Windows, PowerShell, in the bot folder), then rebuild and restart LiveChat. The second command builds LiveChat again and starts the API and the worker:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\local-livechat\apply-member-patch.ps1 -LiveChatDir C:\livechat-develop
powershell -ExecutionPolicy Bypass -File deploy\local-livechat\setup-nodocker.ps1 -LiveChatDir C:\livechat-develop
```


**Picture patch (002).** LiveChat does not ask the bot about a message with a picture, video or file: it goes to the team and the customer hears nothing from the bot. `patches/002-picture-to-bot.patch` makes LiveChat ask the bot too, telling it only the file's kind and name (`attachment: { kind, name, mime_type, size }`, never the file; those chats are kept out of LiveChat's answer cache). The bot thanks the customer and hands the chat to a person, because it cannot open files. `apply-member-patch.ps1` applies both patches in order (001 first).

## Guided answers (ask for details, then a person)

The light version of the plan's flow builder: no drawing, just up to 3 questions after an answer. In the entry editor, section **5 After the answer: ask for details**. Each question asks for one of: a **receipt picture**, an **amount**, the **username**, a **phone number**, or a **short reply**, worded per language (English required; an empty language uses English).

What the customer sees: the bot gives the answer and asks question 1; each reply moves to the next question; after the last one the bot says "Thank you, I have passed your details to our team" and the chat goes to a person.

- **Checks.** An amount must contain a number, a phone number 8 to 15 digits, a username 2 to 60 characters (up to 4 words), a receipt must be a picture or file. A wrong reply is asked once more, then the question is skipped ("not given"). The customer can type `skip` / `cancel` / `no` (also `tak nak`, `batal`, `跳过`) to skip, or `agent` / `human` to go to a person at once. A new question (three or more words that the bot can answer) stops the questions and is answered.
- **The note.** The details go to LiveChat as the `reason` of the reply, one line: `Topic: deposit · Receipt: slip.png · Amount: RM100 · Username: tom8841`, and as `metadata.collected` (a list of `{ kind, value }`). A phone number or name the customer typed is **not** written to the bot's own logs (they show `[phone]` or `[details]`).
- **Pictures need patch 002.** LiveChat only tells the bot about a picture when `deploy/local-livechat/patches/002-picture-to-bot.patch` is applied. Without it, a receipt question cannot be answered; the customer can type `skip`.
- **Not saved as a cached reply.** A guided reply is marked `cacheable: false`.
- Code: `src/bot/responder.ts` (`startGuided`, `guidedReply`), `src/engine/steps.ts`, column `kb_entries.steps` (`db/merchant/012_steps.sql`), `web/src/admin/screens/Kb.tsx`. Tests: `test/guided.test.ts`.

## Setup checklist (merchant page)

**Merchants & logins → open a merchant** starts with a **Setup checklist**: what this merchant still needs before its bot can answer real customers, a progress bar, and a button for each step that is not done. After **Add merchant** the new merchant's page opens by itself, so the checklist is the first thing the admin sees. When everything is done it folds away to "complete" (a **Show the checklist** button opens it again).

| Step | Done when | Button |
|---|---|---|
| Staff login | at least one staff login for the merchant | Add a login |
| Bot key | an active bot key exists | Make key |
| LiveChat calls the bot | an active key has been used by LiveChat | Show the address and key |
| Answers | at least 10 live entries are *ready* (a real answer, not `TO WRITE`, and at least 3 example questions; a "needs staff" entry needs only the examples) | Open Import (no entries yet) or Open the knowledge base |
| No "TO WRITE" left | no entry still says `TO WRITE:` (shown only when it applies) | Open the knowledge base |
| Tried it | at least one chat exists (a test or a real customer) | Open LiveChat test |
| Bot is listening / answering | done when the bot answers; a merchant that only listens shows this step as to do | Open Learning |

The last step is counted: a new merchant starts by listening, so the checklist stays incomplete until an admin presses **Start answering** on the Learning page.

## A local LiveChat with several merchants

The local LiveChat (`setup-nodocker.ps1`) has one merchant, **Merchant A**, so its screen shows no merchant list. The real LiveChat has the **merchant switcher** (a box at the top and a list of merchants on the left) because the signed-in account belongs to many merchants or is a platform account. To get the same locally:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\local-livechat\add-merchants.ps1
```

It adds **SwiftWallet, MegaPlay, BetKing, CashPoint and GameHub** to the local LiveChat (`seed-merchants.sql`), makes `admin@a.test` a member of each, makes a bot key for each in the bot and sets it in that merchant's AI Bot settings. Sign in again and the merchants are at the top left. Each LiveChat merchant is answered from its own merchant's knowledge base (the key says which one asks), and its conversations stay in that merchant. LiveChat takes the merchant from `?tenant_id=N` in the address (A is 1, B is 2, C is 3 ...); the widget uses the `X-Tenant-ID` header. Run it again any time: merchants are never added twice (each run makes a new bot key, the older ones keep working).

**A merchant made in the bot panel is not made in LiveChat.** The bot panel and LiveChat each keep their own list of merchants; the bot key links one to the other. In the real LiveChat a platform account adds the merchant. In the local LiveChat run `add-merchant.ps1` for it (the code is shown under the merchant's name in the bot panel):

```powershell
powershell -ExecutionPolicy Bypass -File deploy\local-livechat\add-merchant.ps1 -Code 77Y8 -Name "77Y8"
```

It adds the merchant to the local LiveChat, makes `admin@a.test` a member, makes a bot key, sets it in that merchant's AI Bot settings and tests the link. Then refresh LiveChat and pick the merchant in the list at the top. (`add-merchants.ps1` does the same for the five demo merchants.)

**Which LiveChat merchant a test chat goes to.** In **LiveChat test**, the **Tenant id** (Settings) is the number of the LiveChat merchant the chat is sent to. LiveChat, not the bot panel, then decides which bot merchant answers: the one whose bot key is set in that LiveChat merchant. The merchant chosen in the panel's sidebar does not matter for this. The page remembers a Tenant id **for each merchant** (the demo merchants start with 1 to 6: `MERCH_A` is 1 ... `MERCH_F` is 6; another merchant is typed once, `add-merchant.ps1` prints its number), switches to it when you pick another merchant in the sidebar and starts a new chat, and shows **LiveChat merchant #N** under the chat. `chat.ps1` has the same option: `-Tenant 7`.

## Faster knowledge base work: bulk actions, Import and publish, quick Publish

**Bulk actions (Knowledge base).** Tick entries (or the box in the table head for every entry shown) and use the bar that appears: **Set live**, **Set draft**, **Delete**, **Clear**. One bulk action is one change to publish, not one per entry. The button **Set N ready drafts live** (next to the filters) sets every draft live that has an answer and at least 3 example questions; a draft that still says `TO WRITE` is left alone.

**Import and publish (Import).** Imports the entries as **live** and opens the Publish window, so a whole pack goes from file to live with two clicks (check the window, press Publish). **Import N entries to draft** is still there. (The "New entries start as" choice also lets a plain import make live entries.) An entry that still says `TO WRITE` is ignored by the bot until the answer is written, even when it is live.

**Why Publish was slow and what changed.** Saving 300 entries takes half a second. The time went on the sample messages (each merchant's test cases) that run on a draft: they ran for **every merchant** in the Publish window, and **again** inside the publish call. Now they run only for the merchants that changed (all merchants only when the shared word lists changed, or when nothing changed), and not a second time inside publish. A publish with about 300 entries went from about 6.6 seconds to about 0.5 seconds (the window's own check is about 1.5 seconds for a large merchant). The publish answer is now `{ published }` (the unused `pass` and `total` are gone). Tests: `test/publishScope.test.ts`.

## Table edit (Knowledge base)

**Knowledge base → Table edit** shows the entries as a table you edit in place, one row per entry: a **Live** box, the **answer** in English, Malay and Chinese (the **VI / TH / TL** buttons add Vietnamese, Thai and Filipino columns) and the **English example questions**, one per line. It uses the same filters and search as the list (for example *Needs work*, or one topic), so you can show only the entries that still say `TO WRITE` and write them one after the other.

- Type in a cell and **leave it** (Tab or a click elsewhere) to save it to the draft. **Ctrl+Enter** saves and goes down one row in the same column. **Esc** puts the old text back without saving. The panel keeps the choice (List or Table edit).
- A cell is red when the English answer is empty or still says `TO WRITE`, or when there are fewer than 3 example questions. Example questions: empty lines and repeats are dropped.
- Everything goes into the draft, as with the full editor; nothing is live until **Publish**. All the cells of one entry count as **one** change in the Publish count. The entry name opens the full editor (topic, question type, entry type, end date, guided questions).
- Code: `web/src/admin/screens/KbGrid.tsx`.

## How the bot picks between a shared word and a merchant's own word (fixes)

- **A merchant's own word wins.** The shared word lists give "free credit" to the topic *promotion*. If a merchant gives the same word to a topic of its own (the starter pack's `free_credit` topic), the merchant's meaning now wins **for that merchant** (other merchants keep the shared one). Before, the shared meaning was applied first and the merchant's own topic was never found, so "free credit" went to the "needs staff" promotion entry and was handed over.
- **A question that is the same words as one example is answered, not turned into a menu.** When several entries share a topic, the bot used to show a menu for every message with the topic word. Now, when the message is the same words as one example question (at least 85% alike, filler words counted) and clearly beats the next entry, the bot answers it (or hands over, when that entry is "needs staff"). A message with only the topic word ("free credit", "game") still asks which one.
- **Another merchant's name.** The safety rule "the customer names another merchant, so a person answers" compares letters and digits, and ignores names shorter than 4 characters (3 when they mix letters and digits). Before, the code `77Y8` became the letter `y` and every message containing a "y" was handed over.
- Tests: `test/ownTopicWords.test.ts`, `test/otherMerchantGuard.test.ts`.

## Ask again before a person takes over, and Add keyword

**Ask again (Merchant settings → Replies → "When the bot does not understand").** How many times the bot asks the customer to say more, when a message has no topic or question word it knows, before a person takes over: **0** (a person at once), **1** (the usual and the plan's rule, the default), **2** or **3**. Each time it shows the topics to choose from. A message that names a topic the merchant has no answer for still goes to a person at once, and the customer can always ask for an agent. Admin only, like the rude-message limit. Saved per merchant (`settings.reask_times`, migration `014_reask.sql`); a message the bot does understand starts the count again. Tests: `test/reask.test.ts`.

**Add keyword (Keywords page).** The Keywords page lists the words customers really typed (it fills by itself). **＋ Add keyword** adds a word before any customer types it: type the word, press Next, and the same "What is this word?" form opens (a short form of a topic, a new topic, a question word, a greeting, a filler or a rude word). Staff can add short forms for their own merchant. The Topics page keeps its own **＋ Add a topic or keyword** for building a topic with all its words in one go.

### Publish reminder

After any change to the draft (keyword, topic, entry, setting), a yellow bar "Not live yet" stays at the top of every screen until you publish. It has **What changed** (the list of draft changes) and **Review and publish**. The browser tab title also shows the count, e.g. `(3) Not published`. Customers keep getting the old answers until you publish.

### Import guide page

The panel has a **Answers → Import guide** page (next to Import): how to write the knowledge base CSV (columns, examples, writing rules), a download of an example and a blank file, and the import steps. A copy as a web page is in `docs/MARKETING_IMPORT_GUIDE.html`.

### Report page

The Report now shows an arrow on each number against the days before (green is better), a **Top topics and how well they are answered**, **Languages**, and **Why chats went to a person**. Chats from before this version have no written reason, so they show under "Other".

The Report period can be **Last 7 days**, **Last 30 days** or **Custom dates** (from and to, both days included, at most one year). **Download CSV** saves the summary, the numbers per day, topics, languages, hand-over reasons and missed messages for the chosen period.

The Topics flowchart has a **Find a topic, keyword or answer** box. Topics that do not match fade out, it says how many match, and the chart scrolls to the first match. (Keyword cards with more than 10 words keep their own small search.)

### Import: table, Excel and AI translation

- **Type in a table.** The Import page opens with an Excel-like table. Type in the cells, or copy cells from Excel or Google Sheets and paste them (the header line is skipped, a cell with line breaks is kept in one cell, and "English", "Malay" and so on are read as languages).
- **Excel files.** **Upload a file** accepts `.xlsx` (the first sheet), `.csv`, `.tsv` and `.txt`. **Download Excel example** and **Download blank Excel** give a ready file; the example is English only. **Download this merchant's KB as Excel** is under More. The Excel reader and writer are small and built in (`web/src/admin/xlsx.ts`, using `fflate`).
- **AI translation on import.** If the AI is set up, **Translate the empty languages with AI** is ticked. It fills only the languages you left empty (Malay and Chinese by default; Vietnamese, Thai and Filipino can be ticked) from the English answer and questions, three at a time, using the same checked translation as the Translate button in an entry. The result goes into the draft with a line in the change list; a failed one is counted and the entry stays as it was. Placeholders that still say TO WRITE are not translated. The cost is charged to the merchant like other AI use.

### Topics flowchart

The Flowchart is now the first tab and what opens by default (the List is the second tab). Cards always line up by themselves: there is no Auto-arrange button and no saved card places. Dragging an answer card onto another topic moves it there, and the chart lines up again on drop. The **Add a block** panel folds away by its title bar (the small arrow). The search box takes the whole toolbar. Everything that is only in the draft is amber with a dashed border and a **DRAFT** tag (a new keyword, topic or answer); published items are green with a **LIVE** tag. The "Show If not clear" switch is gone (the **If not clear** block in the panel still shows or hides it).

### Keywords page

The Keywords page only shows what customers typed (counts, groups under each topic, the Ignored list, search and language filter). It has no Add keyword button, no action buttons (Make a main keyword, Add under one, Ignore, Restore), no tick boxes and no AI describe button. A click on a word opens the chats that used it. Words are added and sorted on the Topics page. The layout: four summary tiles (words heard, under a topic, not under a topic, ignored), one toolbar, a card for each topic (closed except the first; open it to see short forms, slang, same meaning and other languages as chips with counts), and a side column with the most-typed words that have no topic and the words with another job. The four word groups keep one colour each: short forms blue, slang orange, same meaning green, other languages purple.

### Save and publish in the entry editor

A **new entry starts as a Draft** (the bot ignores it until you set its Status to **Live**), so adding an answer never puts it in front of customers by accident. The entry editor has **Save to draft** and, once the Status is Live, **Save and publish**. Save and publish does the same check and save, then opens the Publish window, so changing one answer is: type, Save and publish, Publish. If a field is missing (a name, an English answer, a topic), nothing is saved and the Publish window does not open.

### The Publish window shows only what the change broke

Before publishing, the panel runs the sample customer messages on the draft **and** on the version that is live now. The Publish window lists only the messages that **passed on the live version and fail on the draft** (what this change broke), up to 6, with a count for the rest. Messages that already fail on the live version are not listed; the window says how many there are and that this change did not cause them. When nothing new fails it shows a green "Nothing you changed broke a sample message." The line "Tests on the draft: x of y passed" stays below. The server marks each result with `wasOk` (did it pass on the live version) in `POST /api/admin/tests`.

### The "Human group for handoff" box is gone

The bot never used that number to route a chat (it only tells LiveChat to hand the chat to a person, and LiveChat chooses who gets it), so the box is removed from Merchant settings and from the Add merchant window, and the chat note now says only "Transferred to human agents". The stored numbers stay in the database and in the API (`handoff_group`), so nothing is lost and the box can come back if LiveChat ever routes by group.

### One Save on Merchant settings

The page has one **Save to draft** button (top right, and in the "unsaved changes" bar) that saves everything you changed: the **basics** (name, token limit, money sign, how long chats are kept, languages: these apply at once) and the settings (replies, handoff, AI help, messages: these go to the draft). **Save and publish** does the same and then opens the Publish window, so a change is two clicks: change, then Save and publish. The old **Save basics** button is gone; a change to the basics also counts in the unsaved-changes bar, and **Discard** puts it back.

### The translate button in the entry editor

On the English tab, **Translate the empty languages with AI** fills every language the merchant has switched on (Merchant settings → General → "Languages the bot answers in"), except English, but only the ones that are still empty and never over text that is there. A merchant that never chose its languages gets Malay and Chinese. On another language's tab, the button translates just that one language (and asks before it replaces an answer).

### A sentence that names two topics

When a message holds words of two topics (for example "referral" and "bonus" in "i want referral bonus"), the bot no longer offers only the entries of whichever topic comes first. If one entry's example questions are clearly the closest to the whole message (at least as close as the merchant's answer level and 0.8, and 0.12 ahead of the next), it answers that entry. Otherwise it shows choices with the **closest entries first**, so the entry the customer means is never cut off by the number of choices. A single topic word ("bonus", "referral") still asks which one.

### Learning from what customers choose

When the bot is not sure what a message means (for example just `tng`) it shows choices, and the customer picks one. If the rules had **no keyword** for that message, the bot notes the message and the answer chosen as a **suggestion** in the merchant's own database (table `choice_hints`, migration `016_choice_hints.sql`). A message with personal details (phone or bank numbers, emails, links) is never saved, and the same message chosen again only raises its count. When the bot first showed **topics** and the customer then tapped the exact answer, the answer counts (the topic tap alone does not).

On the **Learning** page the card **Learned from what customers chose** lists the suggestions, most chosen first. **Approve** adds the message to that entry as an example question (and a message of one word also as a keyword of the entry's topic, if no one has that word yet); it is a draft change that needs Publish. **Dismiss** hides it. The bot never uses a suggestion by itself. Server routes: `GET /api/admin/learning/choices`, `POST /api/admin/learning/choices/resolve`.

### AI draft answers in Learning

On the **Learning** page, a group of customer questions that staff have replied to has a **Draft answer with AI** button next to **Add to Knowledge base**. Claude writes one clean answer **from the staff replies of that group only**: it may not add a fact, and the server refuses a draft that contains a number, link or menu path that no staff reply has. If the replies disagree (for example two different times) or say nothing useful, no draft is made and the page says so. The draft opens in a window next to the replies it comes from, where a person edits it, and **Add to Knowledge base** puts it in as a **draft entry** (so it still needs Set live and Publish). The bot never uses a past reply by itself. The calls count in **Usage & billing** ("Drafting answers from staff replies"). Server route: `POST /api/admin/learning/draft-answer`.

### Suggest with AI (example questions)

In the entry editor, **Suggest with AI** (section 4) asks Claude for up to 6 new example questions for the open language tab. It sends the entry name, the topic, the answer (in that language, else the English one) and the examples the entry already has, and the merchant's bot instructions. The questions come back as a list under the examples: **Approve** adds one, **Dismiss** drops it, **Approve all** adds the rest. Nothing is added without a person pressing a button, questions the entry already has are never offered again, and the AI is told to write only questions this answer really answers and to add no facts. The calls count in **Usage & billing** ("Suggesting example questions"), under the merchant's own key if it has one, and stop when the merchant's monthly token limit is reached. Without a Claude key the button only adds a few simple variations of the first example, as before. Server route: `POST /api/admin/suggest-questions`.

### Chinese panel (中文)

The whole control panel can be shown in Simplified Chinese. Press **中文** (or **EN**) in the top bar; the choice is remembered in the browser for each person (`localStorage` key `panelLang`) and sets the page language (`zh-CN`). The default is English, so nothing changes for people who do not press it.

- The words are in `web/src/admin/zh.ts`. A text is written in English in the code, `t('Save to draft')`, and looked up there; a text with no Chinese yet stays English, so the panel never shows a hole. `{name}` in a text is filled from the second argument, and singular and plural are two separate texts. A text may end with `|context` (for example `Admin|role`) to tell apart the same English word used in two ways; the context is never shown.
- Written in Chinese: Knowledge base is **知识库**, Topics **主题**, Keywords **关键词**.
- The lines of "What changed" and of the Publish window are written in English when a change is made (and kept that way in History); `web/src/admin/changes.ts` turns them into Chinese when they are shown.
- Not translated on purpose: the merchant's own data (answers, entry names, keywords, sample chats), the bot's word lists, technical names (`chat_id`, `.env`), the reading-aid labels for screen readers, and error text that comes from the server.
- To add or fix a Chinese text: find the English text in `zh.ts` and change the Chinese after it. `npx vitest run web/src/admin` checks that the pages still show the Chinese texts.

### Folding the left menu

The small arrow button next to the logo folds the left menu to a rail of icons (the name of an item shows when the mouse is over it, and the yellow dot on Keywords still shows words that have no topic). Press the arrow again to open it. The choice is remembered in the browser. The merchant picker and the Advanced options switch are in the open menu. On a phone the menu is always open.

### Who the customer is, and no account data

The bot notes **who the customer is**: a logged-in **member** (LiveChat sent a member id) or a **visitor** (it sent none). Every `/api/v1/ai/ask` answer carries `customer: { type: "member" | "visitor", member_id, name, rank }`, and a handover also carries it in `metadata.customer`, so the person who takes the chat sees it. Once a chat has a member, the bot remembers it for that chat even if LiveChat does not repeat it. The member id is written to the chat log (the Report counts **chats from logged-in members and from visitors**).

The bot never reads account data. A question about a balance, a deposit or a withdrawal of this customer (for example "check my balance", "where is my deposit") goes to a person, for members and visitors alike. What was removed:

- The **Account tools** tab and the **Account answers in LiveChat** switch in Merchant settings, and the **Account data** step on the merchant page. The setup checklist has no account step.
- In the bot: the account lookup, and the "Where is my deposit" choice.

General answers (limits, how to deposit, times) are unchanged. The member id is taken as LiveChat sends it: it is not checked. The old sections of this README and of `docs/` that describe account answers and the merchant API describe a feature that is now off; the merchant API routes still exist in the server but nothing in the bot calls them.

The Report page no longer has the **Fix these first** list or **Check recent answers**. The wrong-answer tile therefore has nothing new to count (it shows only marks made earlier).

### Live / draft switch in the Knowledge base

In the list, the Status column has an on/off switch for each entry (on is live, off is draft). Switching asks first ("Set “x” to draft?" or "Set “x” live?", with Cancel). If the entry is not ready (for example it still says TO WRITE) the question lists what is missing. The change goes into the draft; customers see it after Publish.

### Learning: listen first, answer later

A merchant put in LiveChat can first only **listen**. In the panel: **Answers → Learning**. An admin switches the merchant to listening (and later to answering) there; a merchant that already exists stays on answering until someone switches it.

- **Listening:** `/api/v1/ai/ask` returns a silent reply (`decision: "silent"`, empty answer, no handover). LiveChat posts nothing and staff answer as usual. The top bar shows **Listening · bot silent**.
- **What is saved** (in the merchant database, table `learned_pairs`): each customer question and the staff reply that followed it, read from the `history` LiveChat sends with every message. While the bot is silent, every "bot" message in that history is a person (LiveChat calls an operator "bot"). Emails, links and long numbers are masked before saving.
- **The Learning screen:** days listening, chats, questions saved, how many have a staff reply, and a list grouped by meaning (the question, the topic, or the knowledge base answer that already covers it) with the reply staff gave most often. **Add to Knowledge base** makes a **draft** entry from a group (the questions as examples, the staff reply as the answer) for staff to check. A group the knowledge base already answers is marked and has no button.
- **Answering:** the admin presses **Start answering** (after a confirmation). The bot answers only from the live Knowledge base, as before. It never sends a past staff reply by itself: a reply is used only after staff added it to the Knowledge base, set it live and published.
- **What to know about LiveChat:** a staff reply is saved when LiveChat calls the bot again in that chat (the next customer message), because that is when the history is sent. If LiveChat stops calling the bot once a person has taken a chat, later replies in that chat are not seen. LiveChat keeps a reply by the words of the question for up to two hours, so the same question asked again in that time may not reach the bot, and a silent reply can stay for a little while after the switch to answering.

### New merchants listen first, and old chats can be imported

- A merchant **created from now on starts in listening mode** (the bot is silent and learns; see "Learning" above). Merchants that already exist, and the seeded demo merchants, keep answering. The merchant page's setup checklist has a **Bot is listening** step with a button to Learning until an admin switches the bot to answering.
- **Learn from old conversations:** on the Learning page, **Learn from old conversations** takes an Excel or CSV export of past chats, one row for each message, with the columns `chat_id`, `sender` (customer or staff; visitor, user and client count as customer, and operator, agent and bot as staff), `text` and, if available, `time`. The page first shows how many chats and messages it found and how many rows it leaves out. The file is read in the panel and sent in batches of up to 2000 messages. It works in either mode, and the same file twice saves nothing twice. A small Excel example can be downloaded there. What is learned is the same as in listening mode: the questions and the staff replies, with phone and bank numbers, emails and links hidden, and the same review (Add to Knowledge base as a draft) before the bot uses anything.

The **Merchant** picker is in the top bar, on the left (not in the menu), so it stays there when the left menu is folded.

### The checklist before the bot starts answering

On the Learning page, while a merchant listens, a card **Before the bot starts answering** has four lines. Three must be done: **Enough live answers** (at least 10 that are live and ready), **No "TO WRITE" left**, and **Everything is published** (the bot answers from what is published, so draft changes must be published first). The fourth, **Learned questions checked**, is only a hint. The **Start answering** button is off until the three are done. An admin can still press **Start anyway**; the question then lists what is not ready.
