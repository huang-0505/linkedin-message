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
} = {}) {
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
    querySelectorAll() {
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

console.log("content extraction tests passed");
