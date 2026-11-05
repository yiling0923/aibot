-- Run once as the MySQL admin user:   mysql -u root -p < db/setup.sql
-- Creates the two main databases (real + test) and a user "bot" that can use those and the merchant databases (livechat_bot_m_*).
-- Run it again after an update: it is safe to repeat.
CREATE DATABASE IF NOT EXISTS livechat_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS livechat_bot_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'bot'@'localhost' IDENTIFIED BY 'bot';
GRANT ALL PRIVILEGES ON livechat_bot.* TO 'bot'@'localhost';
GRANT ALL PRIVILEGES ON livechat_bot_test.* TO 'bot'@'localhost';
-- Every merchant gets its own database named livechat_bot_m_<code> (and livechat_bot_test_m_<code> in the tests).
-- This lets the bot create and use those, and nothing else.
GRANT ALL PRIVILEGES ON `livechat\_bot\_%`.* TO 'bot'@'localhost';
FLUSH PRIVILEGES;
