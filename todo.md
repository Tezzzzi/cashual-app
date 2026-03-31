# Voice Finance Tracker - Telegram Mini App TODO

## Database & Schema
- [x] Users table (extend with Telegram auth fields)
- [x] Categories table (15 preset + custom)
- [x] Transactions table (type, amount, category, date, description, personal/family)
- [x] Family groups table
- [x] Family group members table
- [x] Push migrations

## Backend API
- [x] Telegram initData auth (validate Telegram WebApp data)
- [x] Categories CRUD (list, create custom, delete custom)
- [x] Transactions CRUD (create, list, update, delete)
- [x] Voice transcription via Whisper API
- [x] LLM parsing of transcribed text into transaction data
- [x] Family group management (create, join by invite code, leave)
- [x] Reports API (totals, by category, by time period)
- [x] CSV export endpoint
- [x] Seed 15 preset categories

## Frontend - Core UI
- [x] Dark theme setup adapted for Telegram Mini App
- [x] Mobile-first responsive layout
- [x] Bottom navigation (Home, Transactions, Reports, Family, Settings)
- [x] Telegram WebApp SDK integration

## Frontend - Features
- [x] Dashboard/Home page with balance summary
- [x] Voice recording button (in-app microphone)
- [x] Transaction list with edit/delete
- [x] Add/edit transaction form (manual fallback)
- [x] Category management page
- [x] Reports page with charts (pie chart by category, bar chart income vs expenses)
- [x] Family mode: create group, invite code, switch personal/family
- [x] Family reports view
- [x] CSV export button
- [x] Multi-language support hints (RU/AZ/EN voice input)

## Deployment & Instructions
- [x] Deploy web application
- [x] Prepare Telegram bot connection instructions

## Railway Deployment - Cashual Rebrand
- [ ] Rebrand app to Cashual (CA$HUAL) with logo
- [ ] Adapt project for standalone Railway deployment (remove Manus OAuth dependency)
- [ ] Add Telegram Bot integration with webhook handler
- [ ] Create Railway project with MySQL database
- [ ] Deploy backend + frontend to Railway
- [ ] Configure all environment variables on Railway
- [ ] Set up Telegram bot webhook
- [ ] Verify deployment works end-to-end

## Actual Railway Deployment (Automated)
- [ ] Install Railway CLI and authenticate
- [ ] Create Railway project via API
- [ ] Create MySQL service in project
- [ ] Deploy application to Railway
- [ ] Configure all environment variables
- [ ] Run database migrations
- [ ] Set up Telegram webhook
- [ ] Verify deployment is working
- [ ] Provide final URL to user

## Bug Fixes
- [x] Fix infinite loading spinner in Telegram Mini App (auth flow stuck on "Загрузка...")
- [x] Fix "Failed to create or retrieve user" error in Telegram auth flow
- [ ] Fix persistent "Authentication failed" error - Telegram initData validation failing on Railway

## New Feature Requests
- [ ] Limit users to one family budget (cannot create if already in a group)
- [x] Default all transactions to family budget when user has a family group
- [x] Limit users to one family budget (cannot create if already in a group)

## Bug Fixes (Round 2)
- [x] Fix reports tab showing empty data
- [x] Fix main balance showing 0 despite having transactions
- [x] Fix language switching not working (interface stays in Russian)

## New Features (Round 2)
- [x] New professional logo (clean, modern, finance-oriented, not casino-like)
- [x] Default budget preference setting (personal vs family toggle that persists)
- [x] Receipt/screenshot recognition via vision AI (camera capture, OCR parsing, auto-fill transaction)

## Bug Fixes (Round 3)
- [x] Fix reports time filter broken (7d/30d/etc show zero data, only "All" works)
- [x] Fix category names not translating when language is switched
- [x] Fix receipt scanner only saves first transaction (need multi-transaction + duplicate detection)
