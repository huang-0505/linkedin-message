// background.js — handles page-injected buttons.
//
// The LinkedIn page content script can read the current page, but it cannot
// reliably update an existing localhost tab by itself. This background worker
// owns the tab/open/bridge flow, matching the popup behavior.

importScripts("config.js");

const WEB_APP_URL =
  globalThis.LRA_WEB_APP_URL || "http://localhost:3000/referral";
const MAX_URL_LEN = 7500;
const ACTIVE_OUTREACH_CONTEXT_KEY = "lra:active-outreach-context";
const LINKEDIN_PAGE_ACTION_URLS = [
  "https://*.linkedin.com/jobs/*",
  "https://linkedin.com/jobs/*",
  "https://*.linkedin.com/in/*",
  "https://linkedin.com/in/*",
  "https://*.linkedin.com/search/results/people/*",
  "https://linkedin.com/search/results/people/*",
];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "LRA_OPEN_JOB") {
    openWebApp(message.job)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }

  if (message.type === "LRA_OPEN_CURRENT_JOB") {
    openCurrentJobFromTab(sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }

  if (message.type === "LRA_ADD_PROFILE") {
    addProfileToWebApp(message.contact)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }

  if (message.type === "LRA_REMEMBER_OUTREACH_CONTEXT") {
    rememberOutreachContext(message.context)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }

  if (message.type === "LRA_OPEN_PROFILE_TAB") {
    openProfileTab(message.url)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }

  if (message.type === "LRA_STORAGE_GET") {
    storageGet(message.key)
      .then((values) => sendResponse({ ok: true, values }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }

  if (message.type === "LRA_STORAGE_SET") {
    storageSet(message.values)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }

  if (message.type === "LRA_STORAGE_REMOVE") {
    storageRemove(message.key)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }

  return false;
});

async function storageGet(key) {
  if (!isSafeStorageKeyInput(key)) throw new Error("Invalid storage key.");
  return chrome.storage.local.get(key);
}

async function storageSet(values) {
  if (!isSafeStorageValues(values)) throw new Error("Invalid storage values.");
  await chrome.storage.local.set(values);
}

async function storageRemove(key) {
  if (!isSafeStorageKeyInput(key)) throw new Error("Invalid storage key.");
  await chrome.storage.local.remove(key);
}

function isSafeStorageValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return false;
  return Object.keys(values).every(isLraStorageKey);
}

function isSafeStorageKeyInput(key) {
  if (typeof key === "string") return isLraStorageKey(key);
  if (Array.isArray(key)) return key.every(isLraStorageKey);
  if (key && typeof key === "object") return Object.keys(key).every(isLraStorageKey);
  return false;
}

function isLraStorageKey(key) {
  return typeof key === "string" && key.startsWith("lra:");
}

async function openProfileTab(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!/^https:\/\/(www\.|)linkedin\.com\/in\//.test(url)) {
    throw new Error("Invalid LinkedIn profile URL.");
  }
  await chrome.tabs.create({ url, active: true });
  console.info("[CN] profile opened", { url });
}

chrome.runtime.onInstalled.addListener(() => {
  injectPageActionIntoOpenLinkedInTabs().catch((error) =>
    console.warn("LinkedIn page action preload failed", error),
  );
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!isLinkedInActionUrl(tab.url)) return;
  if (info.status !== "loading" && info.status !== "complete") return;
  ensurePageAction(tabId).catch((error) =>
    console.warn("LinkedIn page action inject failed", error),
  );
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs
    .get(tabId)
    .then((tab) => {
      if (!isLinkedInActionUrl(tab.url)) return;
      return ensurePageAction(tabId);
    })
    .catch((error) =>
      console.warn("LinkedIn page action activation inject failed", error),
    );
});

async function openWebApp(job) {
  if (!job || (!job.jobTitle && !job.company)) {
    throw new Error("Couldn't read the selected LinkedIn job.");
  }

  const params = buildQueryParams(job);
  const fullUrl = `${WEB_APP_URL}?${params.toString()}`;

  if (fullUrl.length <= MAX_URL_LEN) {
    await chrome.tabs.create({ url: fullUrl });
    return;
  }

  await chrome.storage.local.set({ "lra:incoming-job": job });

  const newTab = await chrome.tabs.create({
    url: `${WEB_APP_URL}?source=extension`,
  });
  if (!newTab?.id) return;

  const tabId = newTab.id;
  chrome.tabs.onUpdated.addListener(function listener(updatedId, info) {
    if (updatedId === tabId && info.status === "complete") {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.scripting
        .executeScript({
          target: { tabId },
          func: jobBridgeFn,
          args: [job],
        })
        .then(() => chrome.tabs.reload(tabId))
        .catch((error) => console.warn("job bridge inject failed", error));
    }
  });
}

async function openCurrentJobFromTab(tabId) {
  if (!tabId) {
    throw new Error("Couldn't read the active LinkedIn tab.");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  const job = results?.[0]?.result;
  if (!job || (!job.jobTitle && !job.company)) {
    throw new Error("Couldn't read the selected LinkedIn job.");
  }

  await openWebApp(job);
}

async function rememberOutreachContext(context) {
  if (!isValidOutreachContext(context)) {
    throw new Error("Missing outreach note.");
  }

  await chrome.storage.local.set({
    [ACTIVE_OUTREACH_CONTEXT_KEY]: {
      category: String(context.category || "").slice(0, 120),
      searchQuery: String(context.searchQuery || "").slice(0, 240),
      connectionMessage: String(context.connectionMessage || "").slice(0, 1200),
      savedAt: Date.now(),
    },
  });
}

function isValidOutreachContext(context) {
  return Boolean(
    context &&
      typeof context === "object" &&
      typeof context.connectionMessage === "string" &&
      context.connectionMessage.trim(),
  );
}

function buildQueryParams(job) {
  const params = new URLSearchParams();
  if (job.jobTitle) params.set("jobTitle", job.jobTitle);
  if (job.company) params.set("company", job.company);
  if (job.companyLinkedInId) params.set("companyLinkedInId", job.companyLinkedInId);
  if (job.companyLinkedInUrl) params.set("companyLinkedInUrl", job.companyLinkedInUrl);
  if (job.location) params.set("location", job.location);
  if (job.jobUrl) params.set("jobUrl", job.jobUrl);
  if (job.jobDescription) params.set("jobDescription", job.jobDescription.slice(0, 4000));
  if (job.sponsorshipStatus) params.set("sponsorshipStatus", job.sponsorshipStatus);
  if (job.sponsorshipEvidence) {
    params.set("sponsorshipEvidence", job.sponsorshipEvidence.slice(0, 400));
  }
  return params;
}

function jobBridgeFn(job) {
  try {
    window.localStorage.setItem("lra:incoming-job", JSON.stringify(job));
  } catch (error) {
    console.warn("job bridge set failed", error);
  }
}

async function addProfileToWebApp(contact) {
  if (!contact?.name || !contact.profileUrl) {
    throw new Error("Couldn't read this LinkedIn profile.");
  }

  const existingTabs = await chrome.tabs.query({
    url: referralTabUrlPattern(),
  });
  const existingTab = existingTabs.find((tab) => tab.id);

  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, { active: true });
    await injectContactBridge(existingTab.id, contact);
    return;
  }

  const newTab = await chrome.tabs.create({ url: WEB_APP_URL });
  if (!newTab?.id) return;

  const tabId = newTab.id;
  chrome.tabs.onUpdated.addListener(function listener(updatedId, info) {
    if (updatedId === tabId && info.status === "complete") {
      chrome.tabs.onUpdated.removeListener(listener);
      injectContactBridge(tabId, contact).catch((error) =>
        console.warn("contact bridge inject failed", error),
      );
    }
  });
}

function referralTabUrlPattern() {
  try {
    return `${new URL(WEB_APP_URL).origin}/referral*`;
  } catch (_) {
    return "http://localhost:3000/referral*";
  }
}

async function injectContactBridge(tabId, contact) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: contactBridgeFn,
    args: [contact],
  });
}

function contactBridgeFn(contact) {
  try {
    window.localStorage.setItem("lra:incoming-contact", JSON.stringify(contact));
    window.dispatchEvent(
      new CustomEvent("lra:add-contact", {
        detail: contact,
      }),
    );
  } catch (error) {
    console.warn("contact bridge set failed", error);
  }
}

async function injectPageActionIntoOpenLinkedInTabs() {
  const tabs = await chrome.tabs.query({ url: LINKEDIN_PAGE_ACTION_URLS });
  await Promise.all(
    tabs
      .filter((tab) => tab.id)
      .map((tab) =>
        ensurePageAction(tab.id).catch((error) =>
          console.warn("LinkedIn page action tab inject failed", error),
        ),
      ),
  );
}

async function ensurePageAction(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["pageAction.js"],
  });
}

function isLinkedInActionUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || "");
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const isLinkedIn = host === "linkedin.com" || host.endsWith(".linkedin.com");
    if (!isLinkedIn) return false;
    if (parts[0] === "jobs") return true;
    if (parts[0] === "in" && parts[1]) return true;
    return parts[0] === "search" && parts[1] === "results" && parts[2] === "people";
  } catch (_) {
    return false;
  }
}
