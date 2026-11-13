-- What each decision was about, so the report can show top topics, top keywords and the topics handed to a person most.
ALTER TABLE bot_decisions
  ADD COLUMN topic VARCHAR(100) NULL,
  ADD COLUMN keywords VARCHAR(500) NULL;
