const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

Module._extensions[".ts"] = function compileTs(mod, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  mod._compile(compiled.outputText, filename);
};

const { buildRulePlan } = require("./rulePlan.ts");

const aiPlan = buildRulePlan({
  jobTitle: "AI Engineer",
  company: "Acme",
});
assert.equal(
  aiPlan.targetPeople[0].connectionMessage,
  "Hi, I'm Junhui, a Brown DS master's grad focused on ML/LLM and software development. I'm applying for the AI Engineer role at Acme. Do you happen to know the hiring team or referral process? I'd be grateful for any guidance and happy to connect and chat!",
);
assert.ok(aiPlan.targetPeople[0].connectionMessage.length <= 300);

const dataScientistPlan = buildRulePlan({
  jobTitle: "Data Scientist",
  company: "Federal Reserve Bank of Atlanta",
});
assert.equal(
  dataScientistPlan.targetPeople[0].connectionMessage,
  "Hi, I'm Junhui, a Brown DS master's grad focused on ML/LLM and software development. I'm applying for the Data Scientist role at Federal Reserve Bank of Atlanta. Do you happen to know the hiring team or referral process? I'd be grateful for any guidance and happy to connect and chat!",
);
assert.doesNotMatch(dataScientistPlan.targetPeople[0].connectionMessage, /LLM\/RAG/);
assert.ok(dataScientistPlan.targetPeople[0].connectionMessage.length <= 300);

const fdePlan = buildRulePlan({
  jobTitle: "Forward Deployed Engineer",
  company: "Acme",
});
assert.match(
  fdePlan.targetPeople[0].connectionMessage,
  /focused on ML\/LLM and software development/,
);
assert.ok(fdePlan.targetPeople[0].connectionMessage.length <= 300);

const longTitlePlan = buildRulePlan({
  jobTitle: "Senior Forward Deployed Generative AI Solutions Engineer",
  company: "VeryLongEnterpriseCompanyName",
});
assert.ok(longTitlePlan.targetPeople[0].connectionMessage.length <= 300);

console.log("rule plan tests passed");
