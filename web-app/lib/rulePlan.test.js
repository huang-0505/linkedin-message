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
  "Hi, I'm Junhui, Brown DS master's focused on AI/LLM systems, built AI platform for construction SaaS and multi-agent DnD AI game. I am applying for AI Engineer at Acme. I'd really appreciate your help with a referral or connecting with the hiring team. Thanks in advance!",
);
assert.ok(aiPlan.targetPeople[0].connectionMessage.length <= 290);

const dataScientistPlan = buildRulePlan({
  jobTitle: "Data Scientist",
  company: "Acme",
});
assert.equal(
  dataScientistPlan.targetPeople[0].connectionMessage,
  "Hi, I'm Junhui, Brown DS master's focused on ML and LLM systems, built an XGBoost model saving ~$2M in cement production and fine-tuned an LLM for a vet-tech startup. I am applying for Data Scientist at Acme. Would appreciate a referral or intro to the hiring team. Thanks!",
);
assert.doesNotMatch(dataScientistPlan.targetPeople[0].connectionMessage, /LLM\/RAG/);
assert.ok(dataScientistPlan.targetPeople[0].connectionMessage.length <= 290);

const fdePlan = buildRulePlan({
  jobTitle: "Forward Deployed Engineer",
  company: "Acme",
});
assert.match(fdePlan.targetPeople[0].connectionMessage, /construction SaaS/);
assert.ok(fdePlan.targetPeople[0].connectionMessage.length <= 290);

const longTitlePlan = buildRulePlan({
  jobTitle: "Senior Forward Deployed Generative AI Solutions Engineer",
  company: "VeryLongEnterpriseCompanyName",
});
assert.ok(longTitlePlan.targetPeople[0].connectionMessage.length <= 290);

console.log("rule plan tests passed");
