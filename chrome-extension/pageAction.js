// pageAction.js — injects first-class buttons into LinkedIn job/profile pages.
//
// This keeps the user in LinkedIn: job pages get "Find referral"; profile
// pages get "Add to referral panel". People search pages are intentionally not
// matched here so the extension only captures a page the user chose.

(() => {
  const REFRESH_KEY = "__LRA_PAGE_ACTION_REFRESH__";
  const BUTTON_ID = "lra-page-action-button";
  const WRAP_ID = "lra-page-action-wrap";
  const STYLE_ID = "lra-page-action-style";
  let lastUrl = "";
  let injectTimer = 0;

  if (typeof window[REFRESH_KEY] === "function") {
    window[REFRESH_KEY]();
    return;
  }

  window[REFRESH_KEY] = () => {
    injectStyles();
    scheduleInject(true);
  };

  injectStyles();
  scheduleInject();
  observePageChanges();

  function observePageChanges() {
    const observer = new MutationObserver(() => scheduleInject());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    window.setInterval(() => {
      if (lastUrl !== window.location.href) scheduleInject(true);
    }, 1000);
  }

  function scheduleInject(force = false) {
    window.clearTimeout(injectTimer);
    injectTimer = window.setTimeout(() => injectButton(force), 250);
  }

  function injectButton(force = false) {
    if (!document.body) {
      scheduleInject(true);
      return;
    }

    const mode = currentMode();
    lastUrl = window.location.href;

    if (!mode) {
      removeButton();
      return;
    }

    const existing = document.getElementById(BUTTON_ID);
    if (existing && existing.dataset.mode === mode && !force) return;

    removeButton();

    const wrap = document.createElement("div");
    wrap.id = WRAP_ID;
    wrap.className = "lra-floating-wrap";

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.dataset.mode = mode;
    button.className = "lra-page-action-button";
    button.textContent = mode === "profile" ? "Add to referral panel" : "Find referral";
    button.addEventListener("click", () => handleClick(button, mode));

    wrap.appendChild(button);
    document.body.appendChild(wrap);
  }

  function removeButton() {
    document.getElementById(WRAP_ID)?.remove();
  }

  function currentMode() {
    try {
      const url = new URL(window.location.href);
      const host = url.hostname.toLowerCase();
      const parts = url.pathname.split("/").filter(Boolean);
      if (!(host === "linkedin.com" || host.endsWith(".linkedin.com"))) return "";
      if (parts[0] === "jobs") return "job";
      if (parts[0] === "in" && parts[1]) return "profile";
      return "";
    } catch (_) {
      return "";
    }
  }

  async function handleClick(button, mode) {
    const originalText = button.textContent;
    setButtonState(button, mode === "profile" ? "Adding..." : "Opening...");

    try {
      const message =
        mode === "profile"
          ? { type: "LRA_ADD_PROFILE", contact: extractProfile() }
          : { type: "LRA_OPEN_CURRENT_JOB" };

      const response = await chrome.runtime.sendMessage(message);
      if (!response?.ok) {
        throw new Error(response?.error || "Extension action failed.");
      }

      setButtonState(button, mode === "profile" ? "Added ✓" : "Opened ✓");
      window.setTimeout(() => setButtonState(button, originalText), 1800);
    } catch (error) {
      console.error(error);
      setButtonState(button, "Try again");
      button.title = error?.message || String(error);
      window.setTimeout(() => setButtonState(button, originalText), 2500);
    }
  }

  function setButtonState(button, text) {
    button.textContent = text;
  }

  function extractJob() {
    return extractJobFromVisibleHeader();
  }

  function extractJobFromVisibleHeader() {
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

      return companyFromDescription(description);
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

    function extractLocation(lines, rawTitle, jobDescription) {
      const titleIndex = findTitleLineIndex(lines, rawTitle);
      if (titleIndex !== -1) {
        for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 7); index += 1) {
          const location = locationFromLine(lines[index]);
          if (location) return location;
        }
      }

      return locationFromDescription(jobDescription);
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

    function titleFromDescription(jobDescription) {
      const match = jobDescription.match(/\b(?:job title|title)\s*:\s*([^\n.]+)/i);
      return cleanText(match?.[1] || "");
    }

    function companyFromDescription(jobDescription) {
      const match = jobDescription.match(/\bcompany\s*:\s*([^\n.]+)/i);
      return cleanText(match?.[1] || "");
    }

    function locationFromDescription(jobDescription) {
      const match = jobDescription.match(/\blocation\s*:\s*([^\n]+)/i);
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
  }

  function extractProfile() {
    const name = cleanText(
      pick([
        "main h1",
        ".pv-top-card h1",
        ".ph5 h1",
        ".mt2 h1",
        ".artdeco-card h1",
        "[data-generated-suggestion-target] h1",
        ".text-heading-xlarge",
        ".pv-text-details__left-panel h1",
        "h1",
      ]) ||
        nameFromTitle() ||
        nameFromSlug(),
    );

    const headline =
      pick([
        ".pv-top-card .text-body-medium",
        ".ph5 .text-body-medium",
        ".mt2 .text-body-medium",
        ".pv-text-details__left-panel .text-body-medium",
        ".text-body-medium.break-words",
        "main [class*='headline']",
      ]) || pickMeta(["meta[property='og:description']", "meta[name='description']"]);

    const location = pick([
      ".pv-top-card .text-body-small.inline",
      ".ph5 .text-body-small.inline",
      ".mt2 .text-body-small.inline",
      ".pv-text-details__left-panel .text-body-small.inline",
      ".text-body-small.inline",
      "main [class*='location']",
    ]);

    const activityText = pick([
      "section[id*='activity']",
      "[data-view-name*='profile-activity']",
      "main [class*='activity']",
    ]);

    return {
      name: name.slice(0, 120),
      headline: headline.slice(0, 220),
      location: location.slice(0, 120),
      connectionDegree: connectionDegreeFromTopCard().slice(0, 20),
      activityText: activityText.slice(0, 500),
      profileUrl: canonicalProfileUrl(),
    };
  }

  function pick(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = cleanText(el?.textContent || "");
      if (text) return text;
    }
    return "";
  }

  function pickMeta(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = cleanText(el?.getAttribute("content") || "");
      if (text) return text;
    }
    return "";
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

  function canonicalJobUrl() {
    try {
      const url = new URL(window.location.href);
      const id = url.searchParams.get("currentJobId");
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    } catch (_) {}
    return window.location.href.split(/[?#]/)[0];
  }

  function profileSlug() {
    try {
      const url = new URL(window.location.href);
      const parts = url.pathname.split("/").filter(Boolean);
      const inIndex = parts.indexOf("in");
      return inIndex !== -1 ? parts[inIndex + 1] || "" : "";
    } catch (_) {
      return "";
    }
  }

  function nameFromTitle() {
    const rawTitle =
      pickMeta(["meta[property='og:title']", "meta[name='twitter:title']"]) ||
      cleanText(document.title || "");
    return rawTitle
      .replace(/\s*\|\s*LinkedIn.*$/i, "")
      .replace(/\s*-\s*LinkedIn.*$/i, "")
      .trim();
  }

  function nameFromSlug() {
    return profileSlug()
      .split("-")
      .filter((part) => !/^\d+$/.test(part))
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
      .trim();
  }

  function canonicalProfileUrl() {
    const slug = profileSlug();
    return slug
      ? `https://www.linkedin.com/in/${slug}/`
      : window.location.href.split(/[?#]/)[0];
  }

  function topCardText() {
    return cleanText(
      pick([
        ".pv-top-card",
        ".ph5",
        ".mt2",
        ".pv-text-details__left-panel",
        "main",
      ]),
    );
  }

  function connectionDegreeFromTopCard() {
    const match = topCardText().match(/\b(1st|2nd|3rd\+?|3rd)\b/i);
    return match ? match[1] : "";
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${WRAP_ID}.lra-floating-wrap {
        bottom: 96px;
        display: flex;
        position: fixed;
        right: 24px;
        z-index: 2147483647;
        opacity: 1 !important;
        pointer-events: none;
        visibility: visible !important;
      }

      #${BUTTON_ID}.lra-page-action-button {
        appearance: none;
        align-items: center;
        background: #0a66c2;
        border: 1px solid #0a66c2;
        border-radius: 999px;
        color: #fff;
        cursor: pointer;
        display: inline-flex;
        font-family: inherit;
        font-size: 16px;
        font-weight: 600;
        justify-content: center;
        line-height: 20px;
        min-height: 40px;
        padding: 8px 18px;
        pointer-events: auto;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
        white-space: nowrap;
      }

      #${BUTTON_ID}.lra-page-action-button:hover {
        background: #004182;
        border-color: #004182;
      }

      @media (max-width: 760px) {
        #${WRAP_ID}.lra-floating-wrap {
          bottom: 84px;
          right: 12px;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
})();
