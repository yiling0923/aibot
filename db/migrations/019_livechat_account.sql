-- Switch (per merchant): the bot may answer a logged-in member's own account questions (balance, points, deposits) in LiveChat.
-- Off until LiveChat stops keeping replies by the words of the question (see docs/REQUEST_TO_LIVECHAT_TEAM.md).
ALTER TABLE merchants ADD COLUMN livechat_account TINYINT(1) NOT NULL DEFAULT 0;
