const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "jobText.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

const sandboxModule = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  exports: sandboxModule.exports,
  module: sandboxModule,
  require,
  URL,
});

const { analyzeSponsorship, inferJobTitleFromDescription, inferJobTitleFromUrl } =
  sandboxModule.exports;

assert.equal(inferJobTitleFromDescription("As a Data Scientist, you will build models."), "Data Scientist");
assert.equal(
  inferJobTitleFromUrl("https://www.linkedin.com/jobs/view/data-scientist-at-telligen-4419440543"),
  "Data Scientist",
);

[
  "Applicants must be currently authorized to work in the United States without employer sponsorship now or in the future.",
  "We are unable to sponsor or take over sponsorship of an employment visa at this time.",
  "This role does not offer visa sponsorship or visa transfers.",
  "Candidates requiring CPT, OPT, H-1B, TN, or other work authorization sponsorship are not eligible.",
  "U.S. citizenship is required because this position needs an active Secret clearance.",
  "Must be a U.S. Citizen or lawful permanent resident due to ITAR export-control requirements.",
].forEach((text) => {
  const result = analyzeSponsorship(text);
  assert.equal(result.status, "no_sponsorship", text);
  assert.ok(result.evidence.length > 0, text);
});

[
  "Visa sponsorship is available for this position.",
  "We will sponsor H-1B and support green card sponsorship for qualified candidates.",
  "OPT/CPT candidates are welcome and STEM OPT extension is supported.",
  "Open to H1B transfer, TN visa sponsorship, and immigration sponsorship.",
  "Relocation and visa support provided.",
].forEach((text) => {
  const result = analyzeSponsorship(text);
  assert.equal(result.status, "sponsors", text);
  assert.ok(result.evidence.length > 0, text);
});

[
  "",
  "Telligen is an equal opportunity employer.",
  "Applicants must be legally authorized to work in the United States.",
  "Work authorization is required.",
].forEach((text) => {
  const result = analyzeSponsorship(text);
  assert.equal(result.status, "unknown", text);
  assert.equal(result.evidence, "", text);
});

console.log("job text tests passed");
