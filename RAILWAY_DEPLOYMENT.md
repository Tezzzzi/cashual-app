# Cashual - Railway Deployment Guide

This guide explains how to deploy the Cashual Telegram Mini App to Railway with MySQL database.

## Prerequisites

- Railway account (https://railway.app)
- Telegram Bot Token (from @BotFather)
- OpenAI API Key
- Railway API Token (optional, for CLI deployment)

## Step 1: Create Railway Project

1. Go to https://railway.app/dashboard
2. Click "New Project"
3. Select "Deploy from GitHub" or "Deploy from Docker"
4. If using Docker, select this repository

## Step 2: Add MySQL Database

1. In your Railway project, click "+ Add"
2. Select "MySQL"
3. Railway will automatically create a MySQL instance with a `DATABASE_URL` environment variable

## Step 3: Configure Environment Variables

In your Railway project settings, add these environment variables:

```
DATABASE_URL=mysql://user:password@host:port/database
JWT_SECRET=your-random-secret-key-min-32-chars
TELEGRAM_BOT_TOKEN=8760463122:AAGWjFjU3grGGoc7XixgFl4iyU8Aof4A9lA
OPENAI_API_KEY=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
NODE_ENV=production
PORT=3000
```

## Step 4: Deploy

### Option A: Using Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Link project
railway link

# Deploy
railway up
```

### Option B: Using GitHub Integration

1. Push code to GitHub
2. Connect your GitHub repository to Railway
3. Railway will automatically deploy on push

### Option C: Using Docker

Railway will automatically detect the `Dockerfile` and deploy using Docker.

## Step 5: Get Application URL

After deployment, Railway will provide a public URL like:
```
https://cashual-production.up.railway.app
```

## Step 6: Configure Telegram Bot

1. Open Telegram and message @BotFather
2. Send `/setmenubutton`
3. Select your bot
4. Choose "Web App"
5. Enter the URL from Step 5 (e.g., `https://cashual-production.up.railway.app`)
6. Enter button text: "Open Cashual"

Alternatively, use the Telegram Bot API directly:

```bash
curl -X POST "https://api.telegram.org/bot{BOT_TOKEN}/setWebAppInfo" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://cashual-production.up.railway.app"
  }'
```

## Step 7: Test the Application

1. Open Telegram and find your bot
2. Click the "Open Cashual" button
3. The Mini App should load
4. Test voice recording and transaction creation

## Step 8: Optional - Configure Webhook for Direct Bot Messages

If you want users to send voice messages directly to the bot (not just through the Mini App):

```bash
curl -X POST "https://api.telegram.org/bot{BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://cashual-production.up.railway.app/api/telegram/webhook",
    "allowed_updates": ["message"]
  }'
```

Then implement `/api/telegram/webhook` endpoint to handle incoming messages.

## Troubleshooting

### Database Connection Issues

- Check that `DATABASE_URL` is correctly set
- Ensure MySQL is running and accessible
- Check Railway logs: `railway logs`

### Application Won't Start

- Check logs: `railway logs`
- Verify all required environment variables are set
- Ensure `pnpm build` completes successfully

### Telegram Bot Not Working

- Verify bot token is correct
- Check that the app URL is publicly accessible
- Test with: `curl https://your-app-url/health`

### Voice Transcription Fails

- Verify OpenAI API key is valid
- Check OpenAI account has sufficient credits
- Review error logs in Railway dashboard

## Monitoring

Monitor your application in Railway dashboard:

- View logs: Dashboard → Logs
- Check metrics: Dashboard → Metrics
- View environment variables: Settings → Variables

## Database Migrations

To run migrations after deployment:

```bash
railway run pnpm db:push
```

Or through Railway CLI:

```bash
railway run -- pnpm db:push
```

## Rollback

To rollback to a previous deployment:

1. Go to Railway Dashboard
2. Select your service
3. Go to Deployments
4. Click "Redeploy" on a previous deployment

## Support

For Railway support: https://docs.railway.app
For Telegram Bot API: https://core.telegram.org/bots/api
For OpenAI API: https://platform.openai.com/docs
