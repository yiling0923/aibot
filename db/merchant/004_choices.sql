-- How many choices the bot offers at once (at most 3, "Talk to an agent" not counted) and an extra line after the choices.
-- more_help_msg holds a custom line per language; empty means the standard sentence.
ALTER TABLE settings
  ADD COLUMN max_choices INT NOT NULL DEFAULT 3,
  ADD COLUMN more_help_on TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN more_help_msg JSON NULL;
