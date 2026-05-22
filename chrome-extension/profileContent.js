// profileContent.js — executed only when the user clicks the extension while
// viewing a LinkedIn profile they chose manually.

(() => {
  const cleanText = (s) =>
    (s || "")
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim();

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
    try {
      const url = new URL(window.location.href);
      const parts = url.pathname.split("/").filter(Boolean);
      const inIndex = parts.indexOf("in");
      if (inIndex !== -1 && parts[inIndex + 1]) {
        return `https://www.linkedin.com/in/${parts[inIndex + 1]}/`;
      }
    } catch (_) {}
    return window.location.href.split(/[?#]/)[0];
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

  const headline = pick([
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
})();
