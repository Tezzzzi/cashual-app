CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`icon` varchar(64) NOT NULL DEFAULT '📦',
	`color` varchar(32) NOT NULL DEFAULT '#6366f1',
	`type` enum('income','expense','both') NOT NULL DEFAULT 'both',
	`isPreset` boolean NOT NULL DEFAULT false,
	`userId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `familyGroupMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyGroupId` int NOT NULL,
	`userId` int NOT NULL,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `familyGroupMembers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `familyGroups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`inviteCode` varchar(16) NOT NULL,
	`ownerId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `familyGroups_id` PRIMARY KEY(`id`),
	CONSTRAINT `familyGroups_inviteCode_unique` UNIQUE(`inviteCode`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`categoryId` int NOT NULL,
	`type` enum('income','expense') NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`currency` varchar(10) NOT NULL DEFAULT 'AZN',
	`description` text,
	`date` bigint NOT NULL,
	`isFamily` boolean NOT NULL DEFAULT false,
	`familyGroupId` int,
	`sourceLanguage` varchar(10),
	`rawTranscription` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `telegramId` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `telegramUsername` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `telegramFirstName` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `telegramLastName` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `telegramPhotoUrl` text;--> statement-breakpoint
ALTER TABLE `users` ADD `preferredLanguage` varchar(10) DEFAULT 'ru';--> statement-breakpoint
ALTER TABLE `users` ADD `preferredCurrency` varchar(10) DEFAULT 'AZN';--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_telegramId_unique` UNIQUE(`telegramId`);