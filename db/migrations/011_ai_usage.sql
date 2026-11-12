-- What the AI costs, per merchant. Every AI call writes one row with its tokens (the bot never stores what the customer wrote here).
-- cost_usd is worked out when the call is made, from the price table of that moment, so changing a price later does not rewrite history.
-- It stays NULL when the model had no price yet; the report then prices those rows with the current price.
CREATE TABLE ai_prices (
  provider VARCHAR(20) NOT NULL,                    -- anthropic | openai
  model VARCHAR(100) NOT NULL,
  input_per_mtok DECIMAL(12,4) NOT NULL DEFAULT 0,  -- USD per 1,000,000 input tokens
  output_per_mtok DECIMAL(12,4) NOT NULL DEFAULT 0, -- USD per 1,000,000 output tokens
  updated_by VARCHAR(100) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, model));

-- Starting prices (USD per million tokens, from Anthropic's published list when this was written). Check them against the current list and edit them on the Usage & billing page.
INSERT INTO ai_prices(provider, model, input_per_mtok, output_per_mtok, updated_by) VALUES
  ('anthropic', 'claude-haiku-5-5', 0.10, 0.50, 'system'),
  ('anthropic', 'claude-sonnet-5-5', 2.00, 10.00, 'system'),
  ('anthropic', 'claude-opus-5-5', 4.00, 20.00, 'system');

-- The extra percent added on top of the AI cost when it is charged to a merchant.
CREATE TABLE billing_settings (
  id TINYINT PRIMARY KEY DEFAULT 1,
  markup_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
  CONSTRAINT billing_one_row CHECK (id = 1));
INSERT INTO billing_settings(id, markup_pct) VALUES (1, 0);

CREATE TABLE ai_usage (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  merchant_id BIGINT NULL,                          -- kept (as NULL) if the merchant is deleted, so the totals stay true
  provider VARCHAR(20) NOT NULL,
  model VARCHAR(100) NOT NULL,
  kind VARCHAR(20) NOT NULL,                        -- pick | describe | translate | write
  key_source VARCHAR(10) NOT NULL DEFAULT 'shared', -- shared (the .env key, you pay) | own (the merchant's key, the merchant pays the provider)
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cost_usd DECIMAL(14,6) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ai_usage_merchant_time (merchant_id, created_at),
  KEY ai_usage_time (created_at),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE SET NULL);
