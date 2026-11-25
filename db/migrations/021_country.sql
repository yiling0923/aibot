-- The country of a merchant (two letters, for example MY). Its timezone and its suggested languages follow from it in the panel.
-- auto_translate: when staff type an answer in one language, the empty languages of the merchant are filled by the AI.
ALTER TABLE merchants ADD COLUMN country CHAR(2) NULL, ADD COLUMN auto_translate TINYINT(1) NOT NULL DEFAULT 1;
