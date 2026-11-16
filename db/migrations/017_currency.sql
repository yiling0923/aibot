-- The money sign the bot writes in its messages for this merchant (RM, SGD, $, ฿, ₫, ₱ ...).
ALTER TABLE merchants ADD COLUMN currency VARCHAR(8) NOT NULL DEFAULT 'RM';
