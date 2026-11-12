# Linking the AI bot to LiveChat

The bot stays its own service. LiveChat calls it over HTTP (`POST /api/v1/ai/ask`), exactly the way its "AI Chat API" setting already expects. This was tested end to end on one machine: widget → LiveChat → worker → bot → reply, numbered choices, picking by number, hand-off to a person, and the "Test AI Chat" button.

## 1. Run the bot next to LiveChat

On the bot's own: `docker compose up -d --build` (set `BOT_DB_ROOT_PASSWORD` and `BOT_SESSION_SECRET` first, for example in a `.env` file next to `docker-compose.yml`).

To share LiveChat's network, copy the two services from `docker-compose.yml` into LiveChat's compose file (or run both files together with `docker compose -f docker-compose.yml -f ../livechat/docker-compose.yml up -d`). LiveChat then reaches the bot at **`http://ai-bot:3000`**. Do not publish the bot's port to the internet when LiveChat is on the same network; keep `BOT_PORT` closed or bound to `127.0.0.1`.

If the bot runs on another server, give it an https address and use that instead.

## Local test on your own PC (Docker Desktop)

Nothing here touches staging or GitHub. The real staging LiveChat cannot reach your `localhost`, so this runs a local copy of LiveChat from the zip.

1. Start Docker Desktop. Start the bot: `npm run dev` (http://localhost:3000).
2. Unzip LiveChat, for example to `C:\livechat-develop`. Stop XAMPP's MySQL if it uses port 3306 (LiveChat's own MySQL uses it).
3. In the bot folder run:

```bash
powershell -ExecutionPolicy Bypass -File deploy\local-livechat\setup.ps1 -LiveChatDir C:\livechat-develop
```

The script starts LiveChat, adds one merchant and admin (`admin@a.test` / `Test1234!`), issues the bot key for `MERCH_A`, sets the base URL `http://host.docker.internal:3000` in LiveChat, and runs "Test AI Chat". The first build takes several minutes.

4. Try a visitor chat: `powershell -File deploy\local-livechat\chat.ps1 "how to deposit"`, then `chat.ps1 "blah"`, then `chat.ps1 "2"`.

Stop everything: `docker compose down` in the LiveChat folder (add `-v` to delete its data).

### If Docker Desktop will not run (for example Windows inside a virtual machine)

LiveChat does not need Docker or Redis, only Go and MySQL 8. This script downloads both into `C:\lc-local` (MySQL on its own port 3307, so XAMPP is untouched), builds and starts LiveChat, adds the merchant, issues the key and runs "Test AI Chat". The bot stays on `http://localhost:3000`:

```bash
powershell -ExecutionPolicy Bypass -File deploy\local-livechat\setup-nodocker.ps1 -LiveChatDir C:\livechat-develop
```

Stop it with the same command plus `-Stop`. Delete `C:\lc-local` to remove everything. The LiveChat screens (inbox, settings pages) are not built in this mode; everything is done through its API, and `chat.ps1` plays the visitor.

## Usage and billing

The admin menu has **Usage & billing**. Every AI call (Claude or ChatGPT) writes one row with its tokens and its cost at the price of that moment. The page shows, per merchant and period: real chats, AI calls, tokens read and written, AI cost, and **To charge** (cost plus a markup percent you set). It also has a CSV download for invoicing, and an editable price table (US dollars per million tokens). Check the starting prices against the provider's current list.

- Calls made with a merchant's **own** AI key are counted but not charged: that merchant pays the provider for them.
- A model with no price yet is counted, and its cost shows as $0.00 with a warning until you set the price.
- Only token counts are stored, never the customer's words.

## 2. Create the first admin and a merchant in the bot

```bash
docker compose exec ai-bot npm run user:add          # control panel login
docker compose exec ai-bot npm run db:seed           # optional sample merchants and answers
```

Open the panel at `http://<bot-host>:3000`.

## 3. Issue the bot key for a merchant

**In the panel (admin):** open **Merchants & logins**, click the merchant's name, and use the **LiveChat connection** card. It shows the address to paste into LiveChat, makes the key (shown once, with a Copy button), and has **Replace key** and **Stop key**. **Test the link** sends "Can you help?" the way LiveChat does. The same page holds the merchant's own Claude and ChatGPT keys (encrypted; only the last 4 characters are shown). Set `PUBLIC_URL` in `.env` when LiveChat must reach the bot at an address other than the one you open the panel with, and `SECRETS_KEY` to a long random value (do not change it later).

**From the command line:**

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
- At most **3 choices** are offered at once (the merchant may lower it; "Talk to an agent" is added on top and not counted). A line such as "If you need other help, you can contact an agent." is written after the list. Each merchant can switch it off or reword it per language in the panel under Settings.
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

Vietnamese / Thai / Filipino, hand-off number sync, topic flow view, per-merchant settings and keys page, usage and billing page.
