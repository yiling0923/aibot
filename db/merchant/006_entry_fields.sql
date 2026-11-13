-- Knowledge base entry fields from the plan: Type (answer / needs staff / promotion) and a different wording per channel.
-- The end date uses the existing valid_to column: the entry hides itself after that day.
ALTER TABLE kb_entries
  ADD COLUMN entry_type VARCHAR(20) NOT NULL DEFAULT 'answer',
  ADD COLUMN channel_overrides JSON NULL;
