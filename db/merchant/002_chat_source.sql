-- Where a chat came from: the control panel's Test chat ('test') or a real customer ('live').
-- Reports can leave the test chats out. Everything saved before this was typed in the Test chat, except the sample data.
ALTER TABLE chat_sessions ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'live' AFTER status;
UPDATE chat_sessions SET source = 'test' WHERE livechat_chat_id NOT LIKE 'sample-%';
