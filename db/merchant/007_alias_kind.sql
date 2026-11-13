-- What kind of word a merchant keyword is under its main keyword: short (dep, dp), slang or meaning (same meaning). Empty = the panel guesses.
ALTER TABLE aliases ADD COLUMN kind VARCHAR(10) NULL;
