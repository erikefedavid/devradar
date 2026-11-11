import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

  return jobs;
}

// 2. Filter for relevant stacks and unseen jobs
function filterRelevantJobs(jobs, seenJobs) {
  const allowedTitleWords = ["developer", "engineer", "frontend", "front-end", "fullstack", "full stack", "software"];
  const negativeWords = ["content reviewer", "customer support", "sales", "recruiter", "manager"];
  const techKeywords = ["react", "next.js", "nextjs", "typescript", "javascript", "tailwind", "node"];

  return jobs.filter((job) => {
    const jobKey = job.url || job.id || `${job.company_name}-${job.title}`;
    if (seenJobs.has(jobKey)) {
      return false; // Skip already alerted jobs
    }

    const title = (job.title || "").toLowerCase();
    const body = `${job.title} ${job.description || ""}`.toLowerCase();

    // Must look like an engineering title
    const isDevRole = allowedTitleWords.some((word) => title.includes(word));
    // Must NOT be customer support/content review
    const isNotExcluded = !negativeWords.some((word) => title.includes(word));
    // Must mention core stack
    const hasStack = techKeywords.some((kw) => body.includes(kw));

    return isDevRole && isNotExcluded && hasStack;
  }).slice(0, 3); // Process up to 3 fresh high-match roles per run
}

// 3. Technical Gap Diagnosis via Gemini (with 503 & 429 retry protection)
async function analyzeJob(job, retries = 2) {
  const cleanDescription = (job.description || "")
    .replace(/<[^>]*>?/gm, " ")
    .replace(/\s+/g, " ")
    .slice(0, 2500);

  const prompt = `
You are a Principal Software Engineer helping a candidate pitch proof-of-work.
Target Company: ${job.company_name}
Role Title: ${job.title}
Job Excerpt:
${cleanDescription}

Candidate Profile:
- Full-Stack / Frontend Engineer (Next.js, TypeScript, Tailwind CSS, REST & AI APIs, MongoDB).

Provide:
1. Target Company & Role
2. The core technical or UX bottleneck this team faces based on the excerpt.
3. ONE lightweight proof-of-work demo (a standalone component or feature buildable in 45 mins with Next.js/Tailwind) that proves the candidate can solve it.
4. A 3-sentence direct outreach message to the founder/lead engineer. DO NOT include a link yet (ask permission first).

Keep it clean, concise, and professional.
`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
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

// 4. Send plain-text Telegram alert (safely clamped to Telegram 4096 char limit)
async function sendTelegramAlert(analysisText, jobUrl) {
  let payload = `🚀 [DEVRADAR OPPORTUNITY]\n\n${analysisText}\n\n🔗 Application Link:\n${jobUrl}`;

  // Telegram limit is 4096 characters
  if (payload.length > 4000) {
    payload = payload.slice(0, 3950) + `\n\n...[truncated]\n\n🔗 Application Link:\n${jobUrl}`;
  }

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: payload,
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("❌ Telegram API error:", data.description);
    return false;
  }
  return true;
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
        const sent = await sendTelegramAlert(analysis, job.url);
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
