import dotenv from "dotenv";
dotenv.config();

export const config = {
  // 1. Candidate Persona & Pitch Profile (Pure Frontend Developer)
  candidateProfile:
    process.env.CANDIDATE_PROFILE ||
    "Frontend Developer (React, Next.js, TypeScript, JavaScript, Tailwind CSS, Responsive UI, Web Performance, State Management, Modern Web Apps).",

  // 2. Allowed Title Keywords (strictly Frontend / Web UI roles)
  allowedTitleWords: [
    "frontend",
    "front-end",
    "front end",
    "react",
    "next.js",
    "nextjs",
    "ui engineer",
    "ui developer",
    "web developer",
    "web engineer",
    "javascript developer",
    "website",
  ],

  // 3. Strict Exclusions (skip if title matches ANY Senior, Lead, or Backend keyword)
  negativeTitleWords: [
    // Seniority exclusions
    "senior",
    "sr.",
    "sr ",
    "lead",
    "principal",
    "staff",
    "architect",
    "director",
    "head",
    "manager",
    "vp",
    "chief",
    // Backend & infrastructure exclusions
    "backend",
    "back-end",
    "back end",
    "devops",
    "sre",
    "infrastructure",
    "platform",
    "data engineer",
    "database",
    "cloud",
    "security",
    "blockchain",
    "solidity",
    "android",
    "ios",
    "mobile developer",
    // Non-engineering
    "qa",
    "tester",
    "intern",
    "sales",
    "support",
    "recruiter",
    "writer",
    "content",
  ],

  // 4. Core Frontend Tech Keywords (must match in title or body)
  techKeywords: [
    "react",
    "next.js",
    "nextjs",
    "tailwind",
    "typescript",
    "javascript",
    "css",
    "html",
    "ui",
    "frontend",
    "front-end",
  ],

  // 5. Execution Limits
  maxJobsPerRun: parseInt(process.env.MAX_JOBS_PER_RUN || "3", 10),
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
};
