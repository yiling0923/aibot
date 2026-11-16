-- Per-merchant basics shown on the Merchant settings page.
-- domain: for information. monthly_token_limit: AI tokens per calendar month (NULL = unlimited); when it is used up the bot keeps answering from the
-- knowledge base and only the AI help stops. languages: the languages the bot answers in, for example 'en,zh' (NULL = all).
ALTER TABLE merchants
  ADD COLUMN domain VARCHAR(200) NULL,
  ADD COLUMN monthly_token_limit BIGINT NULL,
  ADD COLUMN languages VARCHAR(60) NULL;
