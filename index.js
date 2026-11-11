import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!GEMINI_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.warn("⚠️ Warning: Missing one or more environment variables (GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const SEEN_JOBS_FILE = path.resolve("./seen_jobs.json");

// Helper: load seen jobs
function loadSeenJobs() {
  try {
    if (fs.existsSync(SEEN_JOBS_FILE)) {
      const data = fs.readFileSync(SEEN_JOBS_FILE, "utf-8");
      return new Set(JSON.parse(data));
    }
  } catch (err) {
    console.error("⚠️ Could not read seen_jobs.json, initializing empty set:", err.message);
  }
  return new Set();
}

// Helper: save seen jobs (keeps latest 500 to stay lightweight)
function saveSeenJobs(seenSet) {
  try {
    const list = Array.from(seenSet).slice(-500);
    fs.writeFileSync(SEEN_JOBS_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.error("⚠️ Failed to write to seen_jobs.json:", err.message);
  }
}

// Helper: Generate one-click founder and lead discovery links
function buildFounderSearchLinks(companyName) {
  const cleanCompany = encodeURIComponent((companyName || "").trim());
  const linkedinUrl = `https://www.linkedin.com/search/results/people/?keywords=${cleanCompany}%20founder%20OR%20CTO`;
  const twitterUrl = `https://twitter.com/search?q=${cleanCompany}%20founder%20OR%20CTO`;
  const googleFounderUrl = `https://www.google.com/search?q=site%3Alinkedin.com%2Fin%20%22${cleanCompany}%22%20(founder%20OR%20CTO%20OR%20%22engineering%20lead%22)`;
  return { linkedinUrl, twitterUrl, googleFounderUrl };
}

// 1. Fetch live jobs from multiple open APIs
async function fetchJobs() {
  console.log("🔍 Fetching fresh developer jobs...");
  const jobs = [];

  // Source A: Remotive
  try {
    const res = await fetch("https://remotive.com/api/remote-jobs?category=software-dev&limit=30");
    if (res.ok) {
      const data = await res.json();
      if (data.jobs) jobs.push(...data.jobs);
      console.log(`📡 Remotive returned ${data.jobs?.length || 0} jobs.`);
    }
  } catch (err) {
    console.error("⚠️ Failed to reach Remotive:", err.message);
  }

  // Source B: Jobicy
  try {
    const res = await fetch("https://jobicy.com/api/v2/remote-jobs?count=20&tag=dev");
    if (res.ok) {
      const data = await res.json();
      const jobicyJobs = (data.jobs || []).map((j) => ({
        id: j.id ? String(j.id) : undefined,
        company_name: j.companyName,
        title: j.jobTitle,
        description: j.jobDescription,
        url: j.url,
      }));
      jobs.push(...jobicyJobs);
      console.log(`📡 Jobicy returned ${jobicyJobs.length} jobs.`);
    }
  } catch (err) {
    console.error("⚠️ Failed to reach Jobicy:", err.message);
  }

  // Source C: Arbeitnow (Remote Tech Jobs)
  try {
    const res = await fetch("https://www.arbeitnow.com/api/job-board-api");
    if (res.ok) {
      const data = await res.json();
      const arbeitnowJobs = (data.data || [])
        .filter((j) => j.remote)
        .map((j) => ({
          id: j.slug || j.url,
          company_name: j.company_name,
          title: j.title,
          description: j.description,
          url: j.url,
        }));
      jobs.push(...arbeitnowJobs);
      console.log(`📡 Arbeitnow returned ${arbeitnowJobs.length} remote jobs.`);
    }
  } catch (err) {
    console.error("⚠️ Failed to reach Arbeitnow:", err.message);
  }

  return jobs;
}

// 2. Filter for relevant stacks and unseen jobs (using config.js)
function filterRelevantJobs(jobs, seenJobs) {
  return jobs.filter((job) => {
    const jobKey = job.url || job.id || `${job.company_name}-${job.title}`;
    if (seenJobs.has(jobKey)) {
      return false; // Skip already alerted jobs
    }

    const title = (job.title || "").toLowerCase();
    const body = `${job.title} ${job.description || ""}`.toLowerCase();

    // Must look like an engineering title
    const isDevRole = config.allowedTitleWords.some((word) => title.includes(word));
    // Must NOT be excluded
    const isNotExcluded = !config.negativeTitleWords.some((word) => title.includes(word));
    // Must mention core stack
    const hasStack = config.techKeywords.some((kw) => body.includes(kw));

    return isDevRole && isNotExcluded && hasStack;
  }).slice(0, config.maxJobsPerRun);
}

// 3. Technical Gap Diagnosis via Gemini (with 503 & 429 retry protection)
async function analyzeJob(job, retries = 2) {
  const cleanDescription = (job.description || "")
    .replace(/<[^>]*>?/gm, " ")
    .replace(/\s+/g, " ")
    .slice(0, 2500);

  const prompt = `
You are a Principal Software Engineer crafting an actionable proof-of-work pitch for a developer.
Target Company: ${job.company_name}
Role Title: ${job.title}
Job Excerpt:
${cleanDescription}

Candidate Profile:
- ${config.candidateProfile}

Format your response strictly using Telegram-compatible HTML tags (<b>, <i>, <code>). Do NOT use Markdown characters like **, __, #, or backticks.

Output structure:
🏢 <b>Company & Role:</b> ${job.company_name} — ${job.title}

⚡ <b>Core Bottleneck:</b>
[1-2 sentences identifying the real engineering or UX pain point based on the excerpt]

🛠️ <b>Proof-of-Work Demo (45 Mins):</b>
[1 concise description of a standalone component or prototype built with Next.js/Tailwind that proves capability]

💬 <b>Cold Outreach Message:</b>
<code>[A punchy 3-sentence message to the founder/lead engineer asking permission to share the demo. No links.]</code>
`;

  try {
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
    });
    return response.text;
  } catch (err) {
    const isRateOrBusy = err.status === 503 || err.status === 429 || (err.message && err.message.includes("429"));
    if (retries > 0 && isRateOrBusy) {
      console.log(`⏳ Server busy or rate limited (${err.status || "busy"}). Retrying in 4s... (${retries} attempts left)`);
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return analyzeJob(job, retries - 1);
    }
    throw err;
  }
}

// 4. Send Telegram alert with interactive inline buttons and fallback
async function sendTelegramAlert(analysisText, job) {
  const jobUrl = job.url;
  const { linkedinUrl, twitterUrl, googleFounderUrl } = buildFounderSearchLinks(job.company_name);

  // Validate URL helper
  const isValidUrl = (u) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  // Build interactive inline keyboard
  const inlineKeyboard = [];
  const row1 = [];
  if (isValidUrl(jobUrl)) {
    row1.push({ text: "🚀 Apply / View Role", url: jobUrl });
  }
  if (isValidUrl(linkedinUrl)) {
    row1.push({ text: "💼 LinkedIn Search", url: linkedinUrl });
  }
  if (row1.length > 0) inlineKeyboard.push(row1);

  const row2 = [];
  if (isValidUrl(googleFounderUrl)) {
    row2.push({ text: "🔎 Google Founder Search", url: googleFounderUrl });
  }
  if (isValidUrl(twitterUrl)) {
    row2.push({ text: "🐦 Search on X", url: twitterUrl });
  }
  if (row2.length > 0) inlineKeyboard.push(row2);

  const replyMarkup = inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;

  let htmlPayload = `🚀 <b>DEVRADAR OPPORTUNITY</b>\n\n${analysisText.trim()}\n\n🔗 <a href="${jobUrl}"><b>Apply / View Role</b></a> | <a href="${googleFounderUrl}"><b>Google Founder Search</b></a>`;

  if (htmlPayload.length > 4000) {
    htmlPayload = htmlPayload.slice(0, 3900) + `\n\n...[truncated]\n\n🔗 <a href="${jobUrl}"><b>Apply / View Role</b></a>`;
  }

  // 1. Try formatted HTML with interactive buttons
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: htmlPayload,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      }),
    });

    const data = await res.json();
    if (data.ok) return true;

    console.warn("⚠️ Telegram HTML parse failed, falling back to clean plain text:", data.description);
  } catch (networkErr) {
    console.warn("⚠️ HTML send attempt failed:", networkErr.message);
  }

  // 2. Fallback to clean plain text if HTML had parsing issues
  try {
    const cleanText = analysisText.replace(/<[^>]*>?/gm, "").trim();
    let plainPayload = `🚀 [DEVRADAR OPPORTUNITY]\n\n${cleanText}\n\n🔗 Application Link:\n${jobUrl}\n🔎 Google Founder Search:\n${googleFounderUrl}`;
    if (plainPayload.length > 4000) {
      plainPayload = plainPayload.slice(0, 3950) + `\n\n...[truncated]\n\n🔗 Application Link:\n${jobUrl}`;
    }

    const fallbackRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: plainPayload,
        reply_markup: replyMarkup,
      }),
    });

    const fallbackData = await fallbackRes.json();
    return fallbackData.ok;
  } catch (err) {
    console.error("❌ Telegram fallback also failed:", err.message);
    return false;
  }
}

// 5. Execution Orchestrator
async function run() {
  try {
    const seenJobs = loadSeenJobs();
    console.log(`📚 Loaded ${seenJobs.size} previously seen jobs from memory.`);

    const allJobs = await fetchJobs();
    if (allJobs.length === 0) {
      console.log("⚠️ No jobs fetched from APIs. Check your connection.");
      return;
    }

    const targets = filterRelevantJobs(allJobs, seenJobs);
    console.log(`🎯 Identified ${targets.length} NEW high-match roles. Processing...`);

    if (targets.length === 0) {
      console.log("ℹ️ No new unseen matching jobs at this moment. You are up to date!");
      return;
    }

    for (const job of targets) {
      const jobKey = job.url || job.id || `${job.company_name}-${job.title}`;
      console.log(`\n🤖 Running technical diagnosis on: ${job.company_name} (${job.title})...`);

      try {
        const analysis = await analyzeJob(job);
        const sent = await sendTelegramAlert(analysis, job);
        if (sent) {
          seenJobs.add(jobKey);
          saveSeenJobs(seenJobs);
          console.log(`✅ Alert dispatched & saved to seen_jobs for ${job.company_name}`);
        }
      } catch (itemErr) {
        console.error(`❌ Error processing ${job.company_name}:`, itemErr.message);
      }
    }

    console.log("\n🏁 DevRadar finished successfully!");
  } catch (err) {
    console.error("💥 Unhandled runtime error:", err);
  }
}

run();
