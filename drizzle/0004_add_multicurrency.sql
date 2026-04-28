-- Migration 0004: Add multi-currency support columns to transactions
-- originalAmount: the amount in the original currency entered by the user
-- originalCurrency: the currency code of the original amount (e.g. AZN, USD, EUR)
-- exchangeRate: the exchange rate used to convert originalAmount to the user's default currency
-- After migration: amount = converted amount in user's default currency
--                  originalAmount = amount as entered by user in originalCurrency
--                  exchangeRate = rate used (originalAmount * exchangeRate = amount)

ALTER TABLE `transactions` ADD COLUMN `originalAmount` decimal(12,2) DEFAULT NULL;
ALTER TABLE `transactions` ADD COLUMN `originalCurrency` varchar(10) DEFAULT NULL;
ALTER TABLE `transactions` ADD COLUMN `exchangeRate` decimal(16,8) DEFAULT NULL;
