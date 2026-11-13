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

// Helper: save seen jobs (keeps latest 500)
function saveSeenJobs(seenSet) {
  try {
    const list = Array.from(seenSet).slice(-500);
    fs.writeFileSync(SEEN_JOBS_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.error("⚠️ Failed to write to seen_jobs.json:", err.message);
  }
}

// Helper: Generate precision 1-click founder discovery links
function buildFounderSearchLinks(companyName) {
  const cleanCompany = encodeURIComponent((companyName || "").trim());
  const linkedinUrl = `https://www.linkedin.com/search/results/people/?keywords=${cleanCompany}%20founder%20OR%20CTO`;
  const twitterUrl = `https://twitter.com/search?q=${cleanCompany}%20founder%20OR%20CTO`;
  const googleFounderUrl = `https://www.google.com/search?q=site%3Alinkedin.com%2Fin%20%22${cleanCompany}%22%20(founder%20OR%20CTO%20OR%20%22engineering%20lead%22)`;
  return { linkedinUrl, twitterUrl, googleFounderUrl };
}

// -------------------------------------------------------------
// LIVE PRODUCTION TELEMETRY AUDITOR
// Probes the target company's real website to inspect real UI metrics
// -------------------------------------------------------------
async function auditCompanyWebsite(targetUrl) {
  if (!targetUrl || targetUrl.includes("ycombinator.com/item") || targetUrl.includes("jobicy.com") || targetUrl.includes("remotive.com")) {
    return null;
  }

  try {
    const urlObj = new URL(targetUrl);
    const domainUrl = `${urlObj.protocol}//${urlObj.hostname}`;

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(domainUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (DevRadar Bot)" }
    });
    clearTimeout(timeout);

    const ttfb = Date.now() - start;
    const html = await res.text();

    const isNext = html.includes("__NEXT_DATA__") || html.includes("/_next/");
    const isReact = html.includes("react") || isNext || html.includes("root");
    const isTailwind = html.includes("tailwind") || /class="[^"]*(flex|grid|p-|m-|text-)[^"]*"/.test(html);
    const hasOgImage = html.includes("og:image");

    const detectedTech = [
      isNext ? "Next.js" : (isReact ? "React" : null),
      isTailwind ? "Tailwind CSS" : null
    ].filter(Boolean).join(", ") || "Standard Web Stack";

    return {
      domain: urlObj.hostname,
      ttfbMs: ttfb,
      detectedTech,
      hasOgImage,
    };
  } catch (err) {
    return null;
  }
}

// -------------------------------------------------------------
// MULTI-SOURCE INGESTION GRID
// -------------------------------------------------------------
async function fetchJobs() {
  console.log("🔍 DevRadar: Ingesting jobs across 4 diversified intelligence sources...");
  const jobs = [];

  // Source 1: Remotive (Curated Tech Feeds)
  try {
    const res = await fetch("https://remotive.com/api/remote-jobs?category=software-dev&limit=40");
    if (res.ok) {
      const data = await res.json();
      if (data.jobs) {
        jobs.push(...data.jobs.map(j => ({ ...j, source: "Remotive" })));
      }
      console.log(`📡 Remotive returned ${data.jobs?.length || 0} jobs.`);
    }
  } catch (err) {
    console.error("⚠️ Failed to reach Remotive:", err.message);
  }

  // Source 2: Jobicy (Dedicated Frontend Channel)
  try {
    const res = await fetch("https://jobicy.com/api/v2/remote-jobs?count=50&tag=frontend");
    if (res.ok) {
      const data = await res.json();
      const jobicyJobs = (data.jobs || []).map((j) => ({
        id: j.id ? String(j.id) : undefined,
        company_name: j.companyName,
        title: j.jobTitle,
        description: j.jobDescription,
        url: j.url,
        source: "Jobicy",
      }));
      jobs.push(...jobicyJobs);
      console.log(`📡 Jobicy returned ${jobicyJobs.length} frontend roles.`);
    }
  } catch (err) {
    console.error("⚠️ Failed to reach Jobicy:", err.message);
  }

  // Source 3: Arbeitnow (Remote Tech Feeds)
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
          source: "Arbeitnow",
        }));
      jobs.push(...arbeitnowJobs);
      console.log(`📡 Arbeitnow returned ${arbeitnowJobs.length} remote roles.`);
    }
  } catch (err) {
    console.error("⚠️ Failed to reach Arbeitnow:", err.message);
  }

  // Source 4: Y Combinator Hacker News "Who is Hiring" (Direct Founder Pipe)
  try {
    const storyRes = await fetch("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=1");
    if (storyRes.ok) {
      const storyData = await storyRes.json();
      const storyId = storyData.hits?.[0]?.objectID;
      if (storyId) {
        const commentsRes = await fetch(`https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&query=frontend%20react%20remote&hitsPerPage=20`);
        if (commentsRes.ok) {
          const commentsData = await commentsRes.json();
          for (const comment of (commentsData.hits || [])) {
            const rawText = (comment.comment_text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            if (!rawText || rawText.length < 50) continue;

            const firstSegment = rawText.split("|")[0]?.trim() || "YC / Hacker News Startup";
            const urlMatch = rawText.match(/https?:\/\/[^\s"',)]+/);
            const appUrl = urlMatch ? urlMatch[0] : `https://news.ycombinator.com/item?id=${comment.objectID}`;

            jobs.push({
              id: `hn-${comment.objectID}`,
              company_name: firstSegment.slice(0, 35),
              title: rawText.slice(0, 50) || "Frontend Engineer",
              description: rawText.slice(0, 2000),
              url: appUrl,
              source: "Hacker News (YC)",
            });
          }
          console.log(`📡 Hacker News YC returned ${(commentsData.hits || []).length} founder postings.`);
        }
      }
    }
  } catch (err) {
    console.error("⚠️ Failed to reach Hacker News API:", err.message);
  }

  return jobs;
}

// -------------------------------------------------------------
// FILTERING ENGINE
// -------------------------------------------------------------
function filterRelevantJobs(jobs, seenJobs) {
  return jobs.filter((job) => {
    const jobKey = job.url || job.id || `${job.company_name}-${job.title}`;
    if (seenJobs.has(jobKey)) {
      return false; // Skip already alerted jobs
    }

    const title = (job.title || "").toLowerCase();
    const body = `${job.title} ${job.description || ""}`.toLowerCase();

    // Must look like an engineering/frontend title
    const isDevRole = config.allowedTitleWords.some((word) => title.includes(word));
    // Strict drop of Senior, Lead, Backend
    const isNotExcluded = !config.negativeTitleWords.some((word) => title.includes(word));
    // Must mention core frontend stack
    const hasStack = config.techKeywords.some((kw) => body.includes(kw));

    return isDevRole && isNotExcluded && hasStack;
  }).slice(0, config.maxJobsPerRun);
}

// -------------------------------------------------------------
// AI PRINCIPAL ENGINEER DIAGNOSIS WITH LIVE TELEMETRY & LOOM SCRIPT
// -------------------------------------------------------------
async function analyzeJob(job, auditData, retries = 2) {
  const cleanDescription = (job.description || "")
    .replace(/<[^>]*>?/gm, " ")
    .replace(/\s+/g, " ")
    .slice(0, 2500);

  const telemetryNote = auditData
    ? `Live Website Telemetry (${auditData.domain}): Latency: ${auditData.ttfbMs}ms | Detected Stack: ${auditData.detectedTech} | OpenGraph Social Card: ${auditData.hasOgImage ? "Present" : "Missing"}`
    : "Live Website Telemetry: Standard web extraction.";

  const prompt = `
You are a Principal Frontend & AI Engineer preparing a candidate for high-conversion proof-of-work outreach.
Target Company: ${job.company_name}
Role Title: ${job.title}
Data Source: ${job.source || "Web Feed"}
${telemetryNote}

Job Excerpt:
${cleanDescription}

Candidate Profile:
- ${config.candidateProfile}
- Flagship Artifacts:
  * DocDigitize (Local Vector RAG & Groq Multimodal OCR): https://docdigitize.vercel.app
  * GitSentry (Autonomous 60fps Animation Sentinel): https://github.com/erikefedavid/GitSentry
  * OmniAgent (Autonomous Problem-Solving ReAct Agent): https://github.com/erikefedavid/OmniAgent
  * ToolDeck (Curated Free AI Directory): https://aitooldesk.vercel.app
  * Portfolio: https://daviderikefe.vercel.app

Format your response strictly using Telegram-compatible HTML tags (<b>, <i>, <code>). Do NOT use Markdown characters like **, __, #, or backticks.

Output structure:
🏢 <b>Company & Role:</b> ${job.company_name} — ${job.title} [${job.source || "Direct"}]

🌐 <b>Live Telemetry:</b>
${auditData ? `• Response Latency: <code>${auditData.ttfbMs}ms</code> | Stack: <code>${auditData.detectedTech}</code>` : "• Live Stack: Web Application"}

⚡ <b>Core Architecture & Bottleneck:</b>
[1-2 sentences diagnosing the exact UI, state management, or AI/RAG performance friction point based on excerpt and telemetry]

🛠️ <b>Proof-of-Work Demo (45 Mins):</b>
[1 concrete, buildable Next.js/Tailwind or Agentic prototype proving capability]

💬 <b>Cold Outreach Message:</b>
<code>[A punchy 3-sentence message to the founder/lead engineer referencing your ICMLDE 2026 paper, DocDigitize, or GitSentry. No links.]</code>

🎬 <b>30-Sec Loom Script:</b>
• <i>Hook (0-10s):</i> [Point out the specific bottleneck or UX opportunity]
• <i>Showcase (10-25s):</i> [Screen-share your proof-of-work component in action]
• <i>Call to Action (25-30s):</i> [Invite them to test the live code, zero pressure]
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
      return analyzeJob(job, auditData, retries - 1);
    }
    throw err;
  }
}

// -------------------------------------------------------------
// TELEGRAM ALERT DISPATCHER (Rich HTML + Inline Buttons)
// -------------------------------------------------------------
async function sendTelegramAlert(analysisText, job) {
  const jobUrl = job.url;
  const { linkedinUrl, twitterUrl, googleFounderUrl } = buildFounderSearchLinks(job.company_name);

  const isValidUrl = (u) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const inlineKeyboard = [];
  const row1 = [];
  if (isValidUrl(jobUrl)) {
    row1.push({ text: "🚀 View Opportunity", url: jobUrl });
  }
  if (isValidUrl(linkedinUrl)) {
    row1.push({ text: "💼 LinkedIn Founders", url: linkedinUrl });
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

  let htmlPayload = `🚀 <b>DEVRADAR OPPORTUNITY</b>\n\n${analysisText.trim()}\n\n🔗 <a href="${jobUrl}"><b>Apply / Direct Link</b></a> | <a href="${googleFounderUrl}"><b>Google Founder Search</b></a>`;

  if (htmlPayload.length > 4000) {
    htmlPayload = htmlPayload.slice(0, 3900) + `\n\n...[truncated]\n\n🔗 <a href="${jobUrl}"><b>Apply / Direct Link</b></a>`;
  }

  // 1. Try formatted HTML first
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

  // 2. Fallback to clean plain text
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

// -------------------------------------------------------------
// DAILY MORNING TELEMETRY BRIEFING (Zero-Silence Guarantee)
// -------------------------------------------------------------
async function sendMorningTelemetryReport(stats) {
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const payload = `🛰️ <b>DEVRADAR MORNING SCAN REPORT</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 <b>Date:</b> ${dateStr} [09:15 AM WAT]
📡 <b>Sources Scanned:</b> 4 (Remotive, Jobicy, Arbeitnow, Hacker News YC)
🔎 <b>Total Jobs Evaluated:</b> ${stats.totalJobs}
🎯 <b>New Pure Frontend Roles:</b> ${stats.newMatches}
💾 <b>Historical Seen Jobs:</b> ${stats.seenCount}
⚡ <b>Status:</b> ${stats.newMatches > 0 ? "🚀 High-Value Targets Dispatched Below" : "✅ 100% Up to Date (No noise)"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${stats.newMatches === 0 ? "<i>Radar completed scan. No new junior/mid frontend positions posted overnight. Your pipeline is vigilant and running on schedule!</i>" : "<i>Processing and diagnosing top matching opportunities now...</i>"}`;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: payload,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.error("⚠️ Failed to send morning telemetry ping:", err.message);
  }
}

// -------------------------------------------------------------
// EXECUTION ORCHESTRATOR
// -------------------------------------------------------------
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

    // Zero-Silence Guarantee: Send Telemetry ping when 0 new roles are found
    if (targets.length === 0) {
      await sendMorningTelemetryReport({
        totalJobs: allJobs.length,
        newMatches: 0,
        seenCount: seenJobs.size,
      });
      console.log("ℹ️ No new unseen matching jobs today. Morning telemetry dispatched!");
      return;
    }

    for (const job of targets) {
      const jobKey = job.url || job.id || `${job.company_name}-${job.title}`;
      console.log(`\n🤖 Running technical diagnosis on: ${job.company_name} (${job.title})...`);

      try {
        console.log(`🌐 Performing live website audit for ${job.company_name}...`);
        const auditData = await auditCompanyWebsite(job.url);

        const analysis = await analyzeJob(job, auditData);
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
