-- Flows: a short conversation drawn for one topic (messages, questions with choices, questions for a detail, hand-over). The blocks are kept as JSON.
CREATE TABLE flows (
  id INT NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  topic VARCHAR(100) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'draft',
  blocks LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
