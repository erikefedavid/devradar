import dotenv from "dotenv";
dotenv.config();

export const config = {
  // 1. Candidate Persona & Pitch Profile
  candidateProfile:
    process.env.CANDIDATE_PROFILE ||
    "Full-Stack / Frontend Engineer (Next.js, TypeScript, Tailwind CSS, REST & AI APIs, MongoDB).",

  // 2. Role Title Filtering (must match at least one)
  allowedTitleWords: [
    "developer",
    "engineer",
    "frontend",
    "front-end",
    "fullstack",
    "full stack",
    "software",
    "web",
  ],

  // 3. Exclusions (skip if title matches any)
  negativeTitleWords: [
    "content reviewer",
    "customer support",
    "sales",
    "recruiter",
    "manager",
    "intern",
    "qa",
    "tester",
  ],

  // 4. Core Stack & Keywords (must match in title or body)
  techKeywords: [
    "react",
    "next.js",
    "nextjs",
    "typescript",
    "javascript",
    "tailwind",
    "node",
    "fullstack",
    "frontend",
  ],

  // 5. Execution Limits
  maxJobsPerRun: parseInt(process.env.MAX_JOBS_PER_RUN || "3", 10),
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
};
