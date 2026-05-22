// Deterministic referral plan generation. No LLMs, API keys, or network calls.

import { buildLinkedInPeopleSearchUrl, defaultSearchQueries } from "./linkedin";
import { cleanJobTitle } from "./jobText";
import type { ReferralPlan, JobData } from "./types";

export function buildRulePlan(job: JobData): ReferralPlan {
  const company = job.company || "the company";
  const title = cleanJobTitle(job.jobTitle || "the role");
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
      whyRelevant: `Recruiters can confirm the role is open and surface it to the hiring manager.`,
      q: queries[2],
    },
  ];

  return {
    jobSummary: `${title} at ${company}${job.location ? ` (${job.location})` : ""}.`,
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
  return `Hi, I'm Junhui, a Brown DS master's grad focused on LLM/RAG. I'm applying for the ${title} role at ${company}. Do you happen to know the hiring team or referral process? I'd be grateful for any guidance and happy to chat briefly.`;
}
