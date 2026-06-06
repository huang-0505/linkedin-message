// popup.js — wires the "Find Referral" button.
//
// Flow:
// 1. Verify the active tab is a LinkedIn job page.
// 2. Inject content.js into that tab (chrome.scripting.executeScript).
// 3. content.js extracts job fields and returns them.
// 4. Open the configured referral web app URL, passing the data via:
//    - URL query params if short enough, OR
//    - chrome.storage.local + a tiny bridge script that copies it into
//      window.localStorage on the web-app origin so the page can read it.

const WEB_APP_URL =
  globalThis.LRA_WEB_APP_URL || "http://localhost:3000/referral";
const MAX_URL_LEN = 7500; // safe-ish cap below the ~8k browser URL limit

const btn = document.getElementById("findBtn");
const statusEl = document.getElementById("status");
const descriptionEl = document.getElementById("description");

initPopup();

btn.addEventListener("click", async () => {
  btn.disabled = true;
  try {
    const tab = await getActiveTab();
    if (isLinkedInJobUrl(tab.url)) {
      await handleJobPage(tab);
      return;
    }
    if (isLinkedInProfileUrl(tab.url)) {
      await handleProfilePage(tab);
      return;
    }
    if (isLinkedInPeopleSearchUrl(tab.url)) {
      throw new Error(
        "Open a person's LinkedIn profile from these search results, then click the extension again to add that profile.",
      );
    }

    throw new Error(
      "Open a LinkedIn job page or a LinkedIn profile page, then try again.",
    );
  } catch (err) {
    console.error(err);
    setStatus(err?.message || String(err), true);
  } finally {
    btn.disabled = false;
  }
});

async function initPopup() {
  try {
    const tab = await getActiveTab();
    btn.disabled = false;
    if (isLinkedInProfileUrl(tab.url)) {
      btn.textContent = "Add Profile to Referral Panel";
      descriptionEl.textContent =
        "Adds the LinkedIn profile you chose to your local referral contact list.";
      return;
    }
    if (isLinkedInPeopleSearchUrl(tab.url)) {
      btn.textContent = "Open a Profile First";
      btn.disabled = true;
      descriptionEl.textContent =
        "Click a person's name in the search results, then use this extension on their profile page.";
      setStatus(
        "This avoids scraping search results. Add people one profile at a time.",
      );
      return;
    }
    btn.textContent = "Find Referral";
    descriptionEl.textContent =
      `Reads this LinkedIn job page, then opens ${webAppHostLabel()}.`;
  } catch {
    // The click handler will show the actionable error.
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id || !tab.url) throw new Error("No active tab.");
  return tab;
}

async function handleJobPage(tab) {
  setStatus("Reading the current job page…");

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });

  const job = results?.[0]?.result;
  if (!job || (!job.jobTitle && !job.company)) {
    throw new Error(
      "Couldn't read the selected LinkedIn job.\nRefresh LinkedIn, click the job once so its details are visible, then click Find Referral again.",
    );
  }

  await openWebApp(job);
  const note =
    !job.company || !job.jobTitle
      ? " (some fields missing — edit them on the page)"
      : "";
  setStatus(`Opened the Referral page ✓${note}`);
}

async function handleProfilePage(tab) {
  setStatus("Reading this profile…");

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["profileContent.js"],
  });

  const contact = results?.[0]?.result;
  if (!contact?.name || !contact.profileUrl) {
    throw new Error(
      "Couldn't read this LinkedIn profile. Wait for the profile header to load, then try again.",
    );
  }

  await addProfileToWebApp(contact);
  setStatus(`Added ${contact.name} ✓`);
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.className = "status" + (isError ? " err" : "");
}

function isLinkedInJobUrl(url) {
  // Any LinkedIn jobs URL is fine — standalone job page, search list, the new
  // search-results layout, or collections. The content script will figure out
  // which job is currently selected.
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      (host === "linkedin.com" || host.endsWith(".linkedin.com")) &&
      parsed.pathname.startsWith("/jobs/")
    );
  } catch {
    return false;
  }
}

function isLinkedInProfileUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    return (
      (host === "linkedin.com" || host.endsWith(".linkedin.com")) &&
      parts[0] === "in" &&
      Boolean(parts[1])
    );
  } catch {
    return false;
  }
}

function isLinkedInPeopleSearchUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      (host === "linkedin.com" || host.endsWith(".linkedin.com")) &&
      parsed.pathname.startsWith("/search/results/people")
    );
  } catch {
    return false;
  }
}

async function openWebApp(job) {
  const params = buildQueryParams(job);
  const fullUrl = `${WEB_APP_URL}?${params.toString()}`;

  if (fullUrl.length <= MAX_URL_LEN) {
    await chrome.tabs.create({ url: fullUrl });
    return;
  }

  // Long job description path: stash in chrome.storage.local, then open the
  // web app with source=extension. After the page loads, inject a tiny bridge
  // that copies the data into window.localStorage on the web-app origin so the
  // page can read it.
  await chrome.storage.local.set({ "lra:incoming-job": job });

  const shortUrl = `${WEB_APP_URL}?source=extension`;
  const newTab = await chrome.tabs.create({ url: shortUrl });
  if (!newTab?.id) return;

  // Wait for the tab to finish loading, then inject the bridge.
  const tabId = newTab.id;
  chrome.tabs.onUpdated.addListener(function listener(updatedId, info) {
    if (updatedId === tabId && info.status === "complete") {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.scripting
        .executeScript({
          target: { tabId },
          func: bridgeFn,
          args: [job],
        })
        .then(() => {
          // The page reads the bridge value on mount; reload to trigger the
          // initial read via the same code path the params take.
          chrome.tabs.reload(tabId);
        })
        .catch((e) => console.warn("bridge inject failed", e));
    }
  });
}

function buildQueryParams(job) {
  const params = new URLSearchParams();
  if (job.jobTitle) params.set("jobTitle", job.jobTitle);
  if (job.company) params.set("company", job.company);
  if (job.companyLinkedInId) params.set("companyLinkedInId", job.companyLinkedInId);
  if (job.companyLinkedInUrl) params.set("companyLinkedInUrl", job.companyLinkedInUrl);
  if (job.location) params.set("location", job.location);
  if (job.jobUrl) params.set("jobUrl", job.jobUrl);
  if (job.jobDescription) {
    // Keep query string short; the textarea on the page is editable so the
    // user can paste more if they need it.
    params.set("jobDescription", job.jobDescription.slice(0, 4000));
  }
  if (job.sponsorshipStatus) params.set("sponsorshipStatus", job.sponsorshipStatus);
  if (job.sponsorshipEvidence) {
    params.set("sponsorshipEvidence", job.sponsorshipEvidence.slice(0, 400));
  }
  return params;
}

// Runs INSIDE the web-app tab. Writes job data into window.localStorage so the
// /referral page can pick it up via the bridge key.
function bridgeFn(job) {
  try {
    window.localStorage.setItem("lra:incoming-job", JSON.stringify(job));
  } catch (e) {
    console.warn("bridge set failed", e);
  }
}

async function addProfileToWebApp(contact) {
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
      injectContactBridge(tabId, contact).catch((e) =>
        console.warn("contact bridge inject failed", e),
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

function webAppHostLabel() {
  try {
    return new URL(WEB_APP_URL).host;
  } catch (_) {
    return WEB_APP_URL;
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
  } catch (e) {
    console.warn("contact bridge set failed", e);
  }
}
