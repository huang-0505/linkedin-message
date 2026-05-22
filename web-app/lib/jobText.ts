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

function compactKnownRole(title: string): string {
  const t = title.toLowerCase();

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
