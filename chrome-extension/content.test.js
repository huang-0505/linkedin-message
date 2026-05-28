const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const contentScript = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");

function runContentScript({
  title = "",
  href = "https://www.linkedin.com/jobs/view/4419440543/",
  meta = {},
  canonical = "",
  description = "",
} = {}) {
  const descriptionEl = description
    ? { innerText: description, textContent: description, getBoundingClientRect: visibleRect }
    : null;
  const document = {
    title,
    innerText: "",
    textContent: "",
    querySelector(selector) {
      if (selector === "link[rel='canonical']" && canonical) {
        return {
          href: canonical,
          getAttribute(name) {
            return name === "href" ? canonical : "";
          },
        };
      }

      const metaMatch = selector.match(/^meta\[(?:property|name)='([^']+)'\]$/);
      if (metaMatch && meta[metaMatch[1]]) {
        return {
          getAttribute(name) {
            return name === "content" ? meta[metaMatch[1]] : "";
          },
        };
      }

      return null;
    },
    querySelectorAll(selector) {
      if (
        descriptionEl &&
        [
          "#job-details",
          ".jobs-description__content .jobs-box__html-content",
          ".jobs-description-content__text",
          ".jobs-description__container",
          ".jobs-description",
          ".description__text",
          "[class*='jobs-description']",
        ].includes(selector)
      ) {
        return [descriptionEl];
      }
      return [];
    },
  };

  return vm.runInNewContext(contentScript, {
    document,
    window: { location: { href } },
    URL,
    console,
  });
}

function visibleRect() {
  return { width: 100, height: 100 };
}

const titleResult = runContentScript({
  title: "Telligen hiring Data Scientist in Montana, United States | LinkedIn",
});
assert.equal(titleResult.jobTitle, "Data Scientist");

const descriptionResult = runContentScript({
  title: "LinkedIn",
  meta: {
    description:
      "Posted 3:45:47 PM. As a Data Scientist, you will work in collaboration with Telligen team members.",
  },
});
assert.equal(descriptionResult.jobTitle, "Data Scientist");

const canonicalResult = runContentScript({
  title: "LinkedIn",
  canonical:
    "https://www.linkedin.com/jobs/view/data-scientist-at-telligen-4419440543",
});
assert.equal(canonicalResult.jobTitle, "Data Scientist");

const noSponsorshipResult = runContentScript({
  description:
    "Applicants must be authorized to work in the United States without employer sponsorship now or in the future.",
});
assert.equal(noSponsorshipResult.sponsorshipStatus, "no_sponsorship");
assert.match(noSponsorshipResult.sponsorshipEvidence, /without employer sponsorship/i);

const sponsorsResult = runContentScript({
  description:
    "Visa sponsorship is available for this position, including H-1B transfers for qualified candidates.",
});
assert.equal(sponsorsResult.sponsorshipStatus, "sponsors");
assert.match(sponsorsResult.sponsorshipEvidence, /visa sponsorship is available/i);

const unknownResult = runContentScript({
  description:
    "Applicants must be legally authorized to work in the United States. Telligen is an equal opportunity employer.",
});
assert.equal(unknownResult.sponsorshipStatus, "unknown");
assert.equal(unknownResult.sponsorshipEvidence, "");

console.log("content extraction tests passed");
