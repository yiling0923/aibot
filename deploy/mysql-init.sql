-- Runs once, when the bot's own MySQL container is created for the first time.
CREATE DATABASE IF NOT EXISTS livechat_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'bot'@'%' IDENTIFIED BY 'bot-change-me';
GRANT ALL PRIVILEGES ON livechat_bot.* TO 'bot'@'%';
-- every merchant gets its own database livechat_bot_m_<code>
GRANT ALL PRIVILEGES ON `livechat\_bot\_%`.* TO 'bot'@'%';
FLUSH PRIVILEGES;
