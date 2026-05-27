export function cleanJobTitle(title: string): string {
  const normalized = title
    .replace(/^selected,\s*/i, "")
    .replace(/\s*\(verified job\)\s*/gi, "")
    .replace(/\s+with verification$/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const knownRole = compactKnownRole(normalized);
  if (knownRole) return knownRole;

  const firstSegment = normalized
    .split(/[,|/]/)[0]
    .replace(/\b(entry[-\s]?level|new grad|early career|internship|intern)\b/gi, "")
    .replace(/\b(associate|senior|sr\.?|staff|principal|lead|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const fallbackRole = compactKnownRole(firstSegment);
  if (fallbackRole) return fallbackRole;

  return titleCaseRole(firstSegment.split(" ").slice(0, 3).join(" ") || normalized);
}

export function inferJobTitleFromDescription(description: string): string {
  const text = description.replace(/\u00a0/g, " ").trim();
  if (!text) return "";

  const explicitTitle = valueAfterLabel(text, "(?:job title|title)");
  if (isLikelyJobTitle(explicitTitle)) return cleanJobTitle(explicitTitle);

  const roleSentenceTitle = titleFromRoleSentence(text);
  if (roleSentenceTitle) return cleanJobTitle(roleSentenceTitle);

  return "";
}

export function inferJobTitleFromUrl(jobUrl: string): string {
  try {
    const url = new URL(jobUrl);
    const slug = decodeURIComponent(
      url.pathname.match(/\/jobs\/view\/([^/?#]+)/i)?.[1] || "",
    )
      .replace(/\/$/, "")
      .replace(/-\d+$/, "");

    if (!slug || /^\d+$/.test(slug)) return "";

    const atIndex = slug.lastIndexOf("-at-");
    const titleSlug = atIndex > 0 ? slug.slice(0, atIndex) : slug;
    const title = titleSlug.replace(/-/g, " ");

    return isMetadataJobTitle(title) ? cleanJobTitle(title) : "";
  } catch {
    return "";
  }
}

function valueAfterLabel(text: string, labelPattern: string): string {
  const labels =
    "(?:job title|title|company|location|job description|description|requirements?|responsibilities|qualifications)";
  const match = text.match(
    new RegExp(
      `\\b${labelPattern}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*${labels}\\s*:|\\b${labels}\\s*:|$)`,
      "i",
    ),
  );
  return cleanCandidate(match?.[1] || "");
}

function cleanCandidate(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromRoleSentence(text: string): string {
  const patterns = [
    /\bas\s+(?:an?|the)?\s+([^,.;\n]+?)(?:,|\syou\b|\swill\b)/i,
    /\b(?:is|are)\s+(?:looking|hiring|searching)\s+for\s+(?:an?|the)?\s+([^.\n;,]+)/i,
    /\bseeking\s+(?:an?|the)?\s+([^.\n;,]+)/i,
    /\b(?:role|position)\s+(?:of|for)\s+(?:an?|the)?\s+([^.\n;,]+)/i,
  ];

  for (const pattern of patterns) {
    const candidate = cleanCandidate(text.match(pattern)?.[1] || "");
    if (isLikelyJobTitle(candidate)) return candidate;
  }

  return "";
}

function isLikelyJobTitle(title: string): boolean {
  return /\b(engineer|scientist|manager|specialist|analyst|developer|designer|intern|lead|director|product|data|software|machine learning|ai|ml|consultant|associate|architect)\b/i.test(
    title,
  );
}

function isMetadataJobTitle(title: string): boolean {
  const text = title.replace(/\s+/g, " ").trim();
  return Boolean(
    text &&
      text.length >= 2 &&
      text.length <= 140 &&
      /[a-zA-Z]/.test(text) &&
      !/^(apply|easy apply|save|saved|remote|hybrid|on-site|full-time|premium|about the job|linkedin)$/i.test(text),
  );
}

function compactKnownRole(title: string): string {
  const t = title.toLowerCase();

  if (/\bforward\s+deployed\b/.test(t) && /\bai\b/.test(t) && /\bengineer\b/.test(t)) {
    return "Forward Deployed AI Engineer";
  }
  if (/\bforward\s+deployed\b/.test(t) && /\bengineer\b/.test(t)) {
    return "Forward Deployed Engineer";
  }
  if (/\b(machine learning|ml)\s+engineer\b/.test(t)) {
    return "Machine Learning Engineer";
  }
  if (/\bai\s+engineer\b/.test(t) || /\bartificial intelligence\s+engineer\b/.test(t)) {
    return "AI Engineer";
  }
  if (/\bdata\s+scientist\b/.test(t)) return "Data Scientist";
  if (/\bdata\s+engineer\b/.test(t)) return "Data Engineer";
  if (/\bfull[-\s]?stack\s+engineer\b/.test(t)) return "Full Stack Engineer";
  if (/\bfront[-\s]?end\s+engineer\b/.test(t)) return "Frontend Engineer";
  if (/\bback[-\s]?end\s+engineer\b/.test(t)) return "Backend Engineer";
  if (/\bsoftware\s+engineer\b/.test(t)) return "Software Engineer";
  if (/\bprompt\s+engineer\b/.test(t)) return "Prompt Engineer";
  if (/\bprompt\s+specialist\b/.test(t)) return "Prompt Specialist";
  if (/\bresearch\s+scientist\b/.test(t)) return "Research Scientist";
  if (/\bproduct\s+manager\b/.test(t)) return "Product Manager";
  if (/\bproduct\s+designer\b/.test(t)) return "Product Designer";
  if (/\bsolutions?\s+engineer\b/.test(t)) return "Solutions Engineer";
  if (/\bsupport\s+engineer\b/.test(t)) return "Support Engineer";
  if (/\bdevops\s+engineer\b/.test(t)) return "DevOps Engineer";
  if (/\bmlops\s+engineer\b/.test(t)) return "MLOps Engineer";

  return "";
}

function titleCaseRole(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase();
      if (["AI", "ML", "LLM", "RAG", "NLP", "MLOPS", "DEVOPS"].includes(upper)) {
        if (upper === "MLOPS") return "MLOps";
        if (upper === "DEVOPS") return "DevOps";
        return upper;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ")
    .trim();
}
