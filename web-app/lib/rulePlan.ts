// Deterministic referral plan generation. No LLMs, API keys, or network calls.

import { buildLinkedInPeopleSearchUrl, defaultSearchQueries } from "./linkedin";
import { cleanJobTitle } from "./jobText";
import type { ReferralPlan, JobData } from "./types";

export function buildRulePlan(job: JobData): ReferralPlan {
  const company = job.company || "the company";
  const title = cleanJobTitle(job.jobTitle || "the role");
  const sponsorshipSummary = sponsorshipSummaryFor(job);
  const queries = defaultSearchQueries({
    company,
    jobTitle: title,
  });

  const categories: Array<{ category: string; whyRelevant: string; q: string }> = [
    {
      category: "Same-role employee",
      whyRelevant: `Someone already doing ${title} at ${company} can speak to the team and refer internally.`,
      q: queries[0],
    },
    {
      category: "Hiring manager / team lead",
      whyRelevant: `Managers have the strongest signal on open headcount and can fast-track strong candidates.`,
      q: queries[1],
    },
    {
      category: "Recruiter",
      whyRelevant:
        job.sponsorshipStatus === "unknown"
          ? `Recruiters can confirm the role is open, verify visa sponsorship support, and surface it to the hiring manager.`
          : `Recruiters can confirm the role is open and surface it to the hiring manager.`,
      q: queries[2],
    },
  ];

  return {
    jobSummary: [
      `${title} at ${company}${job.location ? ` (${job.location})` : ""}.`,
      sponsorshipSummary,
    ]
      .filter(Boolean)
      .join("\n"),
    targetPeople: categories.map(({ category, whyRelevant, q }) => ({
      category,
      whyRelevant,
      searchQuery: q,
      linkedinSearchUrl: buildLinkedInPeopleSearchUrl(q),
      connectionMessage: connectionMessageFor(company, title),
      followUpMessage: "",
      referralAskMessage: "",
    })),
  };
}

function connectionMessageFor(company: string, title: string): string {
  return fitLinkedInMessage(company, title, messageFamilyFor(title));
}

function sponsorshipSummaryFor(job: JobData): string {
  const evidence = job.sponsorshipEvidence
    ? ` Evidence: "${job.sponsorshipEvidence}"`
    : "";

  if (job.sponsorshipStatus === "sponsors") {
    return `Visa sponsorship: appears available.${evidence}`;
  }

  if (job.sponsorshipStatus === "no_sponsorship") {
    return `Visa sponsorship: appears unavailable. Confirm work authorization before spending referral effort.${evidence}`;
  }

  return "Visa sponsorship: unknown. Ask a recruiter or contact to confirm before investing much time.";
}

function messageFamilyFor(title: string): "ai" | "data_science" | "general" {
  const value = title.toLowerCase();

  if (/\b(data\s+scientist|decision\s+scientist|research\s+analyst|data\s+analyst|analytics)\b/.test(value)) {
    return "data_science";
  }

  if (
    /\b(ai|llm|rag|generative|genai|nlp|prompt|machine\s+learning|ml\s+engineer|forward\s+deployed|solutions?\s+engineer|customer\s+engineer)\b/.test(
      value,
    )
  ) {
    return "ai";
  }

  return "general";
}

function fitLinkedInMessage(
  company: string,
  title: string,
  family: "ai" | "data_science" | "general",
): string {
  const budgetWithNameRoom = 290;
  const message = (nextCompany: string) =>
    messageForFamily(title, nextCompany, family);

  const current = message(company);
  if (current.length <= budgetWithNameRoom) return current;

  const withoutCompany = message("");
  if (withoutCompany.length <= budgetWithNameRoom) return withoutCompany;

  return `Hi, I'm Junhui, Brown DS master's focused on data/AI systems. I am applying for ${title}. Would appreciate a referral or intro to the hiring team. Thanks!`;
}

function messageForFamily(
  title: string,
  company: string,
  family: "ai" | "data_science" | "general",
): string {
  const role = company ? `${title} at ${company}` : title;

  if (family === "data_science") {
    return `Hi, I'm Junhui, Brown DS master's focused on ML and LLM systems, built an XGBoost model saving ~$2M in cement production and fine-tuned an LLM for a vet-tech startup. I am applying for ${role}. Would appreciate a referral or intro to the hiring team. Thanks!`;
  }

  if (family === "ai") {
    return `Hi, I'm Junhui, Brown DS master's focused on AI/LLM systems, built AI platform for construction SaaS and multi-agent DnD AI game. I am applying for ${role}. I'd really appreciate your help with a referral or connecting with the hiring team. Thanks in advance!`;
  }

  return `Hi, I'm Junhui, Brown DS master's focused on data/AI systems. I am applying for ${role}. Would appreciate a referral or intro to the hiring team. Thanks!`;
}
