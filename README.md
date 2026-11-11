# 🛰️ DevRadar

Automated developer job scanner that discovers roles matching your tech stack, analyzes company bottlenecks using Google Gemini AI, formulates a 45-minute proof-of-work project, and sends immediate alerts to Telegram.

## 🚀 Autonomous Execution via GitHub Actions

This project runs automatically every 6 hours via GitHub Actions (`.github/workflows/radar.yml`). It tracks processed jobs in `seen_jobs.json` to prevent duplicate alerts.

### Required GitHub Secrets

To make it run autonomously on GitHub, add these repository secrets in **Settings > Secrets and variables > Actions**:

| Secret Name | Description |
|---|---|
| `GEMINI_API_KEY` | Your Google Gemini API Key |
| `TELEGRAM_BOT_TOKEN` | Your Telegram Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram personal or group chat ID |

### Local Testing

```bash
npm install
npm test-bot   # Test Telegram connection
npm start      # Run job radar locally
```
