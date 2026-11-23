-- What customers meant: a message the rules could not place on their own (for example "tng"), and the answer the customer then chose from the bot's choices.
-- It is only a suggestion for staff to approve or dismiss on the Learning page; the bot never uses it by itself.
CREATE TABLE choice_hints (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  text_hash CHAR(40) NOT NULL,
  customer_text VARCHAR(200) NOT NULL,
  intent_key VARCHAR(120) NOT NULL,
  hits INT NOT NULL DEFAULT 1,
  status VARCHAR(12) NOT NULL DEFAULT 'open',      -- open | added | dismissed
  first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY choice_hints_unique (text_hash, intent_key),
  KEY choice_hints_status (status, hits)
);
