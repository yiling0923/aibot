-- Listening or answering (per merchant). A merchant put in LiveChat can first only LISTEN: the bot stays silent,
-- saves each customer question and the staff reply that followed it, and starts answering when an admin says so.
ALTER TABLE merchants ADD COLUMN bot_mode VARCHAR(12) NOT NULL DEFAULT 'answering', ADD COLUMN listening_since TIMESTAMP NULL;
