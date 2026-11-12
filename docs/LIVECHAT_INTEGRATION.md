# Linking the AI bot to LiveChat

The bot stays its own service. LiveChat calls it over HTTP (`POST /api/v1/ai/ask`), exactly the way its "AI Chat API" setting already expects. This was tested end to end on one machine: widget → LiveChat → worker → bot → reply, numbered choices, picking by number, hand-off to a person, and the "Test AI Chat" button.

## 1. Run the bot next to LiveChat

On the bot's own: `docker compose up -d --build` (set `BOT_DB_ROOT_PASSWORD` and `BOT_SESSION_SECRET` first, for example in a `.env` file next to `docker-compose.yml`).

To share LiveChat's network, copy the two services from `docker-compose.yml` into LiveChat's compose file (or run both files together with `docker compose -f docker-compose.yml -f ../livechat/docker-compose.yml up -d`). LiveChat then reaches the bot at **`http://ai-bot:3000`**. Do not publish the bot's port to the internet when LiveChat is on the same network; keep `BOT_PORT` closed or bound to `127.0.0.1`.

If the bot runs on another server, give it an https address and use that instead.

## 2. Create the first admin and a merchant in the bot

```bash
docker compose exec ai-bot npm run user:add          # control panel login
docker compose exec ai-bot npm run db:seed           # optional sample merchants and answers
```

Open the panel at `http://<bot-host>:3000`.

## 3. Issue the bot key for a merchant

```bash
docker compose exec ai-bot npm run key:create -- MERCH_CODE
```

The key (`aib_...`) is shown **once**. Running the command again replaces it, so the old key stops working.

## 4. Set it in LiveChat (Merchant Admin → Automation)

| LiveChat field | Value |
|---|---|
| AI bot enabled | on |
| AI Chat API base URL | `http://ai-bot:3000` (or the bot's https address) |
| AI Chat API key | the `aib_...` key from step 3 |
| Prompt for a person after N replies | LiveChat decides this today (see "Still to do") |

Press **Test AI Chat**. A reply with numbered choices means the link works.

## What the bot does with each LiveChat call

- Sends back `answer`, `confidence`, `should_escalate`, `should_close`, `close_message`, `session_id`.
- LiveChat has no buttons, so choices are written into the answer as a numbered list. The next message may be `2`, "the second one", or words from the choice.
- Chat memory lives in the merchant's own database, so a restart loses nothing.
- The same request sent twice within 10 minutes gets the same answer and the chat moves only once.
- If the bot needs more than `ASK_TIMEOUT_MS` (default 8 seconds) or fails, it answers with the hand-off text and `should_escalate: true`; the customer is never left in silence.
- After a hand-off or close the bot stays silent.
- Optional `member` object (`id`, `name`, `rank`) lets the bot answer account questions for a signed-in member.

## Needs the LiveChat team

1. Send the member id, name and rank on every `ask` call (LiveChat's widget already holds `externalId`, name and rank).
2. Send `session_id` back on each call (LiveChat already does).
3. A way for the bot to read/write the merchant's "prompt for a person after N replies" so the two stay the same. Today the number is set only inside LiveChat.

## Still to do on the bot side

Maximum 3 choices plus an "if you need more help you can contact an agent" sentence, Vietnamese / Thai / Filipino, hand-off number sync, topic flow view, per-merchant settings and keys page, usage and billing page.
