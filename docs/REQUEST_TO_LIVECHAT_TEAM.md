# Request to the LiveChat team: show the bot's choices as buttons

## What we need
When the AI bot is not sure what the visitor means, it offers a few choices (at most 3, plus "Talk to an agent"). LiveChat's widget has no buttons, so today the choices are written into the reply as a numbered list and the visitor has to type the number or a few words. Visitors find this awkward (see the screenshot of "1. How to deposit / 2. Deposit time …").

Please show the choices as **clickable buttons** under the bot's message.

## What the bot already sends
Every reply from `POST {base}/api/v1/ai/ask` already carries the choices in a separate list. LiveChat currently ignores it. Example:

```json
{
  "answer": "Sure! What would you like to know about deposits?\n\n1. How to deposit\n2. Deposit time\n3. Deposit limits\n4. Talk to an agent\n\nIf you need other help, you can contact an agent.",
  "confidence": 0.62,
  "should_escalate": false,
  "should_close": false,
  "close_message": null,
  "session_id": "bot_1ad8b7bf-0195-4e4c-8c9b-63e4d919a474",
  "decision": "clarify",
  "choices": [
    { "label": "How to deposit",  "value": "intent:deposit_how" },
    { "label": "Deposit time",    "value": "intent:deposit_time" },
    { "label": "Deposit limits",  "value": "intent:deposit_limit" },
    { "label": "Talk to an agent", "value": "agent:agent" }
  ]
}
```

`decision` is `answer`, `clarify`, `handover`, `close` or `silent`. `choices` is empty when there is nothing to choose.

## What LiveChat would do
1. Save `choices` on the bot message (for example as message metadata).
2. In the widget, draw one button per choice under that message.
3. When the visitor clicks a button, send **the button's `label` as the visitor's normal message**. The bot understands the label, so nothing else is needed. (`value` is for staff tools and for other channels; it does not have to be sent.)
4. Disable or hide the buttons once the visitor has answered, or when a newer bot message arrives.
5. Show the `answer` text as it is. It already contains the numbered list and the closing line. If the widget shows buttons, it may cut the numbered lines (the lines that start with "1. ", "2. " …) from the text. The simple way is to keep the full text and show the buttons too.

## IMPORTANT first: LiveChat's answer cache can show one customer's reply to another

In `internal/automation/answer_cache.go` and `ai_reply.go`, LiveChat keeps every bot reply by **the words of the question only** (per merchant, nothing else), and it looks there **before** it calls the bot:

- The first layer (`L1`, 2 hours) keeps **every** reply that has text. The second layer (`L2`, 7 days) keeps replies with `confidence >= 0.85`.
- So if customer A asks "my money not in" and the bot answers with a question and choices, customer B's identical words get A's cached reply and the bot is never asked.
- A customer who answers the choices with "2" would get the answer that the *previous* customer's "2" produced.
- A customer who repeats "blah" would get the same "please explain" for 2 hours and never reach a person, because the bot never sees the second message.
- A reply that contains one customer's own details (balance, name) would reach the next customer who types the same words.

What the bot does about it already (nothing for you to do for these):
1. It **never writes personal account data** in a LiveChat reply (it hands those chats to staff).
2. Every reply has `"cacheable": true|false`. Only a plain answer that depends on nothing but the question words is `true`. Menus, replies to menus, anything read together with an earlier message, and hand-overs are `false`, and their `confidence` is kept at **0.8 or less** so they never reach the 7-day layer.

What is still needed (the first layer ignores confidence):

**Option A: a one-line fix (recommended).** At the top of `LayeredAnswerCache.Put`, before anything is stored:

```go
if cacheable, ok := response["cacheable"].(bool); ok && !cacheable {
    return nil
}
```

**Option B: no code change, until Option A is done.** Set these two values for the worker (they turn the cache almost off):

```
LIVECHAT_AI_CACHE_L1_TTL_SECONDS=1
LIVECHAT_AI_CACHE_MIN_CONFIDENCE=1.0
```

Until one of these is in place, do not turn the AI bot on for real customers: clarifying questions and number replies will not work reliably.

## Nothing breaks if LiveChat does not do this
The numbered list stays in `answer`, and the bot understands "2", "the second one" and words from the choice. Older widgets keep working. The bot needs **no change** for this feature.

## Other items we also need from LiveChat (separate from the buttons)
1. **Member details on every ask call:** send `member: { id, name, rank }` (LiveChat already holds `externalId`, name and rank), so the bot can answer account questions for a signed-in member.
2. **Handoff number:** a way for the bot to read and set "ask after every N bot replies" (`ai_handoff_prompt_after_replies`), so the bot panel and LiveChat show the same number. Tell us which API call and which login or token to use.
3. **The bot's address on staging:** where it should be reachable (for example `http://ai-bot:3000` inside your network, or an https address), and who sets the base URL and the key in each merchant's AI Bot page.
