-- A suggested type for a keyword that has not been set yet (filler, slang, topic, question, rude, greeting, negation).
ALTER TABLE keyword_store ADD COLUMN guess VARCHAR(20) NULL;
