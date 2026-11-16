-- Style rules the merchant writes for the AI (formal tone, "Dear Member", short translations...). Added to the AI's rules, never used to write new facts.
ALTER TABLE settings ADD COLUMN ai_instructions TEXT NULL;
