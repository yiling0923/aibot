-- Handoff rules a merchant can change: complaint/dispute and account details written in the chat (both on by default), and its own trigger phrases.
ALTER TABLE settings
  ADD COLUMN handoff_complaint TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN handoff_account TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN trigger_phrases TEXT NULL;
