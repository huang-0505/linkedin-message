// pageAction.js — injects first-class buttons into LinkedIn job/profile pages.
//
// This keeps the user in LinkedIn: job pages get "Find referral"; profile
// pages get "Add to referral panel". People search pages get row-level connect
// helpers and modal note filling. The extension still does not scrape results
// or click final Send.

(() => {
  const REFRESH_KEY = "__LRA_PAGE_ACTION_REFRESH__";
  const BUTTON_ID = "lra-page-action-button";
  const WRAP_ID = "lra-page-action-wrap";
  const STYLE_ID = "lra-page-action-style";
  const ROW_HELPER_CLASS = "lra-row-connect-helper";
  const MODAL_HELPER_ID = "lra-modal-note-helper";
  const ACTIVE_OUTREACH_CONTEXT_KEY = "lra:active-outreach-context";
  let lastUrl = "";
  let injectTimer = 0;
  let activeRecipientName = "";
  let activeRecipientNameSavedAt = 0;

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

    injectConnectModalHelper();

    if (mode === "search") {
      removeButton();
      injectSearchResultHelpers();
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
    button.textContent = labelForMode(mode);
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
      if (parts[0] === "search" && parts[1] === "results" && parts[2] === "people") {
        return "search";
      }
      return "";
    } catch (_) {
      return "";
    }
  }

  async function handleClick(button, mode) {
    const originalText = button.textContent;
    setButtonState(button, pendingLabelForMode(mode));

    try {
      if (mode === "search") {
        await copyActiveOutreachNote();
        setButtonState(button, "Note copied ✓");
        window.setTimeout(() => setButtonState(button, originalText), 1800);
        return;
      }

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
      setButtonState(button, shortErrorText(error));
      button.title = error?.message || String(error);
      window.setTimeout(() => setButtonState(button, originalText), 2500);
    }
  }

  function labelForMode(mode) {
    if (mode === "profile") return "Add to referral panel";
    if (mode === "search") return "Copy outreach note";
    return "Find referral";
  }

  function pendingLabelForMode(mode) {
    if (mode === "profile") return "Adding...";
    if (mode === "search") return "Copying...";
    return "Opening...";
  }

  function setButtonState(button, text) {
    button.textContent = text;
  }

  function shortErrorText(error) {
    const text = error?.message || String(error);
    if (/missing outreach note/i.test(text)) return "Open from app first";
    if (/couldn'?t read|couldn'?t find/i.test(text)) return "Select job first";
    if (/extension context/i.test(text)) return "Reload extension";
    return "Try again";
  }

  async function copyActiveOutreachNote() {
    const result = await chrome.storage.local.get("lra:active-outreach-context");
    const note = result?.["lra:active-outreach-context"]?.connectionMessage || "";
    if (!note.trim()) throw new Error("Missing outreach note.");
    await copyTextToClipboard(note);
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (_) {
      // Fall back below.
    }

    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    const didCopy = document.execCommand("copy");
    document.body.removeChild(textArea);
    if (!didCopy) throw new Error("Copy failed.");
  }

  function injectSearchResultHelpers() {
    for (const row of searchResultRows().slice(0, 40)) {
      if (row.querySelector(`.${ROW_HELPER_CLASS}`)) continue;

      const actionButton = findRowActionButton(row);
      if (!actionButton?.parentElement) continue;

      const helper = document.createElement("button");
      helper.type = "button";
      helper.className = ROW_HELPER_CLASS;
      helper.textContent = "Connect + note";
      helper.title =
        "Open LinkedIn's connect modal for this row, then use your referral note.";
      helper.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleRowConnectClick(row, helper);
      });

      actionButton.parentElement.insertBefore(helper, actionButton);
    }
  }

  function searchResultRows() {
    const rows = [];
    const seen = new Set();
    const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));

    for (const link of links) {
      const row = link.closest(
        [
          "[data-view-name='search-entity-result-universal-template']",
          ".reusable-search__result-container",
          ".entity-result",
          "li",
        ].join(", "),
      );

      if (!row || seen.has(row) || !isVisible(row)) continue;
      if (!findRowActionButton(row)) continue;

      seen.add(row);
      rows.push(row);
    }

    return rows;
  }

  function findRowActionButton(row) {
    return (
      findButtonByText(row, /^(message|connect|follow)$/i) ||
      findButtonByText(row, /\b(message|connect|follow)\b/i)
    );
  }

  function extractPersonNameFromRow(row) {
    const profileLinks = Array.from(row.querySelectorAll('a[href*="/in/"]'));

    for (const link of profileLinks) {
      if (!isVisible(link)) continue;
      const name = cleanPersonName(link.innerText || link.textContent || "");
      if (name) return name;
    }

    return "";
  }

  async function handleRowConnectClick(row, helper) {
    const originalText = helper.textContent;
    helper.disabled = true;
    helper.textContent = "Opening...";

    try {
      const context = await activeOutreachContext();
      if (!context?.connectionMessage?.trim()) {
        throw new Error("Missing outreach note.");
      }

      activeRecipientName = extractPersonNameFromRow(row);
      activeRecipientNameSavedAt = Date.now();
      const opened = await tryOpenNativeConnect(row);
      if (!opened) throw new Error("No connect action.");

      const dialog = await waitForConnectModal();
      if (!dialog) throw new Error("No connect modal.");

      const modalHelper = injectConnectModalHelper(dialog);
      const filled = await fillConnectModalNote(dialog, modalHelper);
      helper.textContent = filled ? "Note filled" : "Modal ready";
    } catch (error) {
      helper.textContent = rowHelperErrorText(error);
      helper.title = error?.message || String(error);
    } finally {
      window.setTimeout(() => {
        helper.disabled = false;
        helper.textContent = originalText;
      }, 2200);
    }
  }

  async function tryOpenNativeConnect(row) {
    const directConnect = findButtonByText(row, /\bconnect\b/i);
    if (directConnect && !directConnect.classList.contains(ROW_HELPER_CLASS)) {
      clickElement(directConnect);
      return true;
    }

    const moreButton = findMoreButton(row);
    if (!moreButton) return false;

    clickElement(moreButton);

    const menuConnect = await waitForMenuAction(/\bconnect\b/i);
    if (!menuConnect) return false;

    clickElement(menuConnect);
    return true;
  }

  function findMoreButton(row) {
    return (
      findButtonByText(row, /^more$/i) ||
      Array.from(row.querySelectorAll("button, a[role='button']")).find((button) => {
        const label = button.getAttribute("aria-label") || "";
        return isVisible(button) && /\bmore\b/i.test(label);
      })
    );
  }

  function findButtonByText(root, pattern) {
    const buttons = Array.from(root.querySelectorAll("button, a[role='button']"));
    return buttons.find((button) => {
      if (!isVisible(button)) return false;
      if (button.classList.contains(ROW_HELPER_CLASS)) return false;
      return pattern.test(buttonLabel(button));
    });
  }

  function buttonLabel(button) {
    return cleanText(
      [
        button.innerText || button.textContent || "",
        button.getAttribute("aria-label") || "",
        button.getAttribute("title") || "",
      ].join(" "),
    );
  }

  async function waitForMenuAction(pattern, timeoutMs = 1600) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const actions = Array.from(
        document.querySelectorAll("[role='menuitem'], button, a[role='button']"),
      );
      const match = actions.find(
        (action) =>
          isVisible(action) &&
          !action.classList.contains(ROW_HELPER_CLASS) &&
          pattern.test(buttonLabel(action)),
      );
      if (match) return match;
      await sleep(100);
    }

    return null;
  }

  async function waitForConnectModal(timeoutMs = 3000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const dialog = findConnectDialog();
      if (dialog) return dialog;
      await sleep(120);
    }

    return null;
  }

  function injectConnectModalHelper(dialog = findConnectDialog()) {
    if (!dialog) return null;

    const existing = dialog.querySelector(`#${MODAL_HELPER_ID}`);
    if (existing) return existing;

    const helper = document.createElement("button");
    helper.id = MODAL_HELPER_ID;
    helper.type = "button";
    helper.className = "lra-modal-note-helper";
    helper.textContent = "Use referral note";
    helper.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      fillConnectModalNote(dialog, helper);
    });

    const addNoteButton = findAddNoteButton(dialog);
    const footer =
      dialog.querySelector(".artdeco-modal__footer") ||
      addNoteButton?.parentElement ||
      dialog.querySelector("[data-test-modal-footer]") ||
      dialog;

    footer.insertBefore(helper, footer.firstChild);
    return helper;
  }

  function findConnectDialog() {
    const dialogs = Array.from(
      document.querySelectorAll("[role='dialog'], .artdeco-modal"),
    );

    return dialogs.find((dialog) => {
      if (!isVisible(dialog)) return false;
      const text = cleanText(dialog.innerText || dialog.textContent || "");
      return /\b(add a note|send invitation|invitation)\b/i.test(text);
    });
  }

  function extractPersonNameFromDialog(dialog) {
    const text = cleanText(dialog.innerText || dialog.textContent || "");
    const match = text.match(/\b(?:invite|invitation to|connect with)\s+([^,.\n]+?)(?:\s+to\b|$)/i);
    return cleanPersonName(match?.[1] || "");
  }

  function personalizeConnectionNote(note, recipientName) {
    const text = cleanText(note);
    const firstName = firstNameForGreeting(recipientName);
    if (!text || !firstName) return text;

    if (/^hi\s*,/i.test(text)) {
      return text.replace(/^hi\s*,/i, `Hi ${firstName},`);
    }

    if (/^hello\s*,/i.test(text)) {
      return text.replace(/^hello\s*,/i, `Hi ${firstName},`);
    }

    if (/^hi\s+[^,]{1,40},/i.test(text)) {
      return text.replace(/^hi\s+[^,]{1,40},/i, `Hi ${firstName},`);
    }

    return `Hi ${firstName}, ${text}`;
  }

  function firstNameForGreeting(name) {
    const first = cleanPersonName(name).split(/\s+/)[0] || "";
    if (!first) return "";
    if (first === first.toLowerCase()) {
      return first.charAt(0).toUpperCase() + first.slice(1);
    }
    return first;
  }

  function recentActiveRecipientName() {
    if (!activeRecipientName) return "";
    if (Date.now() - activeRecipientNameSavedAt > 60000) return "";
    return activeRecipientName;
  }

  function cleanPersonName(value) {
    return cleanText(value)
      .replace(/\b(?:view|open)\s+.+?\s+profile\b/gi, "")
      .replace(/\b(?:1st|2nd|3rd\+?|3rd)\b/gi, "")
      .replace(/\b(?:connect|message|follow|more)\b/gi, "")
      .replace(/[•·|].*$/g, "")
      .replace(/[^\p{L}\p{M}\s.'-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function fillConnectModalNote(dialog, helper) {
    if (!helper) return false;

    const originalText = helper.textContent;
    helper.disabled = true;
    helper.textContent = "Filling...";

    try {
      const context = await activeOutreachContext();
      const note = personalizeConnectionNote(
        context?.connectionMessage || "",
        recentActiveRecipientName() || extractPersonNameFromDialog(dialog),
      )
        .trim()
        .slice(0, 300);
      if (!note) throw new Error("Missing outreach note.");

      let field = findNoteTextField(dialog);
      if (!field) {
        const addNoteButton = findAddNoteButton(dialog);
        if (addNoteButton) clickElement(addNoteButton);
        field = await waitForNoteTextField(dialog);
      }

      if (!field) throw new Error("No note field.");

      fillTextField(field, note);
      helper.textContent = "Note filled";
      return true;
    } catch (error) {
      helper.textContent = modalHelperErrorText(error);
      helper.title = error?.message || String(error);
      return false;
    } finally {
      window.setTimeout(() => {
        helper.disabled = false;
        helper.textContent = originalText;
      }, 1800);
    }
  }

  function findAddNoteButton(dialog) {
    return findButtonByText(dialog, /\badd a note\b/i);
  }

  function findNoteTextField(dialog) {
    const fields = Array.from(
      dialog.querySelectorAll("textarea, [contenteditable='true'], input[type='text']"),
    );
    return fields.find(isVisible) || null;
  }

  async function waitForNoteTextField(dialog, timeoutMs = 1800) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const field = findNoteTextField(dialog);
      if (field) return field;
      await sleep(100);
    }

    return null;
  }

  function fillTextField(field, text) {
    if (field.isContentEditable || field.matches("[contenteditable='true']")) {
      field.focus();
      field.textContent = text;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }

    const prototype =
      field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    field.focus();
    if (setter) {
      setter.call(field, text);
    } else {
      field.value = text;
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function activeOutreachContext() {
    const result = await chrome.storage.local.get(ACTIVE_OUTREACH_CONTEXT_KEY);
    return result?.[ACTIVE_OUTREACH_CONTEXT_KEY] || null;
  }

  function clickElement(element) {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.click();
  }

  function rowHelperErrorText(error) {
    const text = error?.message || String(error);
    if (/missing outreach note/i.test(text)) return "Open from app";
    if (/no connect action/i.test(text)) return "No connect";
    if (/no connect modal/i.test(text)) return "No modal";
    return "Try again";
  }

  function modalHelperErrorText(error) {
    const text = error?.message || String(error);
    if (/missing outreach note/i.test(text)) return "Open from app";
    if (/no note field/i.test(text)) return "Click Add note";
    return "Try again";
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function extractJob() {
    return extractJobFallback();
  }

  function extractJobFallback() {
    const titleEl = findVisibleJobTitleElement();
    const rawTitle =
      cleanText(titleEl?.textContent || "") ||
      titleFromPageMetadata() ||
      titleFromCardLines(getSelectedJobCardLines()) ||
      titleFromDescription(extractDescription(findDetailsRoot(titleEl) || document));
    const detailsRoot = findDetailsRoot(titleEl) || document;
    const headerRoot = findHeaderRootFallback(titleEl, detailsRoot);
    const headerLines = cleanLines(headerRoot?.innerText || headerRoot?.textContent || "");
    const selectedCardLines = getSelectedJobCardLines();
    const description = extractDescription(detailsRoot);
    const sponsorship = analyzeSponsorship(description);

    return {
      jobTitle: cleanJobTitle(rawTitle).slice(0, 200),
      company: (
        companyFromHeaderLines(headerLines, rawTitle) ||
        companyFromCardLines(selectedCardLines, rawTitle) ||
        companyFromDescription(description)
      ).slice(0, 200),
      location: (
        locationFromHeaderLines(headerLines, rawTitle) ||
        locationFromCardLines(selectedCardLines, rawTitle) ||
        locationFromDescription(description)
      ).slice(0, 200),
      jobUrl: canonicalJobUrl(),
      jobDescription: description,
      sponsorshipStatus: sponsorship.status,
      sponsorshipEvidence: sponsorship.evidence,
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

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        const text = cleanText(el.textContent || "");
        if (isVisible(el) && isLikelyJobTitleText(text)) return el;
      }
    }

    return null;
  }

  function findDetailsRoot(titleEl) {
    if (!titleEl) return null;
    const selectors = [
      ".jobs-search__job-details--container",
      ".jobs-search__job-details",
      ".jobs-details",
      ".jobs-details__main-content",
      ".scaffold-layout__detail",
      ".job-view-layout",
      "main",
    ];

    for (const selector of selectors) {
      const root = titleEl.closest(selector);
      if (root && isVisible(root)) return root;
    }

    return null;
  }

  function findHeaderRootFallback(titleEl, detailsRoot) {
    if (!titleEl) return null;

    const title = cleanText(titleEl.textContent || "");
    let best = titleEl.parentElement;
    let node = titleEl.parentElement;

    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = node.innerText || node.textContent || "";
      const lines = cleanLines(text);
      const normalized = cleanText(text);
      if (!normalized.includes(title)) continue;
      if (/about the job/i.test(normalized) && normalized.length > 1800) break;
      if (lines.length >= 2 && lines.length <= 40) best = node;
      if (/\b(easy apply|apply|save|applicants?)\b/i.test(normalized) && lines.length <= 28) {
        return node;
      }
      if (detailsRoot && node === detailsRoot) break;
    }

    return best;
  }

  function companyFromHeaderLines(lines, rawTitle) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    const candidates = [
      ...lines.slice(Math.max(0, titleIndex - 5), titleIndex).reverse(),
      ...lines.slice(titleIndex + 1, titleIndex + 5),
    ];
    for (const line of candidates) {
      const company = cleanCompanyLineFallback(line, rawTitle);
      if (company) return company;
    }

    return "";
  }

  function companyFromCardLines(lines, rawTitle) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 5); index += 1) {
      const company = cleanCompanyLineFallback(lines[index], rawTitle);
      if (company) return company;
    }

    return "";
  }

  function cleanCompanyLineFallback(line, rawTitle) {
    const candidates = cleanLines(line)
      .flatMap((part) => part.split(/[·•]/))
      .map(cleanText)
      .filter(Boolean);

    for (const candidate of candidates) {
      const text = candidate
        .replace(/\d{2,}\+?\s*employees?.*$/i, "")
        .replace(/\d+\s+connections?.*$/i, "")
        .replace(/\d+\s+company alumni.*$/i, "")
        .trim();
      if (!text || text.length > 90) continue;
      if (rawTitle && cleanText(rawTitle) === text) continue;
      if (isLikelyJobTitleText(text) || locationFromLineFallback(text)) continue;
      if (/\b(employees?|connections?|applicants?|benefits?|premium|viewed|easy apply|open to full-time roles)\b/i.test(text)) continue;
      return text;
    }

    return "";
  }

  function locationFromHeaderLines(lines, rawTitle) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 8); index += 1) {
      const location = locationFromLineFallback(lines[index]);
      if (location) return location;
    }

    return "";
  }

  function locationFromCardLines(lines, rawTitle) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 6); index += 1) {
      const location = locationFromLineFallback(lines[index]);
      if (location) return location;
    }

    return "";
  }

  function locationFromLineFallback(line) {
    const first = cleanText(line).split(/[·•]/)[0].trim();
    if (!first || first.length > 90) return "";
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
        for (const el of currentRoot.querySelectorAll(selector)) {
          const text = cleanBlockText(el.innerText || el.textContent || "");
          if (isLikelyDescription(text)) return text.slice(0, 6000);
        }
      }

      const aboutText = descriptionFromAboutSection(
        currentRoot.innerText || currentRoot.textContent || "",
      );
      if (aboutText) return aboutText.slice(0, 6000);
    }

    return "";
  }

  function descriptionFromAboutSection(text) {
    const lines = cleanLines(text);
    const aboutIndex = lines.findIndex((line) => /^about the job$/i.test(line));
    if (aboutIndex === -1) return "";

    const collected = [];
    for (const line of lines.slice(aboutIndex + 1)) {
      if (/^(people you can reach out to|similar jobs|recommended jobs|job match|premium)$/i.test(line)) break;
      if (/^(show more|show less|report this job)$/i.test(line)) continue;
      collected.push(line);
    }

    const description = cleanBlockText(collected.join("\n"));
    return isLikelyDescription(description) ? description : "";
  }

  function isLikelyDescription(text) {
    const value = cleanText(text);
    return value.length >= 40 && !/^(premium|job match|people you can reach out to)/i.test(value);
  }

  function analyzeSponsorship(text) {
    const normalized = cleanSponsorshipText(text);
    if (!normalized) return { status: "unknown", evidence: "" };

    const noEvidence = findSponsorshipEvidence(normalized, NO_SPONSORSHIP_PATTERNS);
    if (noEvidence) return { status: "no_sponsorship", evidence: noEvidence };

    const yesEvidence = findSponsorshipEvidence(normalized, SPONSORSHIP_AVAILABLE_PATTERNS);
    if (yesEvidence) return { status: "sponsors", evidence: yesEvidence };

    return { status: "unknown", evidence: "" };
  }

  const NO_SPONSORSHIP_PATTERNS = [
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

  const SPONSORSHIP_AVAILABLE_PATTERNS = [
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

  function findSponsorshipEvidence(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[0]) return cleanEvidence(match[0]);
    }

    return "";
  }

  function cleanSponsorshipText(text) {
    return (text || "")
      .replace(/ /g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanEvidence(text) {
    return cleanSponsorshipText(text)
      .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "")
      .slice(0, 240);
  }

  function titleFromPageMetadata() {
    const titleSources = [
      document.title,
      metaContent("meta[property='og:title']"),
      metaContent("meta[name='twitter:title']"),
    ];

    for (const source of titleSources) {
      const title = titleFromLinkedInTitle(source);
      if (title) return title;
    }

    const descriptionSources = [
      metaContent("meta[name='description']"),
      metaContent("meta[property='og:description']"),
      metaContent("meta[name='twitter:description']"),
    ];

    for (const source of descriptionSources) {
      const title = titleFromRoleSentence(source);
      if (title) return title;
    }

    const canonicalLink = document.querySelector("link[rel='canonical']");
    const urlSources = [
      canonicalLink?.href || canonicalLink?.getAttribute("href") || "",
      metaContent("meta[property='og:url']"),
      window.location.href,
    ];

    for (const source of urlSources) {
      const title = titleFromUrlSlug(source);
      if (title) return title;
    }

    return "";
  }

  function metaContent(selector) {
    return cleanText(document.querySelector(selector)?.getAttribute("content") || "");
  }

  function titleFromLinkedInTitle(title) {
    const value = cleanText(title)
      .replace(/\s*\|\s*LinkedIn.*$/i, "")
      .replace(/\s*-\s*LinkedIn.*$/i, "")
      .trim();
    if (!value || /^linkedin$/i.test(value)) return "";

    const hiring = value.match(/^.+?\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
    if (isMetadataJobTitle(hiring?.[1] || "")) return cleanText(hiring[1]);

    const atCompany = value.match(/^(.+?)\s+at\s+.+$/i);
    if (isMetadataJobTitle(atCompany?.[1] || "")) return cleanText(atCompany[1]);

    const dash = value.match(/^(.+?)\s+[-–]\s+.+$/);
    if (isLikelyJobTitleText(dash?.[1] || "")) return cleanText(dash[1]);

    return isLikelyJobTitleText(value) ? value : "";
  }

  function titleFromRoleSentence(text) {
    const value = cleanText(text);
    if (!value) return "";

    const patterns = [
      /\bas\s+(?:an?|the)?\s+([^,.;\n]+?)(?:,|\syou\b|\swill\b)/i,
      /\b(?:is|are)\s+(?:looking|hiring|searching)\s+for\s+(?:an?|the)?\s+([^.\n;,]+)/i,
      /\bseeking\s+(?:an?|the)?\s+([^.\n;,]+)/i,
      /\b(?:role|position)\s+(?:of|for)\s+(?:an?|the)?\s+([^.\n;,]+)/i,
    ];

    for (const pattern of patterns) {
      const candidate = cleanText(value.match(pattern)?.[1] || "")
        .replace(/^(?:a|an|the)\s+/i, "")
        .trim();
      if (isLikelyJobTitleText(candidate)) return candidate;
    }

    return "";
  }

  function titleFromUrlSlug(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      const slug = decodeURIComponent(
        url.pathname.match(/\/jobs\/view\/([^/?#]+)/i)?.[1] || "",
      )
        .replace(/\/$/, "")
        .replace(/-\d+$/, "");

      if (!slug || /^\d+$/.test(slug)) return "";

      const atIndex = slug.lastIndexOf("-at-");
      const titleSlug = atIndex > 0 ? slug.slice(0, atIndex) : slug;
      const title = titleSlug.replace(/-/g, " ");
      return isMetadataJobTitle(title) ? title : "";
    } catch (_) {
      return "";
    }
  }

  function isMetadataJobTitle(title) {
    const text = cleanText(title);
    return Boolean(
      text &&
        text.length >= 2 &&
        text.length <= 140 &&
        /[a-zA-Z]/.test(text) &&
        !/^(apply|easy apply|save|saved|remote|hybrid|on-site|full-time|premium|about the job|linkedin)$/i.test(text),
    );
  }

  function titleFromDescription(description) {
    return (
      valueAfterLabel(description, "(?:job title|title)").replace(/^['\"]|['\"]$/g, "") ||
      titleFromRoleSentence(description)
    );
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
    const match = text.match(
      new RegExp(`\\b${labelPattern}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*${labels}\\s*:|\\b${labels}\\s*:|$)`, "i"),
    );
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
        ".job-card-container--clickable[aria-current='page'], .jobs-search-results__list-item--active, .job-card-container--active",
      ),
    );

    for (const card of cards) {
      if (!isVisible(card)) continue;
      const lines = cleanLines(card.innerText || card.textContent || "");
      if (lines.length >= 2 && lines.length <= 25 && !lines.some((line) => /^about the job$/i.test(line))) {
        return lines;
      }
    }

    return [];
  }

  function titleFromCardLines(lines) {
    return lines.find(isLikelyJobTitleText) || "";
  }

  function findTitleLineIndex(lines, rawTitle) {
    const title = cleanText(rawTitle);
    if (!title) return -1;
    return lines.findIndex((line) => {
      const current = cleanText(line);
      return current === title || current.includes(title) || title.includes(current);
    });
  }

  function jobIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      return (
        url.searchParams.get("currentJobId") ||
        url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] ||
        ""
      );
    } catch (_) {
      return "";
    }
  }

  function isLikelyJobTitleText(text) {
    const value = cleanText(text);
    if (!value || value.length < 2 || value.length > 140) return false;
    if (/^(apply|easy apply|save|saved|remote|hybrid|on-site|full-time|premium|about the job)$/i.test(value)) {
      return false;
    }
    return /\b(engineer|scientist|manager|specialist|analyst|developer|designer|intern|lead|director|product|data|software|machine learning|ai|ml|consultant|associate|architect)\b/i.test(
      value,
    );
  }

  function extractJobFromVisibleHeader() {
    const description = extractDescription();
    const titleEl = findVisibleJobTitleElement();
    const rawTitle =
      cleanText(titleEl?.textContent || "") ||
      titleFromPageMetadata() ||
      titleFromDescription(description) ||
      titleFromSelectedJobCard();
    const jobTitle = cleanJobTitle(rawTitle);
    const headerRoot = findHeaderRoot(titleEl);
    const headerLines = cleanLines(headerRoot?.innerText || headerRoot?.textContent || "");
    const sponsorship = analyzeSponsorship(description);

    return {
      jobTitle: jobTitle.slice(0, 200),
      company: extractCompany(headerRoot, headerLines, rawTitle).slice(0, 200),
      location: extractLocation(headerLines, rawTitle, description).slice(0, 200),
      jobUrl: canonicalJobUrl(),
      jobDescription: description,
      sponsorshipStatus: sponsorship.status,
      sponsorshipEvidence: sponsorship.evidence,
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

      .${ROW_HELPER_CLASS} {
        align-items: center;
        appearance: none;
        background: #eef6ff;
        border: 1px solid #0a66c2;
        border-radius: 999px;
        color: #0a66c2;
        cursor: pointer;
        display: inline-flex;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        justify-content: center;
        line-height: 18px;
        margin-right: 8px;
        min-height: 34px;
        padding: 6px 14px;
        white-space: nowrap;
      }

      .${ROW_HELPER_CLASS}:hover {
        background: #dceeff;
      }

      .${ROW_HELPER_CLASS}:disabled {
        cursor: default;
        opacity: 0.75;
      }

      #${MODAL_HELPER_ID}.lra-modal-note-helper {
        align-items: center;
        appearance: none;
        background: #0a66c2;
        border: 1px solid #0a66c2;
        border-radius: 999px;
        color: #fff;
        cursor: pointer;
        display: inline-flex;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        justify-content: center;
        line-height: 18px;
        margin-right: 8px;
        min-height: 34px;
        padding: 6px 14px;
        white-space: nowrap;
      }

      #${MODAL_HELPER_ID}.lra-modal-note-helper:hover {
        background: #004182;
        border-color: #004182;
      }

      #${MODAL_HELPER_ID}.lra-modal-note-helper:disabled {
        cursor: default;
        opacity: 0.75;
      }

      @media (max-width: 760px) {
        #${WRAP_ID}.lra-floating-wrap {
          bottom: 84px;
          right: 12px;
        }

        .${ROW_HELPER_CLASS},
        #${MODAL_HELPER_ID}.lra-modal-note-helper {
          font-size: 13px;
          padding: 6px 10px;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
})();
