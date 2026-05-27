-- Migration 0005: Add Telegram reminder preferences and timezone support
-- remindersEnabled defaults to enabled for all existing and new users.
-- timezone stores an IANA timezone name when the frontend can detect it; scheduler falls back to Asia/Baku.
ALTER TABLE `users` ADD COLUMN `remindersEnabled` boolean NOT NULL DEFAULT true;
ALTER TABLE `users` ADD COLUMN `timezone` varchar(64) DEFAULT NULL;
