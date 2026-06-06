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
  jobHeader = null,
  embeddedSources = [],
} = {}) {
  const titleEl = jobHeader ? makeJobTitleElement(jobHeader) : null;
  const descriptionEl = description
    ? { innerText: description, textContent: description, getBoundingClientRect: visibleRect }
    : null;
  const document = {
    title,
    documentElement: {
      innerHTML: embeddedSources.join("\n"),
    },
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
      if (titleEl && selector === "h1") {
        return [titleEl];
      }
      if (selector === "code, script") {
        return embeddedSources.map((source) => ({
          innerText: source,
          textContent: source,
        }));
      }
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

function makeJobTitleElement(jobHeader) {
  const anchor = {
    href: jobHeader.companyHref,
    innerText: jobHeader.company,
    textContent: jobHeader.company,
    outerHTML: `<a href="${jobHeader.companyHref}">${jobHeader.company}</a>`,
    getAttribute(name) {
      return name === "href" ? jobHeader.companyHref : "";
    },
    getAttributeNames() {
      return ["href"];
    },
    getBoundingClientRect: visibleRect,
  };

  const headerRoot = {
    innerText: [
      jobHeader.jobTitle,
      jobHeader.company,
      jobHeader.location || "New York, NY",
      "Easy Apply",
    ].join("\n"),
    textContent: [
      jobHeader.jobTitle,
      jobHeader.company,
      jobHeader.location || "New York, NY",
      "Easy Apply",
    ].join("\n"),
    outerHTML: `<section><h1>${jobHeader.jobTitle}</h1>${anchor.outerHTML}</section>`,
    parentElement: null,
    closest() {
      return null;
    },
    querySelectorAll(selector) {
      return selector.includes("/company/") || selector.includes("company-name")
        ? [anchor]
        : [];
    },
    getBoundingClientRect: visibleRect,
  };

  return {
    innerText: jobHeader.jobTitle,
    textContent: jobHeader.jobTitle,
    parentElement: headerRoot,
    closest() {
      return headerRoot;
    },
    getBoundingClientRect: visibleRect,
  };
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

const companyIdResult = runContentScript({
  jobHeader: {
    jobTitle: "Engineering Manager",
    company: "Freddie Mac",
    companyHref: "https://www.linkedin.com/company/freddie-mac/",
  },
  embeddedSources: [
    '{"name":"Freddie Mac","entityUrn":"urn:li:fsd_company:1128","url":"https://www.linkedin.com/company/freddie-mac/"}',
  ],
});
assert.equal(companyIdResult.company, "Freddie Mac");
assert.equal(companyIdResult.companyLinkedInId, "1128");
assert.equal(
  companyIdResult.companyLinkedInUrl,
  "https://www.linkedin.com/company/freddie-mac/",
);

console.log("content extraction tests passed");
