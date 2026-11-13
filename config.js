import dotenv from "dotenv";
dotenv.config();

export const config = {
  // 1. Candidate Persona & Pitch Profile (First Class CS Grad + Full-Stack AI & Frontend)
  candidateProfile:
    process.env.CANDIDATE_PROFILE ||
    "First-Class Computer Science graduate & Full-Stack AI Engineer (Next.js, TypeScript, React, Tailwind CSS, Local Dense-Vector RAG, Multimodal OCR). Accepted research author at ICMLDE 2026. Creator of DocDigitize, ToolDeck, and GitSentry.",

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

  // 3. Strict Exclusions (drop Senior, Lead, Backend, AWS, Docker, DevOps, Cloud)
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
    // Heavy DevOps, Cloud & Container exclusions
    "aws",
    "docker",
    "kubernetes",
    "k8s",
    "devops",
    "sre",
    "infrastructure",
    "platform",
    "cloud",
    "gcp",
    "azure",
    "terraform",
    // Backend & database exclusions
    "backend",
    "back-end",
    "back end",
    "fullstack",
    "full-stack",
    "full stack",
    "data engineer",
    "database",
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
