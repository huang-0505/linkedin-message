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
          : { type: "LRA_OPEN_JOB", job: extractJob() };

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
    const detailPane = findDetailPane();
    const topCard = findTopCard(detailPane);

    function pickInside(root, selectors) {
      if (!root) return "";
      for (const selector of selectors) {
        const el = root.querySelector(selector);
        const text = cleanText(el?.textContent || "");
        if (text) return text;
      }
      return "";
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
    const rawTitle =
      pickInside(topCard, titleSelectors) || pickInside(detailPane, titleSelectors);
    const fallbackTitle =
      currentJobCardTitle ||
      (isLikelyJobTitle(rawTitle) ? rawTitle : "") ||
      panelLines().find(isLikelyJobTitle) ||
      "";
    const jobTitle = cleanJobTitle(fallbackTitle);

    const companySelectors = [
      ".job-details-jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name",
      "[class*='company-name'] a",
      "[class*='company-name']",
      "a[href*='/company/']",
    ];
    const company =
      pickInside(topCard, companySelectors) || pickInside(detailPane, companySelectors);

    const locationContainer = pickVisible(
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
    const locationText =
      cleanText(locationContainer?.textContent || "") ||
      panelLines().find(isLocationLine) ||
      "";
    const location = cleanText(locationText.split("·")[0]) || locationText;

    const descriptionEl =
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

    return {
      jobTitle: jobTitle.slice(0, 200),
      company: company.slice(0, 200),
      location: location.slice(0, 200),
      jobUrl: canonicalJobUrl(),
      jobDescription: cleanText(descriptionEl?.innerText || descriptionEl?.textContent || "").slice(0, 6000),
    };
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

  function pickVisible(selectors, root = document) {
    for (const selector of selectors) {
      const matches = Array.from(root.querySelectorAll(selector));
      const found = matches.find(isVisible) || matches[0];
      if (found) return found;
    }
    return null;
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
