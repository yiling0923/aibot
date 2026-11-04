-- Run once as the MySQL admin user:   mysql -u root -p < db/setup.sql
-- Creates the two databases (real + test) and a user "bot" that can use only those.
CREATE DATABASE IF NOT EXISTS livechat_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS livechat_bot_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'bot'@'localhost' IDENTIFIED BY 'bot';
GRANT ALL PRIVILEGES ON livechat_bot.* TO 'bot'@'localhost';
GRANT ALL PRIVILEGES ON livechat_bot_test.* TO 'bot'@'localhost';
FLUSH PRIVILEGES;
