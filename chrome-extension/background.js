// background.js — handles page-injected buttons.
//
// The LinkedIn page content script can read the current page, but it cannot
// reliably update an existing localhost tab by itself. This background worker
// owns the tab/open/bridge flow, matching the popup behavior.

importScripts("config.js");

const WEB_APP_URL =
  globalThis.LRA_WEB_APP_URL || "http://localhost:3000/referral";
const MAX_URL_LEN = 7500;
const LINKEDIN_PAGE_ACTION_URLS = [
  "https://*.linkedin.com/jobs/*",
  "https://linkedin.com/jobs/*",
  "https://*.linkedin.com/in/*",
  "https://linkedin.com/in/*",
];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "LRA_OPEN_JOB") {
    openWebApp(message.job)
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

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  injectPageActionIntoOpenLinkedInTabs().catch((error) =>
    console.warn("LinkedIn page action preload failed", error),
  );
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !isLinkedInJobOrProfileUrl(tab.url)) return;
  ensurePageAction(tabId).catch((error) =>
    console.warn("LinkedIn page action inject failed", error),
  );
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs
    .get(tabId)
    .then((tab) => {
      if (!isLinkedInJobOrProfileUrl(tab.url)) return;
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

function buildQueryParams(job) {
  const params = new URLSearchParams();
  if (job.jobTitle) params.set("jobTitle", job.jobTitle);
  if (job.company) params.set("company", job.company);
  if (job.location) params.set("location", job.location);
  if (job.jobUrl) params.set("jobUrl", job.jobUrl);
  if (job.jobDescription) params.set("jobDescription", job.jobDescription.slice(0, 4000));
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

function isLinkedInJobOrProfileUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || "");
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const isLinkedIn = host === "linkedin.com" || host.endsWith(".linkedin.com");
    return isLinkedIn && (parts[0] === "jobs" || (parts[0] === "in" && parts[1]));
  } catch (_) {
    return false;
  }
}
