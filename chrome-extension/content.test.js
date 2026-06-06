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

// =========================================================================
// pageAction.js tests — search-row injection, modal flow, rate limiting.
// =========================================================================

const pageActionScript = fs.readFileSync(
  path.join(__dirname, "pageAction.js"),
  "utf8",
);

function makeRect(width = 600, height = 100) {
  return { width, height, top: 0, left: 0, bottom: height, right: width };
}

function mkButton({ label = "", visible = true } = {}) {
  const button = {
    tagName: "BUTTON",
    nodeType: 1,
    classList: makeClassList(),
    dataset: {},
    style: {},
    attributes: { "aria-label": label, title: "" },
    innerText: label,
    textContent: label,
    parentElement: null,
    children: [],
    previousElementSibling: null,
    disabled: false,
    type: "button",
    matches() { return false; },
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, fn) { (this.listeners ||= {})[type] = fn; },
    appendChild() {},
    insertBefore() {},
    contains(node) { return node === this; },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect: () => (visible ? makeRect(120, 36) : makeRect(0, 0)),
    dispatchEvent() {},
    click() { this.clicked = (this.clicked || 0) + 1; },
    focus() { this.focused = true; },
  };
  return button;
}

function mkLink({ href = "https://www.linkedin.com/in/jane-doe/", text = "Jane Doe", visible = true } = {}) {
  return {
    tagName: "A",
    nodeType: 1,
    href,
    innerText: text,
    textContent: text,
    classList: makeClassList(),
    dataset: {},
    style: {},
    attributes: { href, "aria-label": "", title: "" },
    getAttribute(name) { return name === "href" ? href : this.attributes[name] || null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener() {},
    contains(node) { return node === this; },
    closest() { return null; },
    matches() { return false; },
    getBoundingClientRect: () => (visible ? makeRect(120, 24) : makeRect(0, 0)),
    parentElement: null,
  };
}

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...names) { names.forEach((n) => set.add(n)); },
    remove(...names) { names.forEach((n) => set.delete(n)); },
    contains(name) { return set.has(name); },
    toggle(name, force) {
      if (force === true) { set.add(name); return true; }
      if (force === false) { set.delete(name); return false; }
      if (set.has(name)) { set.delete(name); return false; }
      set.add(name); return true;
    },
    get length() { return set.size; },
    values() { return Array.from(set); },
  };
}

function mkRow({
  href = "https://www.linkedin.com/in/jane-doe/",
  buttons = [],
  text = "Jane Doe • 3rd",
  attrs = {},
} = {}) {
  const link = mkLink({ href, text: "Jane Doe" });
  const containerChildren = [link, ...buttons];
  const row = {
    tagName: "DIV",
    nodeType: 1,
    classList: makeClassList(),
    dataset: {},
    attributes: { ...attrs },
    style: {},
    innerText: text,
    textContent: text,
    children: containerChildren,
    parentElement: null,
    matches(selector) {
      if (selector?.includes("[data-view-name='search-entity-result-universal-template']")) {
        return Boolean(attrs["data-view-name"]);
      }
      return false;
    },
    closest() { return null; },
    contains(node) { return containerChildren.includes(node) || node === row; },
    addEventListener() {},
    insertBefore(newChild, refChild) {
      const idx = refChild ? containerChildren.indexOf(refChild) : containerChildren.length;
      containerChildren.splice(idx, 0, newChild);
      newChild.parentElement = row;
      return newChild;
    },
    appendChild(child) {
      containerChildren.push(child);
      child.parentElement = row;
      return child;
    },
    removeChild(child) {
      const idx = containerChildren.indexOf(child);
      if (idx !== -1) containerChildren.splice(idx, 1);
    },
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getBoundingClientRect: () => makeRect(720, 120),
    querySelector(selector) {
      const results = this.querySelectorAll(selector);
      return results[0] || null;
    },
    querySelectorAll(selector) {
      const parts = selector.split(",").map((s) => s.trim());
      const results = [];
      for (const part of parts) {
        if (part === "a[href*=\"/in/\"]" || part.includes("a[href*=\"/in/\"]")) {
          if (link.href.includes("/in/")) results.push(link);
        }
        if (part === "button, a[role='button']" || part === "button" || part.startsWith("button")) {
          for (const child of containerChildren) {
            if (child.tagName === "BUTTON") results.push(child);
          }
        }
        if (part.includes(".lra-row-connect-button-wrap") || part.includes("lra-row-connect-button")) {
          for (const child of containerChildren) {
            if (child.className?.includes?.("lra-row-connect-button")) results.push(child);
          }
        }
        if (part.includes(".entity-result__actions") || part.includes(".search-result__actions")) {
          // No special actions strip in mock — fall through to row itself in caller.
        }
      }
      return results;
    },
  };
  containerChildren.forEach((c) => (c.parentElement = row));
  return row;
}

function makePeopleSearchDocument({ rows = [], dialog = null, useFallbackSelector = false } = {}) {
  const body = {
    tagName: "BODY",
    nodeType: 1,
    children: [],
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
    },
    classList: makeClassList(),
  };
  const main = {
    tagName: "MAIN",
    nodeType: 1,
    children: rows,
    querySelectorAll(selector) {
      if (useFallbackSelector) {
        if (selector.includes(".reusable-search__result-container")) return rows;
        if (selector.includes("[data-view-name='search-entity-result-universal-template']")) return [];
      } else {
        if (selector.includes("[data-view-name='search-entity-result-universal-template']")) return rows;
        if (selector.includes(".reusable-search__result-container")) return [];
      }
      return [];
    },
  };
  rows.forEach((r) => (r.parentElement = main));
  const doc = {
    body,
    documentElement: { appendChild() {}, classList: makeClassList() },
    head: { appendChild() {} },
    title: "LinkedIn",
    elementsById: {},
    querySelector(selector) {
      if (selector === "main") return main;
      if (selector?.startsWith("#")) return this.elementsById[selector.slice(1)] || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector?.includes("[role='dialog']") || selector?.includes(".artdeco-modal")) {
        return dialog ? [dialog] : [];
      }
      if (selector?.includes(`.lra-row-connect-button`)) {
        const all = [];
        for (const row of rows) {
          all.push(...row.querySelectorAll(".lra-row-connect-button"));
        }
        return all;
      }
      return [];
    },
    getElementById(id) { return this.elementsById[id] || null; },
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(),
        nodeType: 1,
        children: [],
        classList: makeClassList(),
        dataset: {},
        attributes: {},
        style: {},
        innerText: "",
        textContent: "",
        innerHTML: "",
        disabled: false,
        type: "",
        listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        removeChild(child) {
          const idx = this.children.indexOf(child);
          if (idx !== -1) this.children.splice(idx, 1);
        },
        insertBefore(child, ref) {
          const idx = ref ? this.children.indexOf(ref) : this.children.length;
          this.children.splice(idx, 0, child);
          child.parentElement = this;
          return child;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getAttribute(name) { return this.attributes[name] ?? null; },
        setAttribute(name, value) {
          this.attributes[name] = String(value);
          if (name === "id") {
            doc.elementsById[value] = this;
          }
        },
        get id() { return this.attributes.id || ""; },
        set id(v) {
          this.attributes.id = String(v);
          doc.elementsById[v] = this;
        },
        get className() { return Array.from(this.classList.values()).join(" "); },
        set className(v) {
          this.classList = makeClassList(String(v).split(/\s+/).filter(Boolean));
        },
        dispatchEvent() {},
        getBoundingClientRect: () => makeRect(120, 36),
        click() { this.clicked = (this.clicked || 0) + 1; },
        focus() { this.focused = true; },
        remove() {
          if (this.parentElement) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx !== -1) this.parentElement.children.splice(idx, 1);
          }
        },
        contains(node) { return node === this; },
      };
      return node;
    },
  };
  return { doc, body, main };
}

function makeChromeStub(initialStorage = {}) {
  const storage = { ...initialStorage };
  return {
    storage,
    runtime: {
      sendMessage: async () => ({ ok: true }),
    },
    local: {
      async get(key) {
        if (Array.isArray(key)) {
          const out = {};
          for (const k of key) out[k] = storage[k];
          return out;
        }
        if (typeof key === "string") return { [key]: storage[key] };
        if (key && typeof key === "object") {
          const out = {};
          for (const k of Object.keys(key)) out[k] = storage[k] ?? key[k];
          return out;
        }
        return { ...storage };
      },
      async set(values) { Object.assign(storage, values); },
      async remove(key) {
        if (Array.isArray(key)) for (const k of key) delete storage[k];
        else delete storage[key];
      },
    },
  };
}

function loadPageAction({ doc, storage = {} }) {
  const chromeStub = (() => {
    const s = { ...storage };
    return {
      storage: { local: {
        async get(key) {
          if (typeof key === "string") return { [key]: s[key] };
          if (Array.isArray(key)) { const o = {}; for (const k of key) o[k] = s[k]; return o; }
          if (key && typeof key === "object") { const o = {}; for (const k of Object.keys(key)) o[k] = s[k] ?? key[k]; return o; }
          return { ...s };
        },
        async set(values) { Object.assign(s, values); },
        async remove(key) {
          if (Array.isArray(key)) for (const k of key) delete s[k];
          else delete s[key];
        },
      }},
      runtime: { sendMessage: async () => ({ ok: true }) },
      __storage: s,
    };
  })();

  const win = {
    location: { href: "https://www.linkedin.com/search/results/people/?keywords=test" },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    open: (url) => ({ url, opened: true }),
    sessionStorage: {
      items: {},
      getItem(k) { return this.items[k] || null; },
      setItem(k, v) { this.items[k] = v; },
      removeItem(k) { delete this.items[k]; },
    },
  };
  win.window = win;

  const context = {
    document: doc,
    window: win,
    chrome: chromeStub,
    URL,
    console,
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    HTMLTextAreaElement: { prototype: {} },
    HTMLInputElement: { prototype: {} },
    Event: function () {},
    InputEvent: function () {},
    MouseEvent: function () {},
    CustomEvent: function () {},
    globalThis: {},
  };
  context.globalThis = context.globalThis;

  vm.runInNewContext(pageActionScript, context);
  return { context, exports: context.globalThis.__LRA_TEST__, chrome: chromeStub };
}

// -- Test 1: row discovery via data-view-name ---------------------------------
{
  const rows = [
    mkRow({ href: "https://www.linkedin.com/in/alpha/", buttons: [mkButton({ label: "Message" }), mkButton({ label: "Connect" })], attrs: { "data-view-name": "search-entity-result-universal-template" } }),
    mkRow({ href: "https://www.linkedin.com/in/beta/", buttons: [mkButton({ label: "Follow" })], attrs: { "data-view-name": "search-entity-result-universal-template" } }),
    mkRow({ href: "https://www.linkedin.com/in/gamma/", buttons: [mkButton({ label: "Connect" })], attrs: { "data-view-name": "search-entity-result-universal-template" } }),
  ];
  const { doc } = makePeopleSearchDocument({ rows });
  const { exports } = loadPageAction({ doc });
  const found = exports.findPeopleSearchRows();
  assert.equal(found.length, 3, "expected 3 rows discovered via data-view-name");
}

// -- Test 2: row discovery via fallback selector -----------------------------
{
  const rows = [
    mkRow({ href: "https://www.linkedin.com/in/alpha/", buttons: [mkButton({ label: "Connect" })] }),
    mkRow({ href: "https://www.linkedin.com/in/beta/", buttons: [mkButton({ label: "Message" })] }),
  ];
  const { doc } = makePeopleSearchDocument({ rows, useFallbackSelector: true });
  const { exports } = loadPageAction({ doc });
  const found = exports.findPeopleSearchRows();
  assert.equal(found.length, 2, "expected 2 rows via fallback selector");
}

// -- Test 3: no 40-row cap ----------------------------------------------------
{
  const rows = [];
  for (let i = 0; i < 60; i += 1) {
    rows.push(mkRow({
      href: `https://www.linkedin.com/in/person-${i}/`,
      buttons: [mkButton({ label: "Connect" })],
      attrs: { "data-view-name": "search-entity-result-universal-template" },
    }));
  }
  const { doc } = makePeopleSearchDocument({ rows });
  const { exports } = loadPageAction({ doc });
  assert.equal(exports.findPeopleSearchRows().length, 60, "expected 60 rows (cap removed)");
}

// -- Test 4: restricted state for "No connect" rows --------------------------
{
  const row = mkRow({
    href: "https://www.linkedin.com/in/restricted/",
    buttons: [mkButton({ label: "No connect" }), mkButton({ label: "Follow" })],
    text: "Ankur Verma • 3rd+ No connect Follow",
  });
  const { doc } = makePeopleSearchDocument({ rows: [row] });
  const { exports } = loadPageAction({ doc });
  assert.equal(exports.getRowKind(row), "restricted", "row with 'No connect' label should be restricted");
}

// -- Test 5: connectable / messageable detection -----------------------------
{
  const connectableRow = mkRow({
    href: "https://www.linkedin.com/in/connect/",
    buttons: [mkButton({ label: "Message" }), mkButton({ label: "Connect" })],
  });
  const messageableRow = mkRow({
    href: "https://www.linkedin.com/in/already/",
    buttons: [mkButton({ label: "Message" })],
  });
  const { doc } = makePeopleSearchDocument({ rows: [connectableRow, messageableRow] });
  const { exports } = loadPageAction({ doc });
  assert.equal(exports.getRowKind(connectableRow), "connectable");
  assert.equal(exports.getRowKind(messageableRow), "messageable");
}

// -- Test 6: normalizeStats date rollover ------------------------------------
{
  const { doc } = makePeopleSearchDocument({ rows: [] });
  const { exports } = loadPageAction({ doc });
  const stale = {
    todayDate: "1999-01-01",
    todayCount: 99,
    weekStart: "1998-12-28",
    weekCount: 42,
    lastSentAt: 0,
  };
  const fresh = exports.normalizeStats(stale);
  assert.equal(fresh.todayCount, 0, "stale day count should reset");
  assert.equal(fresh.weekCount, 0, "stale week count should reset");
  assert.equal(fresh.todayDate, exports.todayKey());
  assert.equal(fresh.weekStart, exports.weekStartKey());
}

async function runAsyncPageActionTests() {
  // -- Test 7: counter increment via onModalNoteFilled -------------------------
  {
    const { doc } = makePeopleSearchDocument({ rows: [] });
    const dialog = {
      innerText: "Add a free note to your invitation",
      textContent: "Add a free note to your invitation",
      classList: makeClassList(),
      children: [],
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
    const { exports, chrome } = loadPageAction({ doc, storage: {} });
    await exports.onModalNoteFilled(dialog);
    const stats = chrome.__storage["lra:invite-stats"];
    assert.equal(stats.todayCount, 1, "counter should be 1 after note-fill");
    assert.equal(stats.weekCount, 1);
    assert.ok(stats.lastSentAt > 0, "lastSentAt should be set");
  }

  // -- Test 8: weekly-limit modal detection ------------------------------------
  {
    const { doc } = makePeopleSearchDocument({ rows: [] });
    const limitDialog = {
      innerText: "You've reached the weekly invitation limit. Try again next week.",
      textContent: "You've reached the weekly invitation limit. Try again next week.",
    };
    const { exports, chrome } = loadPageAction({ doc, storage: {} });
    const detected = exports.checkWeeklyLimitModal(limitDialog);
    assert.equal(detected, true, "should detect weekly-limit modal");
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(
      Number(chrome.__storage["lra:weekly-block-until"] || 0) > Date.now(),
      "weekly block should be set",
    );
  }

  // -- Test 9: personalizeConnectionNote inserts first name --------------------
  {
    const { doc } = makePeopleSearchDocument({ rows: [] });
    const { exports } = loadPageAction({ doc });
    const result = exports.personalizeConnectionNote(
      "Hi, I saw your work and would love to chat.",
      "Jane Doe",
    );
    assert.match(result, /^Hi Jane,/, "note should start with personalized greeting");
  }

  // -- Test 10: adjustInviteCount -1 -------------------------------------------
  {
    const { doc } = makePeopleSearchDocument({ rows: [] });
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const { exports, chrome } = loadPageAction({
      doc,
      storage: {
        "lra:invite-stats": {
          todayDate: todayStr,
          todayCount: 5,
          weekStart: "1999-01-01",
          weekCount: 5,
          lastSentAt: 0,
        },
      },
    });
    await exports.adjustInviteCount(-1);
    assert.equal(
      chrome.__storage["lra:invite-stats"].todayCount,
      4,
      "todayCount should decrement",
    );
  }

  // -- Test 11: cross-tab pending intent consume -------------------------------
  {
    const { doc } = makePeopleSearchDocument({ rows: [] });
    const intentMap = {
      jane: {
        name: "Jane",
        profileUrl: "https://www.linkedin.com/in/jane/",
        savedAt: Date.now(),
      },
    };
    const { exports, chrome } = loadPageAction({
      doc,
      storage: { "lra:pending-intents": intentMap },
    });
    const intent = await exports.consumePendingIntent("jane");
    assert.equal(intent?.name, "Jane");
    assert.equal(
      chrome.__storage["lra:pending-intents"].jane,
      undefined,
      "intent should be deleted after consume",
    );
  }

  // -- Test 12: findVisibleNoteTextarea rejects short inputs -------------------
  {
    const { doc } = makePeopleSearchDocument({ rows: [] });
    const { exports } = loadPageAction({ doc });
    const tallTextarea = {
      tagName: "TEXTAREA",
      attributes: { name: "message" },
      getAttribute(n) { return this.attributes[n] || null; },
      getBoundingClientRect: () => makeRect(400, 120),
    };
    const shortInput = {
      tagName: "INPUT",
      attributes: { type: "text" },
      getAttribute(n) { return this.attributes[n] || null; },
      getBoundingClientRect: () => makeRect(120, 24),
    };
    const dialog = {
      querySelectorAll(selector) {
        if (selector.includes("textarea")) return [tallTextarea];
        return [];
      },
    };
    const field = exports.findVisibleNoteTextarea(dialog);
    assert.equal(field, tallTextarea, "should find tall textarea");

    const dialogShortOnly = {
      querySelectorAll() { return [shortInput]; },
    };
    assert.equal(
      exports.findVisibleNoteTextarea(dialogShortOnly),
      null,
      "short input should be rejected",
    );
  }
}

runAsyncPageActionTests()
  .then(() => console.log("pageAction tests passed"))
  .catch((error) => {
    console.error("pageAction tests failed:", error);
    process.exit(1);
  });
