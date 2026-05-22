// content.js — executed inside a LinkedIn jobs tab via chrome.scripting.
//
// Strategy: pin every lookup to LinkedIn's visible job-details pane and top
// card. We keep fallbacks scoped to that pane so search result cards, nav text,
// and third-party widgets cannot pollute the extraction.
//
// Supported layouts:
//   - linkedin.com/jobs/view/<id>
//   - linkedin.com/jobs/search/...
//   - linkedin.com/jobs/search-results/?currentJobId=<id>   (list + right pane)
//   - linkedin.com/jobs/collections/...

(() => {
  const cleanText = (s) =>
    (s || "")
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const cleanLines = (s) =>
    (s || "")
      .replace(/ /g, " ")
      .split(/\n+/)
      .map(cleanText)
      .filter(Boolean);

  const detailPane = findDetailPane();
  const topCard = findTopCard(detailPane);

  function pickInside(root, selectors) {
    if (!root) return "";
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) {
        const t = cleanText(el.textContent);
        if (t) return t;
      }
    }
    return "";
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function pickVisible(selectors, root = document) {
    for (const sel of selectors) {
      const matches = Array.from(root.querySelectorAll(sel));
      const found = matches.find(isVisible) || matches[0];
      if (found) return found;
    }
    return null;
  }

  function findDetailPane() {
    return pickVisible([
      ".jobs-search__job-details--container",
      ".jobs-search__job-details",
      ".jobs-details",
      ".jobs-details__main-content",
      ".scaffold-layout__detail",
      ".job-view-layout",
      ".jobs-search-results-list + div",
      "main",
    ]);
  }

  function findTopCard(root) {
    return (
      pickVisible(
        [
          ".job-details-jobs-unified-top-card",
          ".jobs-unified-top-card",
          ".jobs-details-top-card",
          "[class*='job-details-jobs-unified-top-card']",
          "[class*='jobs-unified-top-card']",
        ],
        root || document,
      ) || root
    );
  }

  function panelLines() {
    const topCardLines = cleanLines(topCard?.innerText || topCard?.textContent || "");
    if (topCardLines.length >= 2) return topCardLines;
    return cleanLines(detailPane?.innerText || detailPane?.textContent || "");
  }

  function isLocationLine(line) {
    const first = line.split("·")[0].trim();
    return (
      line.includes("·") &&
      (/,/.test(first) ||
        /\b(remote|hybrid|united states|new york|san francisco)\b/i.test(first))
    );
  }

  function isUiLine(line) {
    return /^(apply|saved|save|remote|hybrid|full-time|part-time|contract|internship|yes|no)$/i.test(
      line,
    );
  }

  function jobIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      const currentJobId = url.searchParams.get("currentJobId");
      if (currentJobId) return currentJobId;
      const match = url.pathname.match(/\/jobs\/view\/(\d+)/);
      return match?.[1] || "";
    } catch (_) {
      return "";
    }
  }

  function isLikelyJobTitle(line) {
    if (!line || isUiLine(line) || isLocationLine(line)) return false;
    if (line.length < 4 || line.length > 140) return false;
    if (/^(people you can reach out to|job match|premium|about the job)$/i.test(line)) {
      return false;
    }
    return /\b(engineer|scientist|manager|specialist|analyst|developer|designer|intern|lead|director|product|data|software|machine learning|ai|ml|consultant|associate|architect)\b/i.test(
      line,
    );
  }

  function titleFromLines(text) {
    return cleanLines(text).find(isLikelyJobTitle) || "";
  }

  function extractTitleFromCurrentJobCard() {
    const id = jobIdFromUrl();
    if (!id) return "";

    const links = Array.from(
      document.querySelectorAll(
        `a[href*="/jobs/view/${id}"], a[href*="currentJobId=${id}"]`,
      ),
    );

    for (const link of links) {
      const directText = titleFromLines(link.innerText || link.textContent || "");
      if (directText) return directText;

      const card = link.closest(
        "[data-job-id], li, .job-card-container, .jobs-search-results__list-item",
      );
      const cardText = titleFromLines(card?.innerText || card?.textContent || "");
      if (cardText) return cardText;
    }

    return "";
  }

  function extractTitle() {
    const titleSelectors = [
      ".job-details-jobs-unified-top-card__job-title h1",
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title h1",
      ".jobs-unified-top-card__job-title",
      ".jobs-details-top-card__job-title h1",
      ".jobs-details-top-card__job-title",
      "h1.t-24",
      "h1",
    ];
    const currentJobCardTitle = extractTitleFromCurrentJobCard();
    if (currentJobCardTitle) return cleanJobTitle(currentJobCardTitle);

    const selectedTitle =
      pickInside(topCard, titleSelectors) || pickInside(detailPane, titleSelectors);
    if (isLikelyJobTitle(selectedTitle)) return cleanJobTitle(selectedTitle);

    const fallbackTitle = panelLines().find(isLikelyJobTitle) || "";

    return cleanJobTitle(fallbackTitle);
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
      .replace(/\b(associate|senior|sr\.?|staff|principal|lead|ii|iii|iv)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    return compactKnownRole(firstSegment) || titleCaseRole(firstSegment || normalized);
  }

  function compactKnownRole(title) {
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

  function extractCompany() {
    const companySelectors = [
      ".job-details-jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name",
      "[class*='company-name'] a",
      "[class*='company-name']",
      "a[href*='/company/']",
    ];
    const selectedCompany =
      pickInside(topCard, companySelectors) ||
      pickInside(detailPane, companySelectors);
    if (selectedCompany) return selectedCompany;

    const title = extractTitle();
    const lines = panelLines();
    const titleIndex = lines.findIndex((line) => line === title);
    const nearby = [
      lines[titleIndex - 1],
      lines[titleIndex + 1],
      lines[0],
    ].filter(Boolean);

    return (
      nearby.find(
        (line) =>
          line !== title &&
          !isUiLine(line) &&
          !isLocationLine(line) &&
          line.length <= 80,
      ) || ""
    );
  }

  function extractLocation() {
    const container = pickVisible(
      [
        ".job-details-jobs-unified-top-card__primary-description-container",
        ".job-details-jobs-unified-top-card__bullet",
        ".jobs-unified-top-card__primary-description",
        ".jobs-unified-top-card__bullet",
        "[class*='primary-description']",
        "[class*='top-card__bullet']",
      ],
      detailPane || topCard || document,
    );

    // The container reads like:
    //   "San Francisco, CA · Reposted 2 hours ago · Over 100 people clicked apply"
    // Take the first segment before the middot.
    const full =
      cleanText(container?.textContent || "") ||
      panelLines().find(isLocationLine) ||
      "";
    const first = cleanText(full.split("·")[0]);
    return first || full;
  }

  function extractDescription() {
    // Only trust official description containers scoped to the details pane.
    const el =
      pickVisible(
        [
          "#job-details",
          ".jobs-description__content .jobs-box__html-content",
          ".jobs-description-content__text",
          ".jobs-description__container",
          ".description__text",
          "[class*='jobs-description']",
        ],
        detailPane || document,
      ) || document.querySelector("#job-details");
    if (!el) return "";
    const t = cleanText(el.innerText || el.textContent || "");
    return t.slice(0, 6000);
  }

  function canonicalJobUrl() {
    try {
      const u = new URL(window.location.href);
      const id = u.searchParams.get("currentJobId");
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    } catch (_) {}
    return window.location.href;
  }

  return {
    jobTitle: extractTitle().slice(0, 200),
    company: extractCompany().slice(0, 200),
    location: extractLocation().slice(0, 200),
    jobUrl: canonicalJobUrl(),
    jobDescription: extractDescription(),
  };
})();
