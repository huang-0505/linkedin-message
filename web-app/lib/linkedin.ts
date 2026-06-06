// Build LinkedIn people-search URLs from a free-text query.
// We do NOT scrape LinkedIn — these URLs are opened in a new tab so the user
// can search and reach out manually.

export function buildLinkedInPeopleSearchUrl(
  query: string,
  opts: { currentCompanyId?: string } = {},
): string {
  const params = new URLSearchParams();
  params.set("keywords", normalizeLinkedInPeopleSearchQuery(query));

  const companyId = normalizeLinkedInCompanyId(opts.currentCompanyId || "");
  if (companyId) {
    params.set("origin", "FACETED_SEARCH");
    params.set("currentCompany", JSON.stringify([companyId]));
  }

  return `https://www.linkedin.com/search/results/people/?${params.toString()}`;
}

export function normalizeLinkedInPeopleSearchQuery(query: string): string {
  return query
    .replace(/[\u201c\u201d"]/g, " ")
    .replace(/[\u2018\u2019']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function removeLinkedInLocationFromQuery(
  query: string,
  location: string | undefined,
): string {
  let cleaned = normalizeLinkedInPeopleSearchQuery(query);
  const candidates = locationSearchTerms(location);

  for (const term of candidates) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi"), " ");
  }

  return normalizeLinkedInPeopleSearchQuery(cleaned);
}

// Produce useful rule-based search queries for a given job.
export function defaultSearchQueries(opts: {
  company: string;
  jobTitle: string;
  school?: string;
  useCompanyKeyword?: boolean;
}): string[] {
  const { company, jobTitle, useCompanyKeyword = true } = opts;
  const companyPrefix = useCompanyKeyword ? company : "";
  return [
    normalizeLinkedInPeopleSearchQuery(`${companyPrefix} ${jobTitle}`),
    normalizeLinkedInPeopleSearchQuery(`${companyPrefix} ${managerRoleFor(jobTitle)}`),
    normalizeLinkedInPeopleSearchQuery(
      `${companyPrefix} recruiter talent acquisition ${functionalArea(jobTitle)}`,
    ),
  ];
}

export function normalizeLinkedInCompanyId(value: string): string {
  return (value || "").match(/\d+/)?.[0] || "";
}

function locationSearchTerms(location: string | undefined): string[] {
  const normalized = normalizeLinkedInPeopleSearchQuery(location || "");
  if (!normalized) return [];

  const parts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);

  return Array.from(new Set([normalized, parts[0]].filter(Boolean))).sort(
    (a, b) => b.length - a.length,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function managerRoleFor(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("forward deployed")) return "Forward Deployed Engineering Manager";
  if (t.includes("ai engineer")) return "AI Engineering Manager";
  if (t.includes("data scientist")) return "Data Science Manager";
  if (t.includes("machine learning")) return "ML Engineering Manager";
  if (t.includes("software engineer")) return "Engineering Manager";
  if (t.includes("product manager")) return "Director of Product";
  return `${title} Manager`;
}

function functionalArea(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("forward deployed")) return "Engineering";
  if (t.includes("ai engineer")) return "AI";
  if (t.includes("machine learning") || t.includes("ml")) return "Machine Learning";
  if (t.includes("data scientist")) return "Data Science";
  if (t.includes("data engineer")) return "Data Engineering";
  if (t.includes("software") || t.includes("engineer")) return "Engineering";
  if (t.includes("product")) return "Product";
  return "";
}
