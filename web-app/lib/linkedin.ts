// Build LinkedIn people-search URLs from a free-text query.
// We do NOT scrape LinkedIn — these URLs are opened in a new tab so the user
// can search and reach out manually.

export function buildLinkedInPeopleSearchUrl(query: string): string {
  const encoded = encodeURIComponent(query.trim());
  return `https://www.linkedin.com/search/results/people/?keywords=${encoded}`;
}

// Produce useful rule-based search queries for a given job.
export function defaultSearchQueries(opts: {
  company: string;
  jobTitle: string;
  city?: string;
  school?: string;
}): string[] {
  const { company, jobTitle, city } = opts;
  return [
    withCity(`${company} "${jobTitle}"`, city),
    withCity(`${company} ${managerRoleFor(jobTitle)}`, city),
    withCity(`${company} recruiter talent acquisition ${functionalArea(jobTitle)}`.trim(), city),
  ];
}

function withCity(query: string, city = ""): string {
  return [query.trim(), city.trim()].filter(Boolean).join(" ");
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
