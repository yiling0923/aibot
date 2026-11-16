-- How long a merchant's conversations are kept, in days. NULL (or 0) = keep for ever. Older chats are deleted by a daily sweep.
ALTER TABLE merchants ADD COLUMN retention_days INT NULL;
