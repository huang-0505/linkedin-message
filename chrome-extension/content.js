// content.js — executed inside a LinkedIn jobs tab via chrome.scripting.
//
// Keep extraction anchored to the visible selected job header. If a field cannot
// be read from the job header or description, leave it blank instead of pulling
// unrelated profile/sidebar text.

(() => {
  function extractJob() {
    const description = extractDescription();
    const titleEl = findVisibleJobTitleElement();
    const rawTitle =
      cleanText(titleEl?.textContent || "") ||
      titleFromDescription(description) ||
      titleFromSelectedJobCard();
    const jobTitle = cleanJobTitle(rawTitle);
    const headerRoot = findHeaderRoot(titleEl);
    const headerLines = cleanLines(headerRoot?.innerText || headerRoot?.textContent || "");

    return {
      jobTitle: jobTitle.slice(0, 200),
      company: extractCompany(headerRoot, headerLines, rawTitle).slice(0, 200),
      location: extractLocation(headerLines, rawTitle, description).slice(0, 200),
      jobUrl: canonicalJobUrl(),
      jobDescription: description,
    };
  }

  function findVisibleJobTitleElement() {
    const selectors = [
      ".job-details-jobs-unified-top-card__job-title h1",
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title h1",
      ".jobs-unified-top-card__job-title",
      ".jobs-details-top-card__job-title h1",
      ".jobs-details-top-card__job-title",
      "main h1",
      "h1",
    ];
    const seen = new Set();

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el) || !isVisible(el)) continue;
        seen.add(el);

        const text = cleanText(el.textContent || "");
        if (isLikelyJobTitle(text) && isInLikelyJobHeader(el, text)) return el;
      }
    }

    return null;
  }

  function isInLikelyJobHeader(el, title) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const text = cleanText(node.innerText || node.textContent || "");
      if (!text.includes(title)) continue;
      if (/\b(easy apply|apply|save|promoted by hirer|applicants?)\b/i.test(text)) {
        return true;
      }
      if (node.matches?.(".jobs-details, .job-view-layout, .scaffold-layout__detail")) {
        return true;
      }
    }
    return false;
  }

  function findHeaderRoot(titleEl) {
    if (!titleEl) return null;

    const title = cleanText(titleEl.textContent || "");
    let best = titleEl.parentElement;
    let node = titleEl.parentElement;

    for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
      if (!isVisible(node)) continue;

      const text = node.innerText || node.textContent || "";
      const normalized = cleanText(text);
      if (!normalized.includes(title)) continue;
      if (/about the job/i.test(normalized) && normalized.length > 1600) break;

      const lines = cleanLines(text);
      const titleIndex = findTitleLineIndex(lines, title);
      const hasNearbyCompany =
        titleIndex > 0 &&
        lines
          .slice(Math.max(0, titleIndex - 4), titleIndex)
          .some((line) => isLikelyCompanyLine(line, title));
      const hasNearbyLocation =
        titleIndex !== -1 &&
        lines
          .slice(titleIndex + 1, titleIndex + 6)
          .some((line) => Boolean(locationFromLine(line)));

      if (
        lines.length >= 2 &&
        lines.length <= 35 &&
        normalized.length <= 2200 &&
        (hasNearbyCompany || hasNearbyLocation || /\b(easy apply|apply|save)\b/i.test(normalized))
      ) {
        best = node;
      }

      if (hasNearbyCompany && hasNearbyLocation && lines.length <= 20) {
        return node;
      }
    }

    return best;
  }

  function extractCompany(headerRoot, lines, rawTitle) {
    const anchorCompany = companyFromAnchor(headerRoot, rawTitle);
    if (anchorCompany) return anchorCompany;

    const titleIndex = findTitleLineIndex(lines, rawTitle);
    for (let index = titleIndex - 1; index >= Math.max(0, titleIndex - 4); index -= 1) {
      const company = cleanCompanyLine(lines[index], rawTitle);
      if (company) return company;
    }

    return companyFromDescription(extractDescription());
  }

  function companyFromAnchor(root, rawTitle) {
    if (!root) return "";
    const anchors = Array.from(root.querySelectorAll("a[href*='/company/']"));

    for (const anchor of anchors) {
      if (!isVisible(anchor)) continue;
      const company = cleanCompanyLine(anchor.innerText || anchor.textContent || "", rawTitle);
      if (company) return company;
    }

    return "";
  }

  function cleanCompanyLine(line, rawTitle) {
    const parts = cleanLines(line)
      .flatMap((part) => part.split(/[·•]/))
      .map(cleanText)
      .filter(Boolean);

    for (const part of parts) {
      const cleaned = part
        .replace(/\d{2,}\+?\s*employees?.*$/i, "")
        .replace(/\d+\s+connections?.*$/i, "")
        .replace(/\d+\s+company alumni.*$/i, "")
        .trim();

      if (isLikelyCompanyLine(cleaned, rawTitle)) return cleaned;
    }

    return "";
  }

  function isLikelyCompanyLine(line, rawTitle) {
    const text = cleanText(line);
    if (!text || text.length > 90) return false;
    if (rawTitle && cleanText(rawTitle) === text) return false;
    if (isLikelyJobTitle(text) || locationFromLine(text) || isNoiseLine(text)) return false;
    if (/\b(employees?|connections?|applicants?|benefits?|premium|open to full-time roles)\b/i.test(text)) {
      return false;
    }
    return /[a-zA-Z]/.test(text);
  }

  function extractLocation(lines, rawTitle, description) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex !== -1) {
      for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 7); index += 1) {
        const location = locationFromLine(lines[index]);
        if (location) return location;
      }
    }

    return locationFromDescription(description);
  }

  function locationFromLine(line) {
    const first = cleanText(line).split(/[·•]/)[0].trim();
    if (!first || first.length > 90 || isNoiseLine(first)) return "";
    if (/\b(applicants?|employees?|connections?|promoted by|response insights?)\b/i.test(first)) {
      return "";
    }
    if (
      /,/.test(first) ||
      /\b(remote|hybrid|on-site|onsite|united states|canada|greater .* area|area)\b/i.test(first)
    ) {
      return first;
    }
    return "";
  }

  function extractDescription() {
    const selectors = [
      "#job-details",
      ".jobs-description__content .jobs-box__html-content",
      ".jobs-description-content__text",
      ".jobs-description__container",
      ".description__text",
    ];

    for (const selector of selectors) {
      const el = Array.from(document.querySelectorAll(selector)).find(isVisible);
      const text = cleanText(el?.innerText || el?.textContent || "");
      if (text) return text.slice(0, 6000);
    }

    return "";
  }

  function titleFromDescription(description) {
    const match = description.match(/\b(?:job title|title)\s*:\s*([^\n.]+)/i);
    return cleanText(match?.[1] || "");
  }

  function companyFromDescription(description) {
    const match = description.match(/\bcompany\s*:\s*([^\n.]+)/i);
    return cleanText(match?.[1] || "");
  }

  function locationFromDescription(description) {
    const match = description.match(/\blocation\s*:\s*([^\n]+)/i);
    return cleanText((match?.[1] || "").split(/[–-]/)[0]);
  }

  function titleFromSelectedJobCard() {
    const id = jobIdFromUrl();
    if (!id) return "";

    const links = Array.from(
      document.querySelectorAll(
        `a[href*="/jobs/view/${id}"], a[href*="currentJobId=${id}"]`,
      ),
    );

    for (const link of links) {
      const title = cleanLines(link.innerText || link.textContent || "").find(isLikelyJobTitle);
      if (title) return title;
    }

    return "";
  }

  function findTitleLineIndex(lines, rawTitle) {
    const title = cleanText(rawTitle);
    if (!title) return -1;
    return lines.findIndex((line) => cleanText(line) === title || cleanText(line).includes(title));
  }

  function jobIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      const currentJobId = url.searchParams.get("currentJobId");
      if (currentJobId) return currentJobId;
      return url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] || "";
    } catch (_) {
      return "";
    }
  }

  function canonicalJobUrl() {
    const id = jobIdFromUrl();
    if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    return window.location.href.split(/[?#]/)[0];
  }

  function isLikelyJobTitle(line) {
    const text = cleanText(line);
    if (!text || text.length < 2 || text.length > 140 || isNoiseLine(text)) return false;
    return /\b(engineer|scientist|manager|specialist|analyst|developer|designer|intern|lead|director|product|data|software|machine learning|ai|ml|consultant|associate|architect)\b/i.test(
      text,
    );
  }

  function isNoiseLine(line) {
    return /^(apply|easy apply|saved|save|remote|hybrid|on-site|onsite|full-time|part-time|contract|internship|yes|no|premium|about the job|people you can reach out to|job match|show match details|tailor my resume|create cover letter)$/i.test(
      cleanText(line),
    );
  }

  function cleanJobTitle(title) {
    const normalized = cleanText(title)
      .replace(/^selected,\s*/i, "")
      .replace(/\s*\(verified job\)\s*/i, "")
      .replace(/\s+with verification$/i, "")
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .trim();

    const knownRole = compactKnownRole(normalized);
    if (knownRole) return knownRole;

    const firstSegment = normalized
      .split(/[,|/]/)[0]
      .replace(/\b(entry[-\s]?level|new grad|early career|internship|intern)\b/gi, "")
      .replace(/\b(associate|senior|sr\.?|staff|principal|lead|ii|iii|iv|mid[-\s]?level)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    return compactKnownRole(firstSegment) || titleCaseRole(firstSegment || normalized);
  }

  function compactKnownRole(title) {
    const text = title.toLowerCase();

    if (/\bforward\s+deployed\b/.test(text) && /\bengineer\b/.test(text)) {
      return "Forward Deployed Engineer";
    }
    if (/\b(machine learning|ml)\s+engineer\b/.test(text)) {
      return "Machine Learning Engineer";
    }
    if (/\bai\s+engineer\b/.test(text) || /\bartificial intelligence\s+engineer\b/.test(text)) {
      return "AI Engineer";
    }
    if (/\bdata\s+scientist\b/.test(text)) return "Data Scientist";
    if (/\bdata\s+engineer\b/.test(text)) return "Data Engineer";
    if (/\bfull[-\s]?stack\s+engineer\b/.test(text)) return "Full Stack Engineer";
    if (/\bfront[-\s]?end\s+engineer\b/.test(text)) return "Frontend Engineer";
    if (/\bback[-\s]?end\s+engineer\b/.test(text)) return "Backend Engineer";
    if (/\bsoftware\s+engineer\b/.test(text)) return "Software Engineer";
    if (/\bprompt\s+engineer\b/.test(text)) return "Prompt Engineer";
    if (/\bprompt\s+specialist\b/.test(text)) return "Prompt Specialist";
    if (/\bresearch\s+scientist\b/.test(text)) return "Research Scientist";
    if (/\bproduct\s+manager\b/.test(text)) return "Product Manager";
    if (/\bproduct\s+designer\b/.test(text)) return "Product Designer";
    if (/\bsolutions?\s+engineer\b/.test(text)) return "Solutions Engineer";
    if (/\bsupport\s+engineer\b/.test(text)) return "Support Engineer";
    if (/\bdevops\s+engineer\b/.test(text)) return "DevOps Engineer";
    if (/\bmlops\s+engineer\b/.test(text)) return "MLOps Engineer";

    return "";
  }

  function titleCaseRole(title) {
    return title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
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

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cleanText(text) {
    return (text || "")
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanLines(text) {
    return (text || "")
      .replace(/ /g, " ")
      .split(/\n+/)
      .map(cleanText)
      .filter(Boolean);
  }

  return extractJob();
})();
