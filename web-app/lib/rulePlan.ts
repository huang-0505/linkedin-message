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
  return fitLinkedInMessage(company, title);
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

function fitLinkedInMessage(company: string, title: string): string {
  const linkedinLimit = 300;
  const message = (nextCompany: string) => messageForRole(title, nextCompany);

  const current = message(company);
  if (current.length <= linkedinLimit) return current;

  const withoutCompany = message("");
  if (withoutCompany.length <= linkedinLimit) return withoutCompany;

  return `Hi, I'm Junhui, a Brown DS master's grad focused on ML/LLM and software development. I'm applying for this role. Do you happen to know the hiring team or referral process? I'd be grateful for any guidance and happy to connect and chat!`;
}

function messageForRole(title: string, company: string): string {
  const target = company ? `the ${title} role at ${company}` : `the ${title} role`;
  return `Hi, I'm Junhui, a Brown DS master's grad focused on ML/LLM and software development. I'm applying for ${target}. Do you happen to know the hiring team or referral process? I'd be grateful for any guidance and happy to connect and chat!`;
}
