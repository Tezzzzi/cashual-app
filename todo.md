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
- [ ] Deploy web application
- [ ] Prepare Telegram bot connection instructions
