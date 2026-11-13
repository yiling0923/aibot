-- Knowledge base entry fields from the plan: Type (answer / needs staff / promotion).
-- The end date uses the existing valid_to column: the entry hides itself after that day.
ALTER TABLE kb_entries
  ADD COLUMN entry_type VARCHAR(20) NOT NULL DEFAULT 'answer';
