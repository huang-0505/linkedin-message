// content.js — executed inside a LinkedIn jobs tab via chrome.scripting.
//
// Extract only from the selected job details pane and selected job card.
// If LinkedIn changes a selector, leave the field blank before trusting
// unrelated profile/sidebar text.

(() => {
  function extractJob() {
    const titleEl = findVisibleJobTitleElement();
    const detailsRoot = findDetailsRoot(titleEl);
    const description = extractDescription(detailsRoot || document);
    const selectedCardLines = getSelectedJobCardLines();
    const rawTitle =
      cleanText(titleEl?.textContent || "") ||
      titleFromDocumentTitle() ||
      titleFromDescription(description) ||
      titleFromCardLines(selectedCardLines);
    const jobTitle = cleanJobTitle(rawTitle);
    const headerRoot = findHeaderRoot(titleEl, detailsRoot);
    const headerLines = cleanLines(headerRoot?.innerText || headerRoot?.textContent || "");

    return {
      jobTitle: jobTitle.slice(0, 200),
      company: (
        companyFromHeader(headerRoot, headerLines, rawTitle) ||
        companyFromCardLines(selectedCardLines, rawTitle) ||
        companyFromDescription(description)
      ).slice(0, 200),
      location: (
        locationFromHeader(headerLines, rawTitle) ||
        locationFromCardLines(selectedCardLines, rawTitle) ||
        locationFromDescription(description)
      ).slice(0, 200),
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
        if (isLikelyJobTitle(text)) return el;
      }
    }

    return null;
  }

  function isLikelyJobArea(el, title) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = cleanText(node.innerText || node.textContent || "");
      if (!text.includes(title)) continue;
      if (
        /\b(easy apply|apply|save|promoted by hirer|applicants?|about the job)\b/i.test(text) ||
        node.matches?.(".jobs-details, .job-view-layout, .scaffold-layout__detail")
      ) {
        return true;
      }
    }
    return false;
  }

  function findDetailsRoot(titleEl) {
    const selectors = [
      ".jobs-search__job-details--container",
      ".jobs-search__job-details",
      ".jobs-details",
      ".jobs-details__main-content",
      ".scaffold-layout__detail",
      ".job-view-layout",
      "main",
    ];

    if (titleEl) {
      for (const selector of selectors) {
        const root = titleEl.closest(selector);
        if (root && isVisible(root)) return root;
      }
    }

    for (const selector of selectors) {
      const roots = Array.from(document.querySelectorAll(selector));
      const root = roots.find((candidate) => {
        const text = cleanText(candidate.innerText || candidate.textContent || "");
        return isVisible(candidate) && /\b(easy apply|apply|save|about the job)\b/i.test(text);
      });
      if (root) return root;
    }

    return null;
  }

  function findHeaderRoot(titleEl, detailsRoot) {
    if (!titleEl) return findHeaderRootFromDetails(detailsRoot);

    const title = cleanText(titleEl.textContent || "");
    let best = titleEl.parentElement;
    let node = titleEl.parentElement;

    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      if (!isVisible(node)) continue;
      const text = node.innerText || node.textContent || "";
      const normalized = cleanText(text);
      if (!normalized.includes(title)) continue;
      if (/about the job/i.test(normalized) && normalized.length > 1800) break;

      const lines = cleanLines(text);
      const titleIndex = findTitleLineIndex(lines, title);
      const hasUsefulHeaderInfo =
        lines.some((line) => isLikelyCompanyLine(line, title)) ||
        lines.some((line) => Boolean(locationFromLine(line))) ||
        /\b(easy apply|apply|save|applicants?)\b/i.test(normalized);

      if (lines.length >= 2 && lines.length <= 40 && normalized.length <= 2400 && hasUsefulHeaderInfo) {
        best = node;
      }

      if (titleIndex !== -1 && hasUsefulHeaderInfo && lines.length <= 24) {
        return node;
      }

      if (detailsRoot && node === detailsRoot) break;
    }

    return best;
  }

  function findHeaderRootFromDetails(detailsRoot) {
    if (!detailsRoot) return null;

    const selectors = [
      ".job-details-jobs-unified-top-card",
      ".jobs-unified-top-card",
      ".jobs-details-top-card",
    ];

    for (const selector of selectors) {
      const root = Array.from(detailsRoot.querySelectorAll(selector)).find(isVisible);
      if (root) return root;
    }

    return detailsRoot;
  }

  function companyFromHeader(root, lines, rawTitle) {
    const selectorCompany = companyFromSelectors(root, rawTitle);
    if (selectorCompany) return selectorCompany;

    const anchorCompany = companyFromAnchor(root, rawTitle);
    if (anchorCompany) return anchorCompany;

    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    const candidates = [
      ...lines.slice(Math.max(0, titleIndex - 5), titleIndex).reverse(),
      ...lines.slice(titleIndex + 1, titleIndex + 5),
    ];

    for (const line of candidates) {
      const company = cleanCompanyLine(line, rawTitle);
      if (company) return company;
    }

    return "";
  }

  function companyFromSelectors(root, rawTitle) {
    if (!root) return "";

    const selectors = [
      ".job-details-jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name",
      ".jobs-details-top-card__company-url",
      "a[href*='/company/']",
    ];

    for (const selector of selectors) {
      for (const el of root.querySelectorAll(selector)) {
        if (!isVisible(el)) continue;
        const company = cleanCompanyLine(el.innerText || el.textContent || "", rawTitle);
        if (company) return company;
      }
    }

    return "";
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

  function companyFromCardLines(lines, rawTitle) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 5); index += 1) {
      const company = cleanCompanyLine(lines[index], rawTitle);
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
    if (/\b(employees?|connections?|applicants?|benefits?|premium|open to full-time roles|viewed|easy apply)\b/i.test(text)) {
      return false;
    }
    return /[a-zA-Z]/.test(text);
  }

  function locationFromHeader(lines, rawTitle) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 8); index += 1) {
      const location = locationFromLine(lines[index]);
      if (location) return location;
    }

    return "";
  }

  function locationFromCardLines(lines, rawTitle) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 6); index += 1) {
      const location = locationFromLine(lines[index]);
      if (location) return location;
    }

    return "";
  }

  function locationFromLine(line) {
    const first = cleanText(line).split(/[·•]/)[0].trim();
    if (!first || first.length > 90 || isNoiseLine(first)) return "";
    if (/\b(applicants?|employees?|connections?|promoted by|response insights?|benefits?)\b/i.test(first)) {
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

  function extractDescription(root) {
    const selectors = [
      "#job-details",
      ".jobs-description__content .jobs-box__html-content",
      ".jobs-description-content__text",
      ".jobs-description__container",
      ".jobs-description",
      ".description__text",
      "[class*='jobs-description']",
    ];
    const roots = root && root !== document ? [root, document] : [document];

    for (const currentRoot of roots) {
      for (const selector of selectors) {
        const matches = Array.from(currentRoot.querySelectorAll(selector));
        for (const el of matches) {
          const text = cleanBlockText(el.innerText || el.textContent || "");
          if (isLikelyDescription(text)) return text.slice(0, 6000);
        }
      }

      const sectionText = descriptionFromAboutSection(
        currentRoot.innerText || currentRoot.textContent || "",
      );
      if (sectionText) return sectionText.slice(0, 6000);
    }

    return "";
  }

  function descriptionFromAboutSection(text) {
    const lines = cleanLines(text);
    const aboutIndex = lines.findIndex((line) => /^about the job$/i.test(line));
    if (aboutIndex === -1) return "";

    const collected = [];
    for (const line of lines.slice(aboutIndex + 1)) {
      if (
        /^(people you can reach out to|similar jobs|recommended jobs|jobs you may be interested in|job match|premium)$/i.test(
          line,
        )
      ) {
        break;
      }
      if (/^(show more|show less|report this job)$/i.test(line)) continue;
      collected.push(line);
    }

    const textAfterHeading = cleanBlockText(collected.join("\n"));
    return isLikelyDescription(textAfterHeading) ? textAfterHeading : "";
  }

  function isLikelyDescription(text) {
    const value = cleanText(text);
    if (value.length < 40) return false;
    return !/^(premium|job match|people you can reach out to)/i.test(value);
  }

  function titleFromDocumentTitle() {
    const pageTitle = cleanText(document.title || "").replace(/\s*\|\s*LinkedIn\s*$/i, "");
    const hiring = pageTitle.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+.+$/i);
    if (hiring && cleanText(hiring[2])) return cleanText(hiring[2]);

    const ogTitle = cleanText(
      document.querySelector("meta[property='og:title']")?.getAttribute("content") || "",
    ).replace(/\s*\|\s*LinkedIn\s*$/i, "");
    const ogHiring = ogTitle.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+.+$/i);
    if (ogHiring && cleanText(ogHiring[2])) return cleanText(ogHiring[2]);

    return "";
  }

  function titleFromDescription(description) {
    const explicitTitle = valueAfterLabel(description, "(?:job title|title)").replace(/^["']|["']$/g, "");
    if (isLikelyJobTitle(explicitTitle)) return explicitTitle;

    const patterns = [
      /\b(?:is|are)\s+(?:looking|hiring|searching)\s+for\s+(?:an?|the)?\s+([^.\n;,]+)/i,
      /\bseeking\s+(?:an?|the)?\s+([^.\n;,]+)/i,
      /\b(?:role|position)\s+(?:of|for)\s+(?:an?|the)?\s+([^.\n;,]+)/i,
    ];

    for (const pattern of patterns) {
      const candidate = cleanText(description.match(pattern)?.[1] || "")
        .replace(/^(?:a|an|the)\s+/i, "")
        .trim();
      if (isLikelyJobTitle(candidate)) return candidate;
    }

    return explicitTitle;
  }

  function companyFromDescription(description) {
    return valueAfterLabel(description, "company");
  }

  function locationFromDescription(description) {
    return cleanText(valueAfterLabel(description, "location").split(/[–-]/)[0]);
  }

  function valueAfterLabel(text, labelPattern) {
    const labels =
      "(?:job title|title|company|location|job description|description|requirements?|responsibilities|qualifications)";
    const match = text.match(new RegExp(`\\b${labelPattern}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*${labels}\\s*:|\\b${labels}\\s*:|$)`, "i"));
    return cleanText(match?.[1] || "");
  }

  function getSelectedJobCardLines() {
    const id = jobIdFromUrl();
    const cards = [];

    if (id) {
      const links = Array.from(
        document.querySelectorAll(
          `a[href*="/jobs/view/${id}"], a[href*="currentJobId=${id}"]`,
        ),
      );

      for (const link of links) {
        const card = link.closest(
          "[data-job-id], li, .job-card-container, .jobs-search-results__list-item",
        );
        if (card) cards.push(card);
      }
    }

    cards.push(
      ...document.querySelectorAll(
        [
          "[data-job-id][aria-current='page']",
          "[data-job-id][aria-selected='true']",
          "li[aria-current='page']",
          "li[aria-selected='true']",
          ".job-card-container--clickable[aria-current='page']",
          ".jobs-search-results__list-item--active",
          ".jobs-search-results-list__list-item--active",
          ".scaffold-layout__list-item--active",
          ".job-card-container--active",
        ].join(", "),
      ),
    );

    for (const card of cards) {
      if (!isVisible(card)) continue;
      const text = card.innerText || card.textContent || "";
      const lines = cleanLines(text);
      if (lines.length >= 2 && lines.length <= 25 && !lines.some((line) => /^about the job$/i.test(line))) {
        return lines;
      }
    }

    return [];
  }

  function titleFromCardLines(lines) {
    return lines.find(isLikelyJobTitle) || "";
  }

  function findTitleLineIndex(lines, rawTitle) {
    const title = cleanText(rawTitle);
    if (title) {
      const index = lines.findIndex((line) => {
        const current = cleanText(line);
        return current === title || current.includes(title) || title.includes(current);
      });
      if (index !== -1) return index;
    }

    return lines.findIndex(isLikelyJobTitle);
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

    if (/\bforward\s+deployed\b/.test(text) && /\bai\b/.test(text) && /\bengineer\b/.test(text)) {
      return "Forward Deployed AI Engineer";
    }
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

  function cleanBlockText(text) {
    return cleanLines(text).join("\n").trim();
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
