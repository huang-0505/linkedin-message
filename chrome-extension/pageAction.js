// pageAction.js — injects first-class buttons into LinkedIn job/profile pages.
//
// This keeps the user in LinkedIn: job pages get "Find referral"; profile
// pages get "Add to referral panel". People search pages get row-level connect
// helpers and modal note filling. The extension still does not scrape results
// or click final Send.

(() => {
  const EXTENSION_VERSION = "0.5.0";
  const REFRESH_KEY = "__LRA_PAGE_ACTION_REFRESH_V16__";
  const BUTTON_ID = "lra-page-action-button";
  const WRAP_ID = "lra-page-action-wrap";
  const STYLE_ID = "lra-page-action-style";
  const ROW_HELPER_CLASS = "lra-row-connect-helper"; // legacy "CN" chip class (left for stale-cleanup)
  const ROW_BUTTON_CLASS = "lra-row-connect-button"; // row-level "Connect + Note" button
  const ROW_BUTTON_WRAP_CLASS = "lra-row-connect-button-wrap";
  const ACTION_SELECTOR = [
    "button",
    "a[role='button']",
    "a[href*='/preload/search-custom-invite/']",
    "a[href*='/messaging/']",
    "a[aria-label]",
  ].join(", ");
  const MODAL_HELPER_ID = "lra-modal-note-helper";
  const SEARCH_STATUS_ID = "lra-search-helper-status";
  const CONNECT_STATUS_ID = "lra-connect-intent-status";
  const RATE_BANNER_ID = "lra-rate-banner";
  const SETTINGS_POPOVER_ID = "lra-rate-settings-popover";
  const ACTIVE_OUTREACH_CONTEXT_KEY = "lra:active-outreach-context";
  const CONNECT_INTENT_KEY = "lra:connect-intent"; // legacy per-tab key (still set for backward compat)
  const PENDING_INTENTS_KEY = "lra:pending-intents"; // cross-tab map of { [slug]: { name, profileUrl, savedAt } }
  const INVITE_STATS_KEY = "lra:invite-stats";
  const INVITE_SETTINGS_KEY = "lra:invite-settings";
  const WEEKLY_BLOCK_KEY = "lra:weekly-block-until";
  const DEFAULT_SETTINGS = Object.freeze({
    dailyCap: 20,
    weeklyCap: 100,
    minDelayMs: 8000,
    maxJitterMs: 7000,
  });
  let lastUrl = "";
  let injectTimer = 0;
  let activeRecipientName = "";
  let activeRecipientNameSavedAt = 0;
  let lastSentAtMs = 0;
  let currentJitterMs = 0;
  let cooldownTickTimer = 0;
  let cachedStats = null;
  let cachedSettings = null;
  let cachedWeeklyBlockUntil = 0;
  let autoConnectAttempted = false;
  let profileConnectCandidateDumped = false;

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
    const urlChanged = lastUrl !== window.location.href;
    lastUrl = window.location.href;
    if (urlChanged) {
      autoConnectAttempted = false;
      profileConnectCandidateDumped = false;
    }

    if (!mode) {
      removeButton();
      removeSearchStatus();
      removeConnectStatus();
      removeRateBanner();
      return;
    }

    restoreConnectIntentName();
    injectConnectModalHelper();
    if (mode === "search" || mode === "profile") ensureInviteContextLoaded();

    if (mode === "search") {
      removeButton();
      removeConnectStatus();
      removeSearchStatus();
      injectSearchResultHelpers();
      return;
    }

    removeSearchStatus();
    removeRateBanner();
    updateProfileConnectStatus(mode);

    if (mode === "profile") {
      maybeAutoOpenConnect();
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
    const result = await storageGet("lra:active-outreach-context");
    const note = result?.["lra:active-outreach-context"]?.connectionMessage || "";
    if (!note.trim()) throw new Error("Missing outreach note.");
    await copyTextToClipboard(note);
  }

  async function storageGet(key) {
    const local = extensionStorageLocal();
    if (local?.get) return local.get(key);

    const response = await runtimeStorageMessage("LRA_STORAGE_GET", { key });
    return response?.values || {};
  }

  async function storageSet(values) {
    const local = extensionStorageLocal();
    if (local?.set) return local.set(values);

    await runtimeStorageMessage("LRA_STORAGE_SET", { values });
  }

  async function storageRemove(key) {
    const local = extensionStorageLocal();
    if (local?.remove) return local.remove(key);

    await runtimeStorageMessage("LRA_STORAGE_REMOVE", { key });
  }

  function extensionStorageLocal() {
    const api = extensionChrome();
    return api?.storage?.local || null;
  }

  function extensionChrome() {
    try {
      return typeof chrome === "undefined" ? null : chrome;
    } catch (_) {
      return null;
    }
  }

  async function runtimeStorageMessage(type, payload) {
    const sendMessage = extensionChrome()?.runtime?.sendMessage;
    if (!sendMessage) throw new Error("Extension storage unavailable.");

    const response = await sendMessage({ type, ...payload });
    if (!response?.ok) {
      throw new Error(response?.error || "Extension storage unavailable.");
    }
    return response;
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

  let lastInjectAttached = 0;
  function injectSearchResultHelpers() {
    // Evict legacy "CN" chips from prior extension versions.
    document
      .querySelectorAll(`.${ROW_HELPER_CLASS}:not(#${MODAL_HELPER_ID})`)
      .forEach((el) => el.remove());
    cleanupStaleRowButtonWraps();

    let attached = 0;
    const weeklyBlocked = isWeeklyBlocked();
    const cooldown = remainingCooldownMs();
    for (const row of findPeopleSearchRows()) {
      if (ensureRowConnectButton(row, { weeklyBlocked, cooldown })) attached += 1;
    }
    lastInjectAttached = attached;
    refreshRateBanner();
    return attached;
  }

  function cleanupStaleRowButtonWraps() {
    document.querySelectorAll(`.${ROW_BUTTON_WRAP_CLASS}`).forEach((wrap) => {
      const button = wrap.querySelector(`.${ROW_BUTTON_CLASS}`);
      if (
        !button ||
        button.dataset.lraVersion !== EXTENSION_VERSION ||
        !wrap.dataset.lraOwnerRow
      ) {
        wrap.remove();
      }
    });
  }

  function findPeopleSearchRows() {
    const main = document.querySelector("main") || document.body;
    const known = Array.from(
      main.querySelectorAll(
        [
          "[data-view-name='search-entity-result-universal-template']",
          "[data-chameleon-result-urn]",
          "[data-test-search-entity]",
          ".reusable-search__result-container",
          ".entity-result",
          ".search-result",
          "ul.reusable-search__entity-result-list > li",
          "ul[role='list'] > li.artdeco-list__item",
        ].join(", "),
      ),
    );

    const seen = new Set();
    const collected = [];
    const pushUnique = (row) => {
      if (!row || seen.has(row)) return;
      seen.add(row);
      collected.push(row);
    };

    for (const row of known) pushUnique(row);

    // Fallback: walk up from every visible /in/ profile link and ask
    // closestSearchResultRow to find a row container. Always run this, because
    // LinkedIn can mix known row wrappers with renamed result wrappers.
    const links = Array.from(main.querySelectorAll('a[href*="/in/"]')).filter(isVisible);
    for (const link of links) {
      const row = closestSearchResultRow(link);
      if (row) pushUnique(row);
    }

    const filtered = collected.filter((row) => {
      if (!isVisible(row)) return false;
      const link = row.querySelector('a[href*="/in/"]');
      if (!link) return false;
      return isLikelyPeopleSearchRow(row, link);
    });

    // Dedupe by profile slug: LinkedIn rows have multiple /in/ links (photo +
    // name + headline overlay), each walks up to a different ancestor. Keep
    // the largest container per slug — it's the full row, not a sub-block.
    const bestPerSlug = new Map();
    for (const row of filtered) {
      const slug = profileSlugFromHref(profileUrlFromRow(row));
      if (!slug) continue;
      const area = row.getBoundingClientRect().height * row.getBoundingClientRect().width;
      const prev = bestPerSlug.get(slug);
      if (!prev || area > prev.area) bestPerSlug.set(slug, { row, area });
    }
    return Array.from(bestPerSlug.values()).map((entry) => entry.row);
  }

  function ensureRowConnectButton(row, ctx) {
    const slug = profileSlugFromHref(profileUrlFromRow(row));
    const kind = getRowKind(row);

    // Clean up ANY old wrap inside this row that may have been injected for a
    // different ancestor before the dedupe ran (defensive — prevents stragglers).
    const stale = row.querySelectorAll(`.${ROW_BUTTON_WRAP_CLASS}`);
    let wrap = null;
    let button = null;
    stale.forEach((node) => {
      const btn = node.querySelector(`.${ROW_BUTTON_CLASS}`);
      if (
        !wrap &&
        btn &&
        btn.dataset.lraVersion === EXTENSION_VERSION &&
        btn.dataset.lraSlug === slug &&
        node.dataset.lraOwnerRow === slug
      ) {
        wrap = node;
        button = btn;
      } else {
        node.remove();
      }
    });

    // Also clean up any sibling wrap we previously injected AFTER the row.
    const sibling = row.nextElementSibling;
    if (
      sibling &&
      sibling.classList?.contains(ROW_BUTTON_WRAP_CLASS) &&
      sibling.dataset.lraOwnerRow === slug
    ) {
      const btn = sibling.querySelector(`.${ROW_BUTTON_CLASS}`);
      if (btn && btn.dataset.lraVersion === EXTENSION_VERSION) {
        wrap = wrap || sibling;
        button = button || btn;
      } else {
        sibling.remove();
      }
    }

    if (button) {
      applyRowButtonState(button, kind, ctx);
      return true;
    }

    wrap = document.createElement("div");
    wrap.className = ROW_BUTTON_WRAP_CLASS;
    wrap.dataset.lraOwnerRow = slug;

    button = document.createElement("button");
    button.type = "button";
    button.className = ROW_BUTTON_CLASS;
    button.dataset.lraVersion = EXTENSION_VERSION;
    button.dataset.lraSlug = slug;

    // CAPTURE phase + stopImmediatePropagation so LinkedIn's overlay <a>
    // doesn't get the click. Also intercept mousedown/pointerdown since
    // some overlay handlers fire on those, not click.
    const swallow = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    button.addEventListener("mousedown", swallow, true);
    button.addEventListener("pointerdown", swallow, true);
    button.addEventListener(
      "click",
      (event) => {
        swallow(event);
        handleRowConnectClick(row, button);
      },
      true,
    );

    wrap.appendChild(button);

    const placement = rowButtonPlacement(row);
    wrap.dataset.lraPlacement = placement.kind;
    if (placement.before && placement.target?.insertBefore) {
      placement.target.insertBefore(wrap, placement.before);
    } else if (placement.target?.appendChild) {
      placement.target.appendChild(wrap);
    } else {
      row.appendChild(wrap);
    }

    applyRowButtonState(button, kind, ctx);
    return true;
  }

  function rowButtonPlacement(row) {
    const nativeAction = findVisibleNativeRowAction(row);
    const actionArea =
      row.querySelector(
        [
          ".entity-result__actions",
          ".search-result__actions",
          "[data-test-search-result-actions]",
        ].join(", "),
      ) ||
      nativeAction?.parentElement ||
      null;

    const candidates = [
      { target: actionArea, before: nativeAction?.parentElement === actionArea ? nativeAction : null, kind: "actions" },
      { target: row.querySelector(".reusable-search-simple-insight"), before: null, kind: "content" },
      { target: row, before: null, kind: "fallback" },
    ];

    for (const candidate of candidates) {
      if (!candidate.target) continue;
      const target = escapeAnchorAncestor(candidate.target, row);
      if (!target || !row.contains(target)) continue;
      const before = candidate.before && target === candidate.target ? candidate.before : null;
      return { target, before, kind: candidate.kind };
    }

    return { target: row, before: null, kind: "fallback" };
  }

  function findVisibleNativeRowAction(row) {
    return actionElements(row).find((button) => {
      if (!isVisible(button)) return false;
      if (button.classList.contains(ROW_HELPER_CLASS)) return false;
      if (button.classList.contains(ROW_BUTTON_CLASS)) return false;
      return /\b(message|connect|follow|more|no\s*connect)\b/i.test(buttonLabel(button));
    });
  }

  function escapeAnchorAncestor(node, stopAt) {
    // If `node` is inside an <a> that's still within `stopAt`, walk up to the
    // anchor's parent. If walking lands outside `stopAt`, give up and return
    // `stopAt` so the caller can use sibling placement.
    let current = node;
    while (current && current !== stopAt) {
      if (current.tagName === "A") {
        const parent = current.parentElement;
        if (!parent || !stopAt.contains(parent)) return stopAt;
        current = parent;
        continue;
      }
      // If any ancestor of `node` up to stopAt is an <a>, escape.
      const anchorAncestor = current.closest && current.closest("a");
      if (anchorAncestor && stopAt.contains(anchorAncestor)) {
        const parent = anchorAncestor.parentElement;
        if (!parent || !stopAt.contains(parent)) return stopAt;
        current = parent;
        continue;
      }
      return current;
    }
    return stopAt;
  }

  function applyRowButtonState(button, kind, ctx) {
    button.dataset.state = kind;
    button.title = "";
    switch (kind) {
      case "connectable":
        button.textContent = "Connect + Note";
        button.title = "Open invite modal with your outreach note pre-filled.";
        break;
      case "messageable":
        button.textContent = "Connect + Note";
        button.title = "LinkedIn only shows Message here. Opens the profile and fills a note if Connect is available there.";
        break;
      case "restricted":
        button.textContent = "Can't connect";
        button.title = "LinkedIn restricts Connect for this person. Click to open profile in a new tab.";
        break;
      default:
        button.textContent = "Connect + Note";
        button.title = "Opens profile in a new tab to find the Connect action.";
    }

    if (ctx?.weeklyBlocked) {
      button.disabled = true;
      button.title = "LinkedIn weekly invitation limit hit — buttons paused.";
      return;
    }

    if (kind === "restricted") {
      // We still allow clicking (opens profile in new tab) but visually disabled.
      button.disabled = false;
      return;
    }

    if (ctx && ctx.cooldown && ctx.cooldown > 0) {
      button.disabled = true;
      button.dataset.cooldown = "true";
      const seconds = Math.ceil(ctx.cooldown / 1000);
      button.textContent = `Wait ${seconds}s...`;
    } else {
      button.disabled = false;
      delete button.dataset.cooldown;
    }
  }

  function getRowKind(row) {
    if (!row) return "unknown";
    const profileUrl = profileUrlFromRow(row);
    if (!profileUrl) return "restricted";

    const labels = visibleActionLabels(row);
    const labelText = labels.join(" | ");

    if (/\bno\s*connect\b/i.test(labelText) || /\bno\s*connect\b/i.test(cleanText(row.innerText || row.textContent || ""))) {
      return "restricted";
    }
    if (/\bconnect\b/i.test(labelText)) return "connectable";
    if (/\bmore\b/i.test(labelText)) return "connectable"; // Connect likely hidden under More.
    if (/\bmessage\b/i.test(labelText)) return "messageable";
    return "unknown";
  }

  function visibleActionLabels(row) {
    return actionElements(row)
      .filter(
        (el) =>
          isVisible(el) &&
          !el.classList.contains(ROW_BUTTON_CLASS) &&
          !el.classList.contains(ROW_HELPER_CLASS),
      )
      .map((el) => buttonLabel(el))
      .filter(Boolean);
  }

  function closestSearchResultRow(seed) {
    const selector = [
      "[data-view-name='search-entity-result-universal-template']",
      ".reusable-search__result-container",
      ".entity-result",
      "li",
    ].join(", ");
    const direct = seed.closest(selector);

    const candidates = [];
    if (direct && isLikelyPeopleSearchRow(direct, seed)) candidates.push(direct);

    let node = seed.parentElement;
    for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
      if (isLikelyPeopleSearchRow(node, seed)) {
        candidates.push(node);
        continue;
      }

      if (isVisible(node) && node.querySelector?.('a[href*="/in/"]')) {
        const rect = node.getBoundingClientRect();
        if (rect.height > 0 && rect.height <= 480 && countVisibleRowActions(node) <= 3) {
          candidates.push(node);
        }
      }
    }

    return bestSearchResultRowCandidate(candidates) || direct || seed.parentElement;
  }

  function bestSearchResultRowCandidate(candidates) {
    let best = null;
    let bestScore = -Infinity;
    for (const row of candidates) {
      const score = searchResultRowScore(row);
      if (score > bestScore) {
        best = row;
        bestScore = score;
      }
    }
    return best;
  }

  function searchResultRowScore(row) {
    if (!row || !isVisible(row) || !row.querySelector?.('a[href*="/in/"]')) return -Infinity;

    const rect = row.getBoundingClientRect();
    if (rect.height <= 0 || rect.width < 240 || rect.height > 650) return -Infinity;

    const actionCount = countVisibleRowActions(row);
    if (actionCount > 4) return -Infinity;

    let score = 0;
    if (row.matches?.("[data-view-name='search-entity-result-universal-template']")) score += 80;
    if (row.matches?.(".reusable-search__result-container, .entity-result, .search-result")) score += 70;
    if (row.tagName === "LI") score += 40;
    if (hasRowActionArea(row)) score += 35;
    if (actionCount > 0) score += 25;

    const text = cleanText(row.innerText || row.textContent || "");
    if (/\b(?:1st|2nd|3rd\+?|3rd)\b/i.test(text)) score += 12;

    // Prefer the full person result over the name/headline sub-block, but avoid
    // drifting up into the whole list. The height cap above is the guardrail.
    score += Math.min(rect.width / 30, 30);
    score += Math.min(rect.height / 12, 45);
    return score;
  }

  function hasRowActionArea(row) {
    return Boolean(
      row?.querySelector?.(
        [
          ".entity-result__actions",
          ".search-result__actions",
          "[data-test-search-result-actions]",
        ].join(", "),
      ),
    );
  }

  function isLikelyPeopleSearchRow(row, seed) {
    if (!row || !isVisible(row)) return false;
    if (seed && !row.contains(seed)) return false;

    const rect = row.getBoundingClientRect();
    // Bumped from 420 → 600. Rows with mutual-connection lines, multi-line
    // headlines, or job titles wrapping to 2 lines can exceed 420px.
    if (rect.height > 600 || rect.width < 240) return false;

    const actionCount = countVisibleRowActions(row);
    if (actionCount > 4) return false;

    if (row.querySelector(`.${ROW_HELPER_CLASS}`)) return true;
    if (row.querySelector(`.${ROW_BUTTON_CLASS}`)) return true;
    // A profile link is the strongest signal that this is a people row.
    // Don't require a visible action button — "No connect" rows still qualify.
    if (row.querySelector('a[href*="/in/"]')) return true;

    const text = cleanText(row.innerText || row.textContent || "");
    return /\b(1st|2nd|3rd\+?|3rd)\b/i.test(text) && /\b(message|connect|follow)\b/i.test(text);
  }

  function countVisibleRowActions(row) {
    return actionElements(row).filter(
      (button) =>
        isVisible(button) &&
        !button.classList.contains(ROW_HELPER_CLASS) &&
        !button.classList.contains(ROW_BUTTON_CLASS) &&
        /\b(message|connect|follow|more)\b/i.test(buttonLabel(button)),
    ).length;
  }

  function updateSearchStatus(helperCount) {
    let status = document.getElementById(SEARCH_STATUS_ID);
    if (!status) {
      status = document.createElement("div");
      status.id = SEARCH_STATUS_ID;
      status.className = "lra-search-helper-status";
      document.body.appendChild(status);
    }

    status.textContent =
      helperCount > 0
        ? `Referral helper v${EXTENSION_VERSION} · ${helperCount} rows`
        : `Referral helper v${EXTENSION_VERSION} · waiting for rows`;
  }

  function removeSearchStatus() {
    document.getElementById(SEARCH_STATUS_ID)?.remove();
  }

  // ----- Rate banner / settings popover -----------------------------------------------

  let inviteContextLoaded = false;
  async function ensureInviteContextLoaded() {
    if (inviteContextLoaded) return;
    inviteContextLoaded = true;
    try {
      await Promise.all([inviteStats(), inviteSettings(), loadWeeklyBlock()]);
      refreshRateBanner();
    } catch (error) {
      console.warn("Connect+Note: failed to load invite context", error);
    }
  }

  function refreshRateBanner() {
    if (currentMode() !== "search") {
      removeRateBanner();
      return;
    }

    const stats = inviteStatsSnapshot();
    const settings = inviteSettingsSnapshot();
    const blocked = isWeeklyBlocked();

    let banner = document.getElementById(RATE_BANNER_ID);
    if (!banner) {
      banner = document.createElement("div");
      banner.id = RATE_BANNER_ID;
      banner.className = "lra-rate-banner";
      document.body.appendChild(banner);
    }

    banner.dataset.blocked = blocked ? "true" : "false";
    banner.innerHTML = "";

    if (blocked) {
      const warn = document.createElement("span");
      warn.textContent = "⚠ Weekly invitation limit hit — buttons paused.";
      banner.appendChild(warn);

      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "lra-rate-settings";
      clear.textContent = "Clear block";
      clear.addEventListener("click", (event) => {
        event.preventDefault();
        clearWeeklyBlock();
      });
      banner.appendChild(clear);
    } else {
      const status = document.createElement("span");
      const rowSuffix =
        lastInjectAttached > 0
          ? ` · ${lastInjectAttached} rows`
          : " · waiting for rows";
      status.textContent = `Connect + Note · ${stats.todayCount}/${settings.dailyCap} today · ${stats.weekCount}/${settings.weeklyCap} week${rowSuffix}`;
      banner.appendChild(status);

      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "lra-rate-settings";
      minus.textContent = "−1";
      minus.title = "Decrement counter (if you cancelled without sending).";
      minus.addEventListener("click", (event) => {
        event.preventDefault();
        adjustInviteCount(-1);
      });
      banner.appendChild(minus);

      const gear = document.createElement("button");
      gear.type = "button";
      gear.className = "lra-rate-settings";
      gear.textContent = "⚙";
      gear.title = "Connect + Note settings";
      gear.addEventListener("click", (event) => {
        event.preventDefault();
        toggleSettingsPopover();
      });
      banner.appendChild(gear);
    }
  }

  function removeRateBanner() {
    document.getElementById(RATE_BANNER_ID)?.remove();
    document.getElementById(SETTINGS_POPOVER_ID)?.remove();
  }

  function toggleSettingsPopover() {
    const existing = document.getElementById(SETTINGS_POPOVER_ID);
    if (existing) {
      existing.remove();
      return;
    }

    const settings = inviteSettingsSnapshot();
    const popover = document.createElement("div");
    popover.id = SETTINGS_POPOVER_ID;
    popover.className = "lra-rate-settings-popover";

    const heading = document.createElement("div");
    heading.className = "lra-rate-settings-heading";
    heading.textContent = "Connect + Note settings";
    popover.appendChild(heading);

    const capRow = document.createElement("label");
    capRow.className = "lra-rate-settings-row";
    capRow.textContent = "Daily cap: ";
    const capInput = document.createElement("input");
    capInput.type = "number";
    capInput.min = "1";
    capInput.max = "100";
    capInput.value = String(settings.dailyCap);
    capInput.addEventListener("change", async () => {
      const value = Math.max(1, Math.min(100, Number(capInput.value) || settings.dailyCap));
      await writeInviteSettings({ dailyCap: value });
    });
    capRow.appendChild(capInput);
    popover.appendChild(capRow);

    const weekRow = document.createElement("label");
    weekRow.className = "lra-rate-settings-row";
    weekRow.textContent = "Weekly cap: ";
    const weekInput = document.createElement("input");
    weekInput.type = "number";
    weekInput.min = "1";
    weekInput.max = "500";
    weekInput.value = String(settings.weeklyCap);
    weekInput.addEventListener("change", async () => {
      const value = Math.max(1, Math.min(500, Number(weekInput.value) || settings.weeklyCap));
      await writeInviteSettings({ weeklyCap: value });
    });
    weekRow.appendChild(weekInput);
    popover.appendChild(weekRow);

    const actions = document.createElement("div");
    actions.className = "lra-rate-settings-actions";
    const mkAction = (label, fn) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lra-rate-settings";
      btn.textContent = label;
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        fn();
      });
      actions.appendChild(btn);
    };
    mkAction("Reset today", () => resetInviteWindow("today"));
    mkAction("Reset week", () => resetInviteWindow("week"));
    mkAction("Clear weekly block", () => clearWeeklyBlock());
    popover.appendChild(actions);

    document.body.appendChild(popover);
  }

  async function maybeAutoOpenConnect() {
    if (autoConnectAttempted) return;
    autoConnectAttempted = true;
    const slug = profileSlug();
    if (!slug) return;

    const intent = await consumePendingIntent(slug);
    if (!intent) {
      // No pending intent — this profile tab wasn't opened by our extension.
      // Don't show an error banner; just return quietly.
      return;
    }

    // Diagnostic: also log to console so user can verify in DevTools.
    try { console.info("[Connect+Note] auto-open running for", slug, intent); } catch (_) {}

    activeRecipientName = intent.name || "";
    activeRecipientNameSavedAt = Date.now();
    setAutoConnectStatus("Connect + Note: finding Connect...");

    const connectClicked = await clickProfileConnectAction(26000);
    if (!connectClicked) {
      setAutoConnectStatus("Connect + Note: LinkedIn does not show Connect for this profile.", true);
      return;
    }

    const dialog = await waitForConnectModal(8000);
    if (!dialog) {
      setAutoConnectStatus("Connect + Note: invite modal didn't open.", true);
      return;
    }
    if (checkWeeklyLimitModal(dialog)) {
      setAutoConnectStatus("Connect + Note: LinkedIn weekly invitation limit hit.", true);
      return;
    }
    const modalHelper = injectConnectModalHelper(dialog);
    const filled = await fillConnectModalNote(dialog, modalHelper);
    if (filled) {
      setAutoConnectStatus("Connect + Note: note filled. Click Send.");
    } else {
      setAutoConnectStatus("Connect + Note: couldn't fill note. Paste it manually.", true);
    }
  }

  function setAutoConnectStatus(text, isError = false) {
    let status = document.getElementById("lra-auto-connect-status");
    if (!status) {
      status = document.createElement("div");
      status.id = "lra-auto-connect-status";
      status.style.cssText =
        "position:fixed;top:72px;right:16px;z-index:2147483647;background:#0a66c2;color:#fff;font:600 13px -apple-system,system-ui,sans-serif;padding:10px 14px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.22);max-width:320px;";
      document.body.appendChild(status);
    }
    status.textContent = text;
    status.style.background = isError ? "#b91c1c" : "#0a66c2";
    window.clearTimeout(status.dataset.hideTimer || 0);
    const timer = window.setTimeout(() => status.remove(), 8000);
    status.dataset.hideTimer = String(timer);
  }

  // Profile-page Connect button finder.
  // LinkedIn's profile Connect button can appear with text "Connect" but with
  // aria-label like "Invite Soe Than to connect" — so a strict match fails.
  // We accept any visible button whose label contains the literal word
  // "Connect" (case-insensitive), and we prefer buttons in the top-card area.
  async function waitForProfileConnectButton(timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const button = findProfileConnectButton();
      if (button) return button;
      await sleep(150);
    }
    return null;
  }

  async function clickProfileConnectAction(timeoutMs) {
    const startedAt = Date.now();
    let lastMoreAttemptAt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      const directConnect = findProfileConnectButton();
      if (directConnect) {
        setAutoConnectStatus("Connect + Note: opening invite modal...");
        clickElement(directConnect);
        return true;
      }

      const moreButton = findProfileMoreButton();
      if (moreButton && Date.now() - lastMoreAttemptAt > 2500) {
        lastMoreAttemptAt = Date.now();
        setAutoConnectStatus("Connect + Note: checking More menu...");
        clickElement(moreButton);

        const menuConnect = await waitForMenuConnectAction(2800);
        if (menuConnect) {
          setAutoConnectStatus("Connect + Note: opening invite modal...");
          clickElement(menuConnect);
          return true;
        }
      }

      await sleep(250);
    }

    return false;
  }

  function findProfileConnectButton() {
    // Source candidates from BOTH the whole document AND the top-card-scoped
    // selectors. Document gets us everything in production. The scoped scan
    // ensures tests (which often stub only a top-card mock) still find
    // buttons. Dedupe by identity.
    const everything = [];
    const seen = new Set();
    try {
      for (const el of actionElements(document)) {
        if (!seen.has(el)) { seen.add(el); everything.push(el); }
      }
    } catch (_) {}
    for (const el of profileActionCandidates()) {
      if (!seen.has(el)) { seen.add(el); everything.push(el); }
    }

    const candidates = everything.filter((el) => {
      if (!isVisible(el)) return false;
      if (el.classList.contains(ROW_BUTTON_CLASS)) return false;
      if (el.classList.contains(ROW_HELPER_CLASS)) return false;
      // Exclude well-known non-top-card regions:
      const excludedAncestor = el.closest(
        "aside, " +
        ".scaffold-layout__aside, " +
        ".global-nav, " +
        "header.global-nav, " +
        "nav, " +
        ".artdeco-modal, " +
        ".feed-shared-control-menu, " +
        "[data-chameleon-result-urn], " +
        ".entity-result, " +
        ".reusable-search__result-container, " +
        ".pv-browsemap-section, " +
        ".similar-profiles, " +
        ".browsemap-recommendation, " +
        ".more-profiles, " +
        ".pv-recent-activity-section, " +
        ".pv-recommendations-section, " +
        "footer",
      );
      if (excludedAncestor) return false;
      return true;
    });

    // Diagnostic dump so we can see exactly what's available in DevTools.
    if (!profileConnectCandidateDumped) try {
      profileConnectCandidateDumped = true;
      const dump = candidates.slice(0, 25).map((el) => ({
        text: cleanText(el.innerText || el.textContent || "").slice(0, 50),
        aria: (el.getAttribute("aria-label") || "").slice(0, 100),
        rect: (() => { const r = el.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; })(),
      }));
      console.info("[Connect+Note] top-card candidates (" + candidates.length + "):", dump);
    } catch (_) {}

    // Pass 1: aria-label matches LinkedIn's standard "Invite ___ to connect".
    const aria = candidates.find((el) => {
      const label = el.getAttribute("aria-label") || "";
      return /\binvite\b.*\bto connect\b/i.test(label);
    });
    if (aria) return aria;

    // Pass 2: visible text is exactly "Connect".
    const exact = candidates.find((el) => {
      const text = cleanText(el.innerText || el.textContent || "");
      return /^connect$/i.test(text);
    });
    if (exact) return exact;

    // Pass 3: text starts with "Connect" (handles "Connect now" etc.).
    const starts = candidates.find((el) => {
      const text = cleanText(el.innerText || el.textContent || "");
      return /^connect\b/i.test(text) && !/\b(connected|connection)\b/i.test(text);
    });
    if (starts) return starts;

    // Pass 4: ANY button anywhere with "connect" in combined label, excluding
    // disqualifying words.
    const loose = candidates.find((el) => {
      const label = buttonLabel(el).toLowerCase();
      if (!/\bconnect\b/.test(label)) return false;
      if (/\b(connected|connections?|follow|message|more|see all|remove connection|withdraw|pending|view profile|cancel|next|skip|edit|done)\b/.test(label)) return false;
      return true;
    });
    if (loose) return loose;

    // Pass 5: last-ditch — any visible button whose icon SVG has aria-label or
    // title containing "connect" (LinkedIn sometimes uses an icon-only button).
    const iconOnly = candidates.find((el) => {
      const svg = el.querySelector("svg, use");
      if (!svg) return false;
      const aria = (svg.getAttribute("aria-label") || svg.getAttribute("title") || "").toLowerCase();
      return /\bconnect\b/.test(aria) && !/\b(connected|connection)\b/.test(aria);
    });
    return iconOnly || null;
  }

  async function waitForProfileMoreButton(timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const match = findProfileMoreButton();
      if (match) return match;
      await sleep(150);
    }
    return null;
  }

  function findProfileMoreButton() {
    const candidates = actionElements(document).filter((el) => {
      if (!isVisible(el)) return false;
      if (el.classList.contains(ROW_BUTTON_CLASS)) return false;
      if (el.classList.contains(ROW_HELPER_CLASS)) return false;
      if (el.closest("aside, .scaffold-layout__aside, nav, .global-nav, header.global-nav, .artdeco-modal, [data-chameleon-result-urn], .entity-result, .reusable-search__result-container, .pv-browsemap-section, .similar-profiles, .more-profiles, footer")) return false;
      return true;
    });

    return candidates.find((el) => {
      const text = cleanText(el.innerText || el.textContent || "");
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      if (/^more$/i.test(text)) return true;
      if (/^more actions?$/.test(aria)) return true;
      if (/\bmore options?\b/.test(aria)) return true;
      if (/^open menu$/.test(aria)) return true;
      // Three-dot icon-only buttons commonly use these patterns.
      if (/\boverflow\b/.test(aria)) return true;
      return false;
    });
  }

  function profileActionCandidates() {
    const roots = [
      document.querySelector(".pv-top-card"),
      document.querySelector(".pv-top-card-v2-ctas"),
      document.querySelector(".pv-text-details__left-panel"),
      document.querySelector("main section:first-of-type"),
      document.querySelector("main"),
      document.body,
    ].filter(Boolean);

    const seen = new Set();
    const candidates = [];
    for (const root of roots) {
      if (!root?.querySelectorAll) continue;
      for (const el of actionElements(root)) {
        if (seen.has(el)) continue;
        seen.add(el);
        candidates.push(el);
      }
    }
    return candidates;
  }

  // Kept for backward compat with any other callers.
  async function waitForVisibleProfileButton(pattern, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const button = findButtonByText(document, pattern);
      if (button) return button;
      await sleep(150);
    }
    return null;
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

  function profileUrlFromRow(row) {
    const profileLinks = Array.from(row.querySelectorAll('a[href*="/in/"]'));

    for (const link of profileLinks) {
      const href = link.href || link.getAttribute("href") || "";
      const url = canonicalProfileUrlFromHref(href);
      if (url) return url;
    }

    return "";
  }

  async function handleRowConnectClick(row, button) {
    const kind = getRowKind(row);
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Opening...";

    try {
      // Restricted rows skip rate limit and skip note logic: just open profile in new tab.
      if (kind === "restricted") {
        const profileUrl = profileUrlFromRow(row);
        if (!profileUrl) throw new Error("No profile URL.");
        openProfileInNewTab(profileUrl);
        button.textContent = "Opened tab";
        return;
      }

      if (isWeeklyBlocked()) {
        throw new Error("Weekly invitation limit hit.");
      }
      const settings = await inviteSettings();
      const stats = await inviteStats();
      if (stats.todayCount >= settings.dailyCap) {
        throw new Error("Daily cap reached.");
      }
      const cooldown = remainingCooldownMs();
      if (cooldown > 0) {
        throw new Error(`Wait ${Math.ceil(cooldown / 1000)}s.`);
      }

      const context = await activeOutreachContext();
      if (!context?.connectionMessage?.trim()) {
        throw new Error("Missing outreach note.");
      }

      activeRecipientName = extractPersonNameFromRow(row);
      activeRecipientNameSavedAt = Date.now();
      const profileUrl = profileUrlFromRow(row);

      const opened = await tryOpenNativeConnect(row);
      if (!opened) {
        if (!profileUrl) throw new Error("No profile URL.");
        await persistConnectIntent({
          slug: profileSlugFromHref(profileUrl),
          name: activeRecipientName,
          profileUrl,
          savedAt: Date.now(),
        });
        button.textContent = "Opened tab";
        openProfileInNewTab(profileUrl);
        return;
      }

      const dialog = await waitForConnectModal();
      if (!dialog) throw new Error("No connect modal.");
      if (checkWeeklyLimitModal(dialog)) {
        throw new Error("Weekly invitation limit hit.");
      }

      const modalHelper = injectConnectModalHelper(dialog);
      const filled = await fillConnectModalNote(dialog, modalHelper);
      button.textContent = filled ? "Note filled" : "Modal ready";
    } catch (error) {
      button.textContent = rowHelperErrorText(error);
      button.title = error?.message || String(error);
    } finally {
      window.setTimeout(() => {
        // Re-render the row button so cooldown / blocked state is reapplied.
        injectSearchResultHelpers();
        if (!cooldownTickTimer) {
          button.disabled = false;
          button.textContent = originalText;
        }
      }, 2200);
    }
  }

  function openProfileInNewTab(profileUrl) {
    // Prefer background-script tab creation — it's never popup-blocked and
    // doesn't navigate the current tab if it fails. window.open is the
    // last-resort fallback in case the background message handler is gone.
    let sent = false;
    try {
      chrome.runtime.sendMessage(
        { type: "LRA_OPEN_PROFILE_TAB", url: profileUrl },
        (response) => {
          // No-op; we just need the message to fire. Errors are swallowed.
          void response;
          void chrome.runtime.lastError;
        },
      );
      sent = true;
    } catch (_) {}
    if (sent) return;
    try {
      window.open(profileUrl, "_blank", "noopener,noreferrer");
    } catch (_) {}
  }

  async function tryOpenNativeConnect(row) {
    const directConnect = findNativeConnectAction(row);
    if (directConnect) {
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
      actionElements(row).find((button) => {
        const label = button.getAttribute("aria-label") || "";
        return isVisible(button) && /\bmore\b/i.test(label);
      })
    );
  }

  function findNativeConnectAction(root) {
    return actionElements(root).find((action) => {
      if (!isVisible(action)) return false;
      if (action.classList.contains(ROW_HELPER_CLASS)) return false;
      if (action.classList.contains(ROW_BUTTON_CLASS)) return false;
      return isNativeConnectAction(action);
    });
  }

  function isNativeConnectAction(action) {
    const href = action.href || action.getAttribute("href") || "";
    if (/\/preload\/search-custom-invite\//i.test(href)) return true;

    const label = buttonLabel(action);
    if (/\binvite\b.*\bto connect\b/i.test(label)) return true;

    const text = cleanText(action.innerText || action.textContent || "");
    if (/^connect$/i.test(text)) return true;
    if (/^connect\b/i.test(text) && !/\b(connected|connection|connections|no\s*connect|pending|withdraw)\b/i.test(text)) {
      return true;
    }
    return false;
  }

  function actionElements(root) {
    if (!root?.querySelectorAll) return [];
    return Array.from(root.querySelectorAll(ACTION_SELECTOR));
  }

  function findButtonByText(root, pattern) {
    const buttons = actionElements(root);
    return buttons.find((button) => {
      if (!isVisible(button)) return false;
      if (button.classList.contains(ROW_HELPER_CLASS)) return false;
      if (button.classList.contains(ROW_BUTTON_CLASS)) return false;
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
        document.querySelectorAll(`[role='menuitem'], ${ACTION_SELECTOR}`),
      );
      const match = actions.find(
        (action) =>
          isVisible(action) &&
          !action.classList.contains(ROW_HELPER_CLASS) &&
          !action.classList.contains(ROW_BUTTON_CLASS) &&
          pattern.test(buttonLabel(action)),
      );
      if (match) return match;
      await sleep(100);
    }

    return null;
  }

  async function waitForMenuConnectAction(timeoutMs = 2800) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const actions = Array.from(
        document.querySelectorAll(`[role='menuitem'], ${ACTION_SELECTOR}`),
      );
      const match = actions.find(
        (action) =>
          isVisible(action) &&
          !action.classList.contains(ROW_HELPER_CLASS) &&
          !action.classList.contains(ROW_BUTTON_CLASS) &&
          isNativeConnectAction(action),
      );
      if (match) return match;
      await sleep(100);
    }

    return null;
  }

  async function waitForConnectModal(timeoutMs = 6000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const dialog = findConnectDialog();
      if (dialog) {
        // If LinkedIn opened the weekly-limit modal, snapshot the block immediately.
        checkWeeklyLimitModal(dialog);
        return dialog;
      }
      await sleep(120);
    }

    return null;
  }

  function checkWeeklyLimitModal(dialog) {
    if (!dialog) return false;
    const text = cleanText(dialog.innerText || dialog.textContent || "");
    if (!text) return false;
    if (
      /weekly invitation limit/i.test(text) ||
      /you'?ve? reached the (?:weekly )?limit/i.test(text) ||
      /you have reached the (?:weekly )?limit/i.test(text) ||
      /try again next week/i.test(text)
    ) {
      setWeeklyBlock();
      return true;
    }
    return false;
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

  function rememberConnectIntent(intent) {
    try {
      window.sessionStorage.setItem(
        CONNECT_INTENT_KEY,
        JSON.stringify({
          name: String(intent.name || "").slice(0, 120),
          profileUrl: canonicalProfileUrlFromHref(intent.profileUrl || ""),
          savedAt: Number(intent.savedAt || Date.now()),
        }),
      );
    } catch (_) {
      // If session storage is unavailable, the manual profile fallback still opens.
    }
  }

  function readConnectIntent() {
    try {
      const raw = window.sessionStorage.getItem(CONNECT_INTENT_KEY);
      if (!raw) return null;

      const intent = JSON.parse(raw);
      const savedAt = Number(intent.savedAt || 0);
      if (!intent.profileUrl || Date.now() - savedAt > 10 * 60 * 1000) {
        clearConnectIntent();
        return null;
      }

      return intent;
    } catch (_) {
      clearConnectIntent();
      return null;
    }
  }

  function restoreConnectIntentName() {
    const intent = readConnectIntent();
    if (!intent?.name) return;

    activeRecipientName = intent.name;
    activeRecipientNameSavedAt = Date.now();
  }

  function clearConnectIntent() {
    try {
      window.sessionStorage.removeItem(CONNECT_INTENT_KEY);
    } catch (_) {}
  }

  function updateProfileConnectStatus(mode) {
    if (mode !== "profile") {
      removeConnectStatus();
      return;
    }

    const intent = readConnectIntent();
    if (!intent) {
      removeConnectStatus();
      return;
    }

    const targetSlug = profileSlugFromHref(intent.profileUrl || "");
    const currentSlug = profileSlug();
    if (targetSlug && currentSlug && targetSlug !== currentSlug) {
      removeConnectStatus();
      return;
    }

    showConnectStatus("CN ready: open Connect, then use the referral note.");
  }

  function showConnectStatus(text) {
    let status = document.getElementById(CONNECT_STATUS_ID);
    if (!status) {
      status = document.createElement("div");
      status.id = CONNECT_STATUS_ID;
      status.className = "lra-connect-intent-status";
      document.body.appendChild(status);
    }

    status.textContent = text;
  }

  function removeConnectStatus() {
    document.getElementById(CONNECT_STATUS_ID)?.remove();
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
      if (checkWeeklyLimitModal(dialog)) {
        throw new Error("Weekly invitation limit hit.");
      }

      const context = await activeOutreachContext();
      const note = personalizeConnectionNote(
        context?.connectionMessage || "",
        recentActiveRecipientName() || extractPersonNameFromDialog(dialog),
      )
        .trim()
        .slice(0, 300);
      if (!note) throw new Error("Missing outreach note.");

      let field = findVisibleNoteTextarea(dialog);
      if (!field) {
        const addNoteButton =
          findAddNoteButton(dialog) ||
          findButtonByText(dialog, /\b(personalize|customize)\b/i);
        if (addNoteButton) clickElement(addNoteButton);
        field = await waitForNoteTextField(dialog, 3000);
      }
      if (!field) {
        // Retry once: occasionally the first "Add a note" click is swallowed
        // during modal mount.
        await sleep(400);
        const retryAddNote = findAddNoteButton(dialog);
        if (retryAddNote) clickElement(retryAddNote);
        field = await waitForNoteTextField(dialog, 2000);
      }

      if (!field) throw new Error("No note field.");

      fillTextField(field, note);
      try { field.focus(); } catch (_) {}
      clearConnectIntent();
      showConnectStatus("Connect + Note: note filled. Click Send.");
      helper.textContent = "Note filled";
      onModalNoteFilled(dialog);
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
    return findButtonByText(dialog, /\b(add\s+(?:a\s+)?note|personalize|customize)\b/i);
  }

  function findNoteTextField(dialog) {
    // Kept for backward compat. Prefer findVisibleNoteTextarea, which rejects
    // the short filter inputs LinkedIn renders inside the dialog footer.
    return findVisibleNoteTextarea(dialog);
  }

  function findVisibleNoteTextarea(dialog) {
    if (!dialog) return null;
    const fields = Array.from(
      dialog.querySelectorAll(
        "textarea[name='message'], textarea#custom-message, textarea, [contenteditable='true']",
      ),
    );
    return (
      fields.find((field) => {
        if (!isVisible(field)) return false;
        const rect = field.getBoundingClientRect();
        // The note field is tall (>=60px). Plain <input type=text> filters are short.
        return rect.height >= 60;
      }) || null
    );
  }

  async function waitForNoteTextField(dialog, timeoutMs = 1800) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const field = findVisibleNoteTextarea(dialog);
      if (field) return field;
      await sleep(100);
    }

    return null;
  }

  async function onModalNoteFilled(dialog) {
    if (checkWeeklyLimitModal(dialog)) return;
    const stats = await inviteStats();
    const now = new Date();
    const today = todayKey(now);
    const week = weekStartKey(now);
    if (stats.todayDate !== today) {
      stats.todayDate = today;
      stats.todayCount = 0;
    }
    if (stats.weekStart !== week) {
      stats.weekStart = week;
      stats.weekCount = 0;
    }
    stats.todayCount += 1;
    stats.weekCount += 1;
    stats.lastSentAt = Date.now();
    lastSentAtMs = stats.lastSentAt;
    await writeInviteStats(stats);
    const settings = await inviteSettings();
    currentJitterMs = Math.floor(Math.random() * settings.maxJitterMs);
    refreshRateBanner();
    markCooldownVisuals();
    scheduleCooldownTick();
  }

  function fillTextField(field, text) {
    if (field.isContentEditable || field.matches("[contenteditable='true']")) {
      field.focus();
      field.textContent = text;
      try {
        field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
      } catch (_) {}
      field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const prototype =
      field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    field.focus();
    // Use the native setter to bypass React's controlled-input check so the
    // value sticks. Then fire input/change so React's onChange handler reads
    // the new value and updates its internal state.
    if (setter) {
      setter.call(field, text);
    } else {
      field.value = text;
    }
    try {
      field.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
    } catch (_) {}
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    // Some React-controlled fields snap back if the cursor isn't placed.
    try {
      if (typeof field.setSelectionRange === "function") {
        field.setSelectionRange(text.length, text.length);
      }
    } catch (_) {}
    // Verify and retry once if React clobbered the value.
    if (field.value !== text) {
      if (setter) setter.call(field, text);
      else field.value = text;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  async function activeOutreachContext() {
    const result = await storageGet(ACTIVE_OUTREACH_CONTEXT_KEY);
    return result?.[ACTIVE_OUTREACH_CONTEXT_KEY] || null;
  }

  // ----- Invite stats / settings / throttle ------------------------------------------------

  function todayKey(now = new Date()) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function weekStartKey(now = new Date()) {
    // Monday-anchored week start in local time. JS getDay(): 0 = Sun..6 = Sat.
    const day = now.getDay();
    const daysBackToMonday = (day + 6) % 7; // Mon->0, Tue->1,... Sun->6
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBackToMonday);
    return todayKey(monday);
  }

  function emptyStats() {
    const now = new Date();
    return {
      todayDate: todayKey(now),
      todayCount: 0,
      weekStart: weekStartKey(now),
      weekCount: 0,
      lastSentAt: 0,
    };
  }

  function normalizeStats(raw) {
    const now = new Date();
    const stats = { ...emptyStats(), ...(raw || {}) };
    const today = todayKey(now);
    const week = weekStartKey(now);
    if (stats.todayDate !== today) {
      stats.todayDate = today;
      stats.todayCount = 0;
    }
    if (stats.weekStart !== week) {
      stats.weekStart = week;
      stats.weekCount = 0;
    }
    stats.todayCount = Math.max(0, Number(stats.todayCount) || 0);
    stats.weekCount = Math.max(0, Number(stats.weekCount) || 0);
    stats.lastSentAt = Math.max(0, Number(stats.lastSentAt) || 0);
    return stats;
  }

  async function inviteStats() {
    const result = await storageGet(INVITE_STATS_KEY);
    const stats = normalizeStats(result?.[INVITE_STATS_KEY]);
    cachedStats = stats;
    lastSentAtMs = stats.lastSentAt;
    return stats;
  }

  function inviteStatsSnapshot() {
    return cachedStats ? { ...cachedStats } : normalizeStats(null);
  }

  async function writeInviteStats(stats) {
    cachedStats = stats;
    await storageSet({ [INVITE_STATS_KEY]: stats });
  }

  async function adjustInviteCount(delta) {
    const stats = await inviteStats();
    stats.todayCount = Math.max(0, stats.todayCount + delta);
    stats.weekCount = Math.max(0, stats.weekCount + delta);
    await writeInviteStats(stats);
    refreshRateBanner();
  }

  async function resetInviteWindow(scope) {
    const stats = await inviteStats();
    if (scope === "today" || scope === "all") stats.todayCount = 0;
    if (scope === "week" || scope === "all") stats.weekCount = 0;
    await writeInviteStats(stats);
    refreshRateBanner();
  }

  async function inviteSettings() {
    const result = await storageGet(INVITE_SETTINGS_KEY);
    const settings = { ...DEFAULT_SETTINGS, ...(result?.[INVITE_SETTINGS_KEY] || {}) };
    settings.dailyCap = Math.max(1, Number(settings.dailyCap) || DEFAULT_SETTINGS.dailyCap);
    settings.weeklyCap = Math.max(1, Number(settings.weeklyCap) || DEFAULT_SETTINGS.weeklyCap);
    settings.minDelayMs = Math.max(0, Number(settings.minDelayMs) || DEFAULT_SETTINGS.minDelayMs);
    settings.maxJitterMs = Math.max(0, Number(settings.maxJitterMs) || DEFAULT_SETTINGS.maxJitterMs);
    cachedSettings = settings;
    return settings;
  }

  function inviteSettingsSnapshot() {
    return cachedSettings ? { ...cachedSettings } : { ...DEFAULT_SETTINGS };
  }

  async function writeInviteSettings(patch) {
    const current = await inviteSettings();
    const next = { ...current, ...patch };
    cachedSettings = next;
    await storageSet({ [INVITE_SETTINGS_KEY]: next });
    refreshRateBanner();
    return next;
  }

  async function loadWeeklyBlock() {
    const result = await storageGet(WEEKLY_BLOCK_KEY);
    cachedWeeklyBlockUntil = Number(result?.[WEEKLY_BLOCK_KEY] || 0);
    return cachedWeeklyBlockUntil;
  }

  function isWeeklyBlocked() {
    return cachedWeeklyBlockUntil > Date.now();
  }

  async function setWeeklyBlock(durationMs = 7 * 24 * 60 * 60 * 1000) {
    const until = Date.now() + durationMs;
    cachedWeeklyBlockUntil = until;
    await storageSet({ [WEEKLY_BLOCK_KEY]: until });
    refreshRateBanner();
    injectSearchResultHelpers();
  }

  async function clearWeeklyBlock() {
    cachedWeeklyBlockUntil = 0;
    await storageRemove(WEEKLY_BLOCK_KEY);
    refreshRateBanner();
    injectSearchResultHelpers();
  }

  function remainingCooldownMs() {
    const settings = inviteSettingsSnapshot();
    const due = lastSentAtMs + settings.minDelayMs + currentJitterMs;
    return Math.max(0, due - Date.now());
  }

  function scheduleCooldownTick() {
    if (cooldownTickTimer) return;
    cooldownTickTimer = window.setInterval(() => {
      const remaining = remainingCooldownMs();
      updateCooldownLabels(remaining);
      if (remaining <= 0) {
        window.clearInterval(cooldownTickTimer);
        cooldownTickTimer = 0;
        injectSearchResultHelpers();
      }
    }, 500);
    updateCooldownLabels(remainingCooldownMs());
  }

  function updateCooldownLabels(remainingMs) {
    const seconds = Math.ceil(remainingMs / 1000);
    document.querySelectorAll(`.${ROW_BUTTON_CLASS}[data-cooldown="true"]`).forEach((btn) => {
      btn.textContent = remainingMs > 0 ? `Wait ${seconds}s...` : "Connect + Note";
      if (remainingMs <= 0) {
        btn.disabled = false;
        delete btn.dataset.cooldown;
      }
    });
  }

  function markCooldownVisuals() {
    document.querySelectorAll(`.${ROW_BUTTON_CLASS}`).forEach((btn) => {
      if (btn.dataset.state === "restricted") return;
      btn.disabled = true;
      btn.dataset.cooldown = "true";
    });
  }

  // ----- Pending connect intents (cross-tab) -----------------------------------------------

  async function persistConnectIntent(intent) {
    const slug = String(intent?.slug || "").trim();
    if (!slug) return;
    const result = await storageGet(PENDING_INTENTS_KEY);
    const map = result?.[PENDING_INTENTS_KEY] || {};
    map[slug] = {
      name: String(intent.name || "").slice(0, 120),
      profileUrl: canonicalProfileUrlFromHref(intent.profileUrl || "") || String(intent.profileUrl || ""),
      savedAt: Number(intent.savedAt || Date.now()),
    };
    await storageSet({ [PENDING_INTENTS_KEY]: map });
    // Also keep the legacy sessionStorage intent — used by updateProfileConnectStatus.
    rememberConnectIntent({ name: map[slug].name, profileUrl: map[slug].profileUrl, savedAt: map[slug].savedAt });
  }

  async function consumePendingIntent(slug) {
    const safeSlug = String(slug || "").trim();
    if (!safeSlug) return null;
    const result = await storageGet(PENDING_INTENTS_KEY);
    const map = result?.[PENDING_INTENTS_KEY] || {};
    const intent = map[safeSlug];
    if (!intent) return null;
    delete map[safeSlug];
    await storageSet({ [PENDING_INTENTS_KEY]: map });
    if (Date.now() - Number(intent.savedAt || 0) > 10 * 60 * 1000) return null;
    return intent;
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
    if (/no profile URL/i.test(text)) return "No profile";
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

  function profileSlugFromHref(href) {
    try {
      const url = new URL(href, window.location.href);
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

  function canonicalProfileUrlFromHref(href) {
    const slug = profileSlugFromHref(href);
    return slug ? `https://www.linkedin.com/in/${slug}/` : "";
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
        background: #f3f4f6;
        border-color: #cbd5e1;
        color: #64748b;
        cursor: default;
        opacity: 1;
      }

      .${ROW_BUTTON_WRAP_CLASS} {
        align-items: center;
        box-sizing: border-box;
        display: flex;
        flex: 0 0 auto;
        justify-content: flex-end;
        margin: 0 0 0 8px;
        max-width: 190px;
        position: relative;
        width: auto;
        z-index: 5;
      }

      .${ROW_BUTTON_WRAP_CLASS}[data-lra-placement="content"],
      .${ROW_BUTTON_WRAP_CLASS}[data-lra-placement="fallback"] {
        flex-basis: 100%;
        margin: 8px 0 0;
        max-width: none;
        width: 100%;
      }

      .${ROW_BUTTON_CLASS} {
        appearance: none;
        background: #0a66c2;
        border: 1px solid #0a66c2;
        border-radius: 24px;
        color: #fff;
        cursor: pointer;
        display: flex;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        gap: 6px;
        isolation: isolate;
        justify-content: center;
        line-height: 20px;
        max-width: 190px;
        min-height: 36px;
        padding: 8px 16px;
        pointer-events: auto;
        position: relative;
        white-space: nowrap;
        width: auto;
        z-index: 10;
      }

      .${ROW_BUTTON_CLASS}:hover {
        background: #004182;
        border-color: #004182;
      }

      .${ROW_BUTTON_CLASS}[data-state="restricted"],
      .${ROW_BUTTON_CLASS}:disabled {
        background: #f3f4f6;
        border-color: #cbd5e1;
        color: #64748b;
        cursor: not-allowed;
      }

      #${RATE_BANNER_ID}.lra-rate-banner {
        align-items: center;
        background: #111827;
        border-radius: 8px;
        bottom: 16px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.22);
        color: #fff;
        display: flex;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        gap: 10px;
        left: 16px;
        padding: 10px 14px;
        pointer-events: auto;
        position: fixed;
        z-index: 2147483647;
      }

      #${RATE_BANNER_ID}.lra-rate-banner[data-blocked="true"] {
        background: #b91c1c;
      }

      #${RATE_BANNER_ID}.lra-rate-banner .lra-rate-settings {
        appearance: none;
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.6);
        border-radius: 999px;
        color: #fff;
        cursor: pointer;
        font: inherit;
        padding: 2px 10px;
      }

      #${RATE_BANNER_ID}.lra-rate-banner .lra-rate-settings:hover {
        background: rgba(255, 255, 255, 0.16);
      }

      #${SETTINGS_POPOVER_ID}.lra-rate-settings-popover {
        background: #111827;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 10px;
        bottom: 72px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.32);
        color: #fff;
        display: flex;
        flex-direction: column;
        font-family: inherit;
        font-size: 13px;
        gap: 10px;
        left: 16px;
        min-width: 220px;
        padding: 12px 14px;
        position: fixed;
        z-index: 2147483647;
      }

      .lra-rate-settings-heading {
        font-size: 13px;
        font-weight: 700;
      }

      .lra-rate-settings-row {
        align-items: center;
        display: flex;
        font-weight: 600;
        gap: 8px;
        justify-content: space-between;
      }

      .lra-rate-settings-row input[type="number"] {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 6px;
        color: #fff;
        font: inherit;
        padding: 4px 6px;
        width: 72px;
      }

      .lra-rate-settings-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .lra-rate-settings-actions .lra-rate-settings {
        appearance: none;
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.6);
        border-radius: 999px;
        color: #fff;
        cursor: pointer;
        font: inherit;
        padding: 4px 10px;
      }

      .lra-rate-settings-actions .lra-rate-settings:hover {
        background: rgba(255, 255, 255, 0.16);
      }

      #${SEARCH_STATUS_ID}.lra-search-helper-status,
      #${CONNECT_STATUS_ID}.lra-connect-intent-status {
        background: #111827;
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 999px;
        bottom: 16px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
        color: #fff;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        left: 16px;
        line-height: 18px;
        padding: 8px 12px;
        pointer-events: none;
        position: fixed;
        z-index: 2147483647;
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

  // Expose a small surface for tests. Harmless in the browser; consumed by
  // content.test.js via vm.runInNewContext.
  try {
    const target =
      typeof globalThis !== "undefined" ? globalThis :
      typeof window !== "undefined" ? window : null;
    if (target) {
      target.__LRA_TEST__ = {
        EXTENSION_VERSION,
        ROW_BUTTON_CLASS,
        ROW_BUTTON_WRAP_CLASS,
        DEFAULT_SETTINGS,
        findPeopleSearchRows,
        injectSearchResultHelpers,
        getRowKind,
        ensureRowConnectButton,
        handleRowConnectClick,
        fillConnectModalNote,
        findProfileConnectButton,
        profileActionCandidates,
        findNativeConnectAction,
        findVisibleNoteTextarea,
        findAddNoteButton,
        checkWeeklyLimitModal,
        personalizeConnectionNote,
        todayKey,
        weekStartKey,
        normalizeStats,
        inviteStats,
        inviteSettings,
        adjustInviteCount,
        resetInviteWindow,
        onModalNoteFilled,
        remainingCooldownMs,
        isWeeklyBlocked,
        setWeeklyBlock,
        clearWeeklyBlock,
        consumePendingIntent,
        persistConnectIntent,
        getState: () => ({
          lastSentAtMs,
          cachedStats,
          cachedSettings,
          cachedWeeklyBlockUntil,
        }),
        resetState: () => {
          lastSentAtMs = 0;
          currentJitterMs = 0;
          cachedStats = null;
          cachedSettings = null;
          cachedWeeklyBlockUntil = 0;
          inviteContextLoaded = false;
          autoConnectAttempted = false;
        },
      };
    }
  } catch (_) {
    // ignored — test surface is best-effort.
  }
})();
