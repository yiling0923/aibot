-- How many times the bot asks again when it does not understand a message, before a person takes over (0 to 3; the plan's rule is 1).
ALTER TABLE settings ADD COLUMN reask_times INT NOT NULL DEFAULT 1;
