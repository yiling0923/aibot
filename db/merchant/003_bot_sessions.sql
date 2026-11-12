-- Chat memory for the LiveChat connector, kept in the database so a restart loses nothing.
-- One row per LiveChat conversation (session_id is the id the bot gives back and LiveChat sends with every later question).
CREATE TABLE bot_sessions (
  session_id VARCHAR(64) PRIMARY KEY,
  state LONGTEXT NOT NULL,                          -- JSON: how many times the bot asked again, rude messages, last topic, choices on offer, handed over, closed
  language VARCHAR(10) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY bot_sessions_updated (updated_at));

-- One row per question the connector answered. It is used to answer a repeated request the same way
-- (LiveChat retries when it hears nothing, and sends no message id), and to see how fast the bot is.
CREATE TABLE bot_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_key CHAR(64) NOT NULL,                    -- SHA-256 of session + question + history length
  session_id VARCHAR(64) NOT NULL,
  decision VARCHAR(20) NOT NULL,
  latency_ms INT NOT NULL DEFAULT 0,
  response LONGTEXT NOT NULL,                       -- what was sent back, so a repeat gets the same answer
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY bot_requests_key (request_key),
  KEY bot_requests_session (session_id),
  KEY bot_requests_created (created_at));
