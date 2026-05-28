import type { SponsorshipAnalysis } from "./types";

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

export function analyzeSponsorship(text: string): SponsorshipAnalysis {
  const normalized = cleanSponsorshipText(text);
  if (!normalized) return { status: "unknown", evidence: "" };

  const noEvidence = findSponsorshipEvidence(normalized, NO_SPONSORSHIP_PATTERNS);
  if (noEvidence) {
    return {
      status: "no_sponsorship",
      evidence: noEvidence,
    };
  }

  const yesEvidence = findSponsorshipEvidence(normalized, SPONSORSHIP_AVAILABLE_PATTERNS);
  if (yesEvidence) {
    return {
      status: "sponsors",
      evidence: yesEvidence,
    };
  }

  return { status: "unknown", evidence: "" };
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

const NO_SPONSORSHIP_PATTERNS: RegExp[] = [
  /\b(?:do|does|will|can)\s+not\s+(?:sponsor|provide\s+sponsorship|offer\s+sponsorship|support\s+sponsorship|provide\s+visa\s+sponsorship|offer\s+visa\s+sponsorship)\b[^.!?\n]{0,160}/i,
  /\b(?:doesn't|don't|won't|cannot|can't)\s+(?:sponsor|provide\s+sponsorship|offer\s+sponsorship|support\s+sponsorship|provide\s+visa\s+sponsorship|offer\s+visa\s+sponsorship)\b[^.!?\n]{0,160}/i,
  /\b(?:unable|not\s+able)\s+to\s+(?:sponsor|provide\s+sponsorship|offer\s+sponsorship|support\s+sponsorship|take\s+over\s+sponsorship|transfer\s+sponsorship)\b[^.!?\n]{0,160}/i,
  /\b(?:no|not\s+eligible\s+for)\s+(?:visa\s+|immigration\s+|employment\s+|work\s+authorization\s+|work\s+visa\s+)?sponsorship\b[^.!?\n]{0,160}/i,
  /\b(?:visa|immigration|employment|work(?:\s+authorization)?|work\s+visa|H-?1B|H1B|TN|OPT|CPT)\s+sponsorship\s+(?:is\s+)?(?:not\s+available|unavailable|not\s+provided|not\s+offered|not\s+supported)\b[^.!?\n]{0,160}/i,
  /\bwithout\s+(?:requiring\s+)?(?:current\s+or\s+future\s+)?(?:employer\s+|company\s+)?(?:visa\s+|immigration\s+|employment\s+|work\s+authorization\s+|work\s+visa\s+)?sponsorship\b[^.!?\n]{0,160}/i,
  /\b(?:sponsorship|sponsor|visa\s+sponsorship|employment\s+sponsorship|work\s+authorization\s+sponsorship)\b[^.!?\n]{0,120}\b(?:now\s+or\s+in\s+the\s+future|currently\s+or\s+in\s+the\s+future|now\s+or\s+future)\b/i,
  /\b(?:now\s+or\s+in\s+the\s+future|currently\s+or\s+in\s+the\s+future|now\s+or\s+future)\b[^.!?\n]{0,120}\b(?:sponsorship|sponsor|visa\s+sponsorship|employment\s+sponsorship|work\s+authorization\s+sponsorship)\b/i,
  /\bcandidates?\s+(?:who\s+)?(?:require|requires|requiring|need|needs|needing)\s+(?:visa\s+|immigration\s+|employment\s+|work\s+authorization\s+|work\s+visa\s+)?sponsorship\b[^.!?\n]{0,180}\b(?:not\s+eligible|ineligible|will\s+not\s+be\s+considered|cannot\s+be\s+considered|can't\s+be\s+considered|need\s+not\s+apply)\b/i,
  /\b(?:not\s+eligible|ineligible|will\s+not\s+be\s+considered|cannot\s+be\s+considered|can't\s+be\s+considered|need\s+not\s+apply)\b[^.!?\n]{0,180}\b(?:require|requires|requiring|need|needs|needing)\s+(?:visa\s+|immigration\s+|employment\s+|work\s+authorization\s+|work\s+visa\s+)?sponsorship\b/i,
  /\b(?:H-?1B|H1B|H-?1B\s+transfer|TN|E-?3|O-?1|J-?1|F-?1|OPT|CPT|STEM\s+OPT|work\s+visa|visa\s+transfer)\b[^.!?\n]{0,120}\b(?:not\s+accepted|not\s+supported|not\s+eligible|ineligible|not\s+available|not\s+offered|will\s+not\s+be\s+sponsored|cannot\s+be\s+sponsored)\b/i,
  /\b(?:not\s+accepted|not\s+supported|not\s+eligible|ineligible|not\s+available|not\s+offered|will\s+not\s+be\s+sponsored|cannot\s+be\s+sponsored)\b[^.!?\n]{0,120}\b(?:H-?1B|H1B|H-?1B\s+transfer|TN|E-?3|O-?1|J-?1|F-?1|OPT|CPT|STEM\s+OPT|work\s+visa|visa\s+transfer)\b/i,
  /\bno\s+(?:H-?1B|H1B|TN|E-?3|O-?1|J-?1|F-?1|OPT|CPT|STEM\s+OPT|work\s+visa|visa\s+transfers?)\b[^.!?\n]{0,120}/i,
  /\b(?:U\.?S\.?|US|United\s+States)\s+citizenship\s+(?:is\s+)?required\b[^.!?\n]{0,160}/i,
  /\b(?:requires?|requiring)\s+(?:U\.?S\.?|US|United\s+States)\s+citizenship\b[^.!?\n]{0,160}/i,
  /\bmust\s+be\s+(?:a\s+)?(?:U\.?S\.?|US|United\s+States)\s+citizen\b[^.!?\n]{0,160}/i,
  /\b(?:citizens?|green\s+card\s+holders?|lawful\s+permanent\s+residents?|permanent\s+residents?)\s+only\b[^.!?\n]{0,160}/i,
  /\b(?:U\.?S\.?|US|United\s+States)\s+persons?\s+(?:status\s+)?(?:is\s+)?required\b[^.!?\n]{0,160}/i,
  /\b(?:green\s+card|lawful\s+permanent\s+resident|permanent\s+resident)\b[^.!?\n]{0,120}\b(?:required|only|must)\b[^.!?\n]{0,80}/i,
  /\b(?:ITAR|EAR|export[-\s]?control(?:led)?|export\s+compliance)\b[^.!?\n]{0,180}\b(?:U\.?S\.?\s+person|US\s+person|U\.?S\.?\s+citizen|US\s+citizen|permanent\s+resident|green\s+card)\b[^.!?\n]{0,80}/i,
  /\b(?:active\s+)?(?:secret|top\s+secret|TS\/SCI|SCI|public\s+trust|security)\s+clearance\s+(?:is\s+)?required\b[^.!?\n]{0,160}/i,
];

const SPONSORSHIP_AVAILABLE_PATTERNS: RegExp[] = [
  /\b(?:visa|immigration|employment|work(?:\s+authorization)?|work\s+visa|green\s+card)\s+sponsorship\s+(?:is\s+)?(?:available|provided|offered|supported|considered)\b[^.!?\n]{0,160}/i,
  /\bsponsorship\s+(?:is\s+)?(?:available|provided|offered|supported|considered)\b[^.!?\n]{0,160}/i,
  /\b(?:will|can|may|able\s+to)\s+sponsor\b[^.!?\n]{0,140}\b(?:visa|immigration|employment|work\s+authorization|work\s+visa|H-?1B|H1B|TN|green\s+card)\b/i,
  /\b(?:we|company|employer|client)\s+(?:sponsor|sponsors|will\s+sponsor|can\s+sponsor|provides?|offers?|supports?)\b[^.!?\n]{0,140}\b(?:visa|immigration|employment|work\s+authorization|work\s+visa|H-?1B|H1B|TN|green\s+card)\b/i,
  /\b(?:H-?1B|H1B|H-?1B\s+transfer|TN|E-?3|O-?1|L-?1|visa\s+transfer|work\s+visa)\b[^.!?\n]{0,120}\b(?:sponsorship|sponsored|supported|available|accepted|welcome|considered)\b/i,
  /\b(?:sponsor(?:ship)?|support)\s+(?:for\s+)?(?:H-?1B|H1B|TN|E-?3|O-?1|L-?1|OPT|CPT|STEM\s+OPT|visa\s+transfer|work\s+visa)\b[^.!?\n]{0,120}/i,
  /\b(?:OPT|CPT|STEM\s+OPT|F-?1|EAD)\s+(?:candidates?\s+)?(?:are\s+)?(?:welcome|accepted|eligible|considered|supported)\b[^.!?\n]{0,120}/i,
  /\b(?:international\s+students?|international\s+candidates?|international\s+applicants?)\s+(?:are\s+)?(?:welcome|eligible|encouraged|considered)\b[^.!?\n]{0,120}/i,
  /\b(?:green\s+card|permanent\s+residency|immigration)\s+sponsorship\s+(?:is\s+)?(?:available|supported|provided|offered)\b[^.!?\n]{0,120}/i,
  /\bvisa\s+support\s+(?:is\s+)?(?:available|provided|offered|included)\b[^.!?\n]{0,120}/i,
  /\brelocation\s+(?:and|&)\s+visa\s+support\b[^.!?\n]{0,120}/i,
  /\bopen\s+to\s+(?:visa\s+|immigration\s+|employment\s+|work\s+authorization\s+)?sponsorship\b[^.!?\n]{0,120}/i,
  /\b(?:sponsorship|visa\s+sponsorship)\s+may\s+be\s+(?:available|considered)\b[^.!?\n]{0,120}/i,
];

function findSponsorshipEvidence(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return cleanEvidence(match[0]);
  }

  return "";
}

function cleanSponsorshipText(text: string): string {
  return (text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanEvidence(text: string): string {
  return cleanSponsorshipText(text)
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "")
    .slice(0, 240);
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
