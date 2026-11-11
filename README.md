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

### Customization & Configuration

Edit [`config.js`](./config.js) or provide environment variables in GitHub Secrets / `.env`:
* `CANDIDATE_PROFILE`: The persona Gemini uses to diagnose and pitch.
* `MAX_JOBS_PER_RUN`: Number of high-match jobs to process per run (default: `3`).
* `allowedTitleWords`, `negativeTitleWords`, `techKeywords`: Fine-tune your target roles.

### Features
* 🔍 **3 Open Job APIs:** Remotive, Jobicy, and Arbeitnow.
* 🤖 **AI Technical Bottleneck Diagnosis:** Powered by Google Gemini with 45-min proof-of-work project suggestions.
* 🔘 **Interactive Telegram UI:** Inline buttons for instant application, LinkedIn founder search, Google founder search, and Twitter/X search.
* 📋 **One-Tap Copyable Pitch:** Tap the cold message in Telegram to instantly copy it to your clipboard.
* ⚡ **Deduplication Engine:** `seen_jobs.json` commits back to GitHub automatically to prevent repeat alerts.

