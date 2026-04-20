CREATE TABLE `businessGroups` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(128) NOT NULL,
  `icon` varchar(64) NOT NULL DEFAULT '💼',
  `color` varchar(32) NOT NULL DEFAULT '#0ea5e9',
  `userId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `businessGroups_id` PRIMARY KEY(`id`)
);

ALTER TABLE `transactions` ADD `isWork` boolean NOT NULL DEFAULT false;
ALTER TABLE `transactions` ADD `businessGroupId` int;
