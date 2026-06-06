// content.js — executed inside a LinkedIn jobs tab via chrome.scripting.
//
// Extract only from the selected job details pane and selected job card.
// If LinkedIn changes a selector, leave the field blank before trusting
// unrelated profile/sidebar text.

(() => {
  function extractJob() {
    const titleEl = findVisibleJobTitleElement();
    const detailsRoot = findDetailsRoot(titleEl);
    const description = extractDescription(detailsRoot || document);
    const selectedCardLines = getSelectedJobCardLines();
    const rawTitle =
      cleanText(titleEl?.textContent || "") ||
      titleFromPageMetadata() ||
      titleFromDescription(description) ||
      titleFromCardLines(selectedCardLines);
    const jobTitle = cleanJobTitle(rawTitle);
    const headerRoot = findHeaderRoot(titleEl, detailsRoot);
    const headerLines = cleanLines(headerRoot?.innerText || headerRoot?.textContent || "");
    const sponsorship = analyzeSponsorship(description);
    const companyName = (
      companyFromHeader(headerRoot, headerLines, rawTitle) ||
      companyFromCardLines(selectedCardLines, rawTitle) ||
      companyFromDescription(description)
    ).slice(0, 200);
    const companyMeta = companyLinkedInMeta(headerRoot, companyName);

    return {
      jobTitle: jobTitle.slice(0, 200),
      company: companyName,
      companyLinkedInId: companyMeta.id,
      companyLinkedInUrl: companyMeta.url,
      location: (
        locationFromHeader(headerLines, rawTitle) ||
        locationFromCardLines(selectedCardLines, rawTitle) ||
        locationFromDescription(description)
      ).slice(0, 200),
      jobUrl: canonicalJobUrl(),
      jobDescription: description,
      sponsorshipStatus: sponsorship.status,
      sponsorshipEvidence: sponsorship.evidence,
    };
  }

  function findVisibleJobTitleElement() {
    const selectors = [
      ".job-details-jobs-unified-top-card__job-title h1",
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title h1",
      ".jobs-unified-top-card__job-title",
      ".jobs-details-top-card__job-title h1",
      ".jobs-details-top-card__job-title",
      "main h1",
      "h1",
    ];
    const seen = new Set();

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (seen.has(el) || !isVisible(el)) continue;
        seen.add(el);

        const text = cleanText(el.textContent || "");
        if (isLikelyJobTitle(text)) return el;
      }
    }

    return null;
  }

  function isLikelyJobArea(el, title) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = cleanText(node.innerText || node.textContent || "");
      if (!text.includes(title)) continue;
      if (
        /\b(easy apply|apply|save|promoted by hirer|applicants?|about the job)\b/i.test(text) ||
        node.matches?.(".jobs-details, .job-view-layout, .scaffold-layout__detail")
      ) {
        return true;
      }
    }
    return false;
  }

  function findDetailsRoot(titleEl) {
    const selectors = [
      ".jobs-search__job-details--container",
      ".jobs-search__job-details",
      ".jobs-details",
      ".jobs-details__main-content",
      ".scaffold-layout__detail",
      ".job-view-layout",
      "main",
    ];

    if (titleEl) {
      for (const selector of selectors) {
        const root = titleEl.closest(selector);
        if (root && isVisible(root)) return root;
      }
    }

    for (const selector of selectors) {
      const roots = Array.from(document.querySelectorAll(selector));
      const root = roots.find((candidate) => {
        const text = cleanText(candidate.innerText || candidate.textContent || "");
        return isVisible(candidate) && /\b(easy apply|apply|save|about the job)\b/i.test(text);
      });
      if (root) return root;
    }

    return null;
  }

  function findHeaderRoot(titleEl, detailsRoot) {
    if (!titleEl) return findHeaderRootFromDetails(detailsRoot);

    const title = cleanText(titleEl.textContent || "");
    let best = titleEl.parentElement;
    let node = titleEl.parentElement;

    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      if (!isVisible(node)) continue;
      const text = node.innerText || node.textContent || "";
      const normalized = cleanText(text);
      if (!normalized.includes(title)) continue;
      if (/about the job/i.test(normalized) && normalized.length > 1800) break;

      const lines = cleanLines(text);
      const titleIndex = findTitleLineIndex(lines, title);
      const hasUsefulHeaderInfo =
        lines.some((line) => isLikelyCompanyLine(line, title)) ||
        lines.some((line) => Boolean(locationFromLine(line))) ||
        /\b(easy apply|apply|save|applicants?)\b/i.test(normalized);

      if (lines.length >= 2 && lines.length <= 40 && normalized.length <= 2400 && hasUsefulHeaderInfo) {
        best = node;
      }

      if (titleIndex !== -1 && hasUsefulHeaderInfo && lines.length <= 24) {
        return node;
      }

      if (detailsRoot && node === detailsRoot) break;
    }

    return best;
  }

  function findHeaderRootFromDetails(detailsRoot) {
    if (!detailsRoot) return null;

    const selectors = [
      ".job-details-jobs-unified-top-card",
      ".jobs-unified-top-card",
      ".jobs-details-top-card",
    ];

    for (const selector of selectors) {
      const root = Array.from(detailsRoot.querySelectorAll(selector)).find(isVisible);
      if (root) return root;
    }

    return detailsRoot;
  }

  function companyFromHeader(root, lines, rawTitle) {
    const selectorCompany = companyFromSelectors(root, rawTitle);
    if (selectorCompany) return selectorCompany;

    const anchorCompany = companyFromAnchor(root, rawTitle);
    if (anchorCompany) return anchorCompany;

    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    const candidates = [
      ...lines.slice(Math.max(0, titleIndex - 5), titleIndex).reverse(),
      ...lines.slice(titleIndex + 1, titleIndex + 5),
    ];

    for (const line of candidates) {
      const company = cleanCompanyLine(line, rawTitle);
      if (company) return company;
    }

    return "";
  }

  function companyFromSelectors(root, rawTitle) {
    if (!root) return "";

    const selectors = [
      ".job-details-jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name",
      ".jobs-details-top-card__company-url",
      "a[href*='/company/']",
    ];

    for (const selector of selectors) {
      for (const el of root.querySelectorAll(selector)) {
        if (!isVisible(el)) continue;
        const company = cleanCompanyLine(el.innerText || el.textContent || "", rawTitle);
        if (company) return company;
      }
    }

    return "";
  }

  function companyFromAnchor(root, rawTitle) {
    if (!root) return "";
    const anchors = Array.from(root.querySelectorAll("a[href*='/company/']"));

    for (const anchor of anchors) {
      if (!isVisible(anchor)) continue;
      const company = cleanCompanyLine(anchor.innerText || anchor.textContent || "", rawTitle);
      if (company) return company;
    }

    return "";
  }

  function companyLinkedInMeta(root, companyName) {
    if (!root) return { id: "", url: "" };

    const anchors = Array.from(root.querySelectorAll("a[href*='/company/']"));
    for (const anchor of anchors) {
      if (!isVisible(anchor)) continue;

      const text = cleanCompanyLine(anchor.innerText || anchor.textContent || "", "");
      if (companyName && text && !sameCompanyText(text, companyName)) continue;

      const href = anchor.href || anchor.getAttribute("href") || "";
      const url = canonicalCompanyUrl(href);
      return {
        id: companyIdFromElement(anchor) || companyIdFromDocument(companyName, url, root),
        url,
      };
    }

    return {
      id: companyIdFromElement(root) || companyIdFromDocument(companyName, "", root),
      url: "",
    };
  }

  function sameCompanyText(a, b) {
    return normalizeCompanyText(a) === normalizeCompanyText(b);
  }

  function normalizeCompanyText(value) {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function companyIdFromElement(el) {
    const parts = [];
    if (el.href) parts.push(el.href);
    if (typeof el.getAttributeNames === "function") {
      for (const name of el.getAttributeNames()) {
        parts.push(el.getAttribute(name) || "");
      }
    }
    parts.push((el.outerHTML || "").slice(0, 2500));

    return companyIdFromText(parts.join(" "));
  }

  function companyIdFromDocument(companyName, companyUrl, root) {
    const rootHtml = root?.outerHTML || root?.innerHTML || "";
    const scopedId = companyIdFromText(rootHtml.slice(0, 120000));
    if (scopedId) return scopedId;

    const references = companyReferences(companyName, companyUrl);
    if (!references.length) return "";

    for (const source of pageDataSources()) {
      if (!/\bcompany\b/i.test(source)) continue;

      for (const slice of companyReferenceSlices(source, references)) {
        const id = companyIdFromText(slice);
        if (id) return id;
      }
    }

    return "";
  }

  function pageDataSources() {
    const sources = [];
    const documentHtml = document.documentElement?.innerHTML || "";
    if (documentHtml) sources.push(documentHtml);

    for (const el of document.querySelectorAll("code, script")) {
      const text = el.textContent || el.innerText || "";
      if (text) sources.push(text);
    }

    return sources;
  }

  function companyReferences(companyName, companyUrl) {
    const refs = new Set();
    const name = cleanText(companyName);
    const slug = companySlugFromUrl(companyUrl);

    if (name) {
      refs.add(name.toLowerCase());
      refs.add(encodeURIComponent(name).toLowerCase());
      refs.add(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }

    if (slug) {
      refs.add(slug.toLowerCase());
      refs.add(safeDecodeURIComponent(slug).toLowerCase());
    }

    return Array.from(refs).filter((ref) => ref.length >= 3);
  }

  function companyReferenceSlices(source, references) {
    const slices = [];
    const lower = source.toLowerCase();

    for (const ref of references) {
      let index = lower.indexOf(ref);
      let count = 0;

      while (index !== -1 && count < 6) {
        slices.push(source.slice(Math.max(0, index - 5000), index + 5000));
        index = lower.indexOf(ref, index + ref.length);
        count += 1;
      }
    }

    return slices;
  }

  function companyIdFromText(text) {
    const decoded = safeDecodeURIComponent(text || "")
      .replace(/\\u002F/gi, "/")
      .replace(/\\u003A/gi, ":")
      .replace(/\\u0026/gi, "&")
      .replace(/&quot;/gi, '"');
    return (
      decoded.match(/urn:li:(?:fsd_)?company:(\d+)/i)?.[1] ||
      decoded.match(/[?&](?:companyId|currentCompany)=\[?"?(\d+)/i)?.[1] ||
      decoded.match(/\/company\/(\d+)(?:[/?#]|$)/i)?.[1] ||
      ""
    );
  }

  function companySlugFromUrl(href) {
    try {
      const url = new URL(href, window.location.href);
      const parts = url.pathname.split("/").filter(Boolean);
      const companyIndex = parts.indexOf("company");
      return companyIndex !== -1 ? parts[companyIndex + 1] || "" : "";
    } catch (_) {
      return "";
    }
  }

  function canonicalCompanyUrl(href) {
    try {
      const url = new URL(href, window.location.href);
      const slug = companySlugFromUrl(url.href);
      return slug ? `https://www.linkedin.com/company/${slug}/` : "";
    } catch (_) {
      return "";
    }
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  function companyFromCardLines(lines, rawTitle) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 5); index += 1) {
      const company = cleanCompanyLine(lines[index], rawTitle);
      if (company) return company;
    }

    return "";
  }

  function cleanCompanyLine(line, rawTitle) {
    const parts = cleanLines(line)
      .flatMap((part) => part.split(/[·•]/))
      .map(cleanText)
      .filter(Boolean);

    for (const part of parts) {
      const cleaned = part
        .replace(/\d{2,}\+?\s*employees?.*$/i, "")
        .replace(/\d+\s+connections?.*$/i, "")
        .replace(/\d+\s+company alumni.*$/i, "")
        .trim();

      if (isLikelyCompanyLine(cleaned, rawTitle)) return cleaned;
    }

    return "";
  }

  function isLikelyCompanyLine(line, rawTitle) {
    const text = cleanText(line);
    if (!text || text.length > 90) return false;
    if (rawTitle && cleanText(rawTitle) === text) return false;
    if (isLikelyJobTitle(text) || locationFromLine(text) || isNoiseLine(text)) return false;
    if (/\b(employees?|connections?|applicants?|benefits?|premium|open to full-time roles|viewed|easy apply)\b/i.test(text)) {
      return false;
    }
    return /[a-zA-Z]/.test(text);
  }

  function locationFromHeader(lines, rawTitle) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 8); index += 1) {
      const location = locationFromLine(lines[index]);
      if (location) return location;
    }

    return "";
  }

  function locationFromCardLines(lines, rawTitle) {
    const titleIndex = findTitleLineIndex(lines, rawTitle);
    if (titleIndex === -1) return "";

    for (let index = titleIndex + 1; index < Math.min(lines.length, titleIndex + 6); index += 1) {
      const location = locationFromLine(lines[index]);
      if (location) return location;
    }

    return "";
  }

  function locationFromLine(line) {
    const first = cleanText(line).split(/[·•]/)[0].trim();
    if (!first || first.length > 90 || isNoiseLine(first)) return "";
    if (/\b(applicants?|employees?|connections?|promoted by|response insights?|benefits?)\b/i.test(first)) {
      return "";
    }
    if (
      /,/.test(first) ||
      /\b(remote|hybrid|on-site|onsite|united states|canada|greater .* area|area)\b/i.test(first)
    ) {
      return first;
    }
    return "";
  }

  function extractDescription(root) {
    const selectors = [
      "#job-details",
      ".jobs-description__content .jobs-box__html-content",
      ".jobs-description-content__text",
      ".jobs-description__container",
      ".jobs-description",
      ".description__text",
      "[class*='jobs-description']",
    ];
    const roots = root && root !== document ? [root, document] : [document];

    for (const currentRoot of roots) {
      for (const selector of selectors) {
        const matches = Array.from(currentRoot.querySelectorAll(selector));
        for (const el of matches) {
          const text = cleanBlockText(el.innerText || el.textContent || "");
          if (isLikelyDescription(text)) return text.slice(0, 6000);
        }
      }

      const sectionText = descriptionFromAboutSection(
        currentRoot.innerText || currentRoot.textContent || "",
      );
      if (sectionText) return sectionText.slice(0, 6000);
    }

    return "";
  }

  function descriptionFromAboutSection(text) {
    const lines = cleanLines(text);
    const aboutIndex = lines.findIndex((line) => /^about the job$/i.test(line));
    if (aboutIndex === -1) return "";

    const collected = [];
    for (const line of lines.slice(aboutIndex + 1)) {
      if (
        /^(people you can reach out to|similar jobs|recommended jobs|jobs you may be interested in|job match|premium)$/i.test(
          line,
        )
      ) {
        break;
      }
      if (/^(show more|show less|report this job)$/i.test(line)) continue;
      collected.push(line);
    }

    const textAfterHeading = cleanBlockText(collected.join("\n"));
    return isLikelyDescription(textAfterHeading) ? textAfterHeading : "";
  }

  function isLikelyDescription(text) {
    const value = cleanText(text);
    if (value.length < 40) return false;
    return !/^(premium|job match|people you can reach out to)/i.test(value);
  }

  function analyzeSponsorship(text) {
    const normalized = cleanSponsorshipText(text);
    if (!normalized) return { status: "unknown", evidence: "" };

    const noEvidence = findSponsorshipEvidence(normalized, NO_SPONSORSHIP_PATTERNS);
    if (noEvidence) return { status: "no_sponsorship", evidence: noEvidence };

    const yesEvidence = findSponsorshipEvidence(normalized, SPONSORSHIP_AVAILABLE_PATTERNS);
    if (yesEvidence) return { status: "sponsors", evidence: yesEvidence };

    return { status: "unknown", evidence: "" };
  }

  const NO_SPONSORSHIP_PATTERNS = [
    /\b(?:do|does|will|can)\s+not\s+(?:sponsor|provide\s+sponsorship|offer\s+sponsorship|support\s+sponsorship|provide\s+visa\s+sponsorship|offer\s+visa\s+sponsorship)\b[^.!?\n]{0,160}/i,
    /\b(?:doesn't|don't|won't|cannot|can't)\s+(?:sponsor|provide\s+sponsorship|offer\s+sponsorship|support\s+sponsorship|provide\s+visa\s+sponsorship|offer\s+visa\s+sponsorship)\b[^.!?\n]{0,160}/i,
    /\b(?:unable|not\s+able)\s+to\s+(?:sponsor|provide\s+sponsorship|offer\s+sponsorship|support\s+sponsorship|take\s+over\s+sponsorship|transfer\s+sponsorship)\b[^.!?\n]{0,160}/i,
    /\b(?:no|not\s+eligible\s+for)\s+(?:visa\s+|immigration\s+|employment\s+|work\s+authorization\s+|work\s+visa\s+)?sponsorship\b[^.!?\n]{0,160}/i,
    /\b(?:visa|immigration|employment|work(?:\s+authorization)?|work\s+visa|H-?1B|H1B|TN|OPT|CPT)\s+sponsorship\s+(?:is\s+)?(?:not\s+available|unavailable|not\s+provided|not\s+offered|not\s+supported)\b[^.!?\n]{0,160}/i,
    /\bwithout\s+(?:requiring\s+)?(?:current\s+or\s+future\s+)?(?:employer\s+|company\s+)?(?:visa\s+|immigration\s+|employment\s+|work\s+authorization\s+|work\s+visa\s+)?sponsorship\b[^.!?\n]{0,160}/i,
    /\b(?:sponsorship|sponsor|visa\s+sponsorship|employment\s+sponsorship|work\s+authorization\s+sponsorship)\b[^.!?\n]{0,120}\b(?:now\s+or\s+in\s+the\s+future|currently\s+or\s+in\s+the\s+future|now\s+or\s+future)\b/i,
    /\b(?:now\s+or\s+in\s+the\s+future|currently\s+or\s+in\s+the\s+future|now\s+or\s+future)\b[^.!?\n]{0,120}\b(?:sponsorship|sponsor|visa\s+sponsorship|employment\s+sponsorship|work\s+authorization\s+sponsorship)\b/i,
    /\bcandidates?\s+(?:who\s+)?(?:require|requires|requiring|need|needs|needing)\s+(?:visa\s+|immigration\s+|employment\s+|work\s+authorization\s+|work\s+visa\s+)?sponsorship\b[^.!?\n]{0,180}\b(?:not\s+eligible|ineligible|will\s+not\s+be\s+considered|cannot\s+be\s+considered|can't\s+be\s+considered|need\s+not\s+apply)\b/i,
    /\b(?:not\s+eligible|ineligible|will\s+not\s+be\s+considered|cannot\s+be\s+considered|can't\s+be\s+considered|need\s+not\s+apply)\b[^.!?\n]{0,180}\b(?:require|requires|requiring|need|needs|needing)\s+(?:visa\s+|immigration\s+|employment\s+|work\s+authorization\s+|work\s+visa\s+)?sponsorship\b/i,
    /\b(?:H-?1B|H1B|H-?1B\s+transfer|TN|E-?3|O-?1|J-?1|F-?1|OPT|CPT|STEM\s+OPT|work\s+visa|visa\s+transfer)\b[^.!?\n]{0,120}\b(?:not\s+accepted|not\s+supported|not\s+eligible|ineligible|not\s+available|not\s+offered|will\s+not\s+be\s+sponsored|cannot\s+be\s+sponsored)\b/i,
    /\b(?:not\s+accepted|not\s+supported|not\s+eligible|ineligible|not\s+available|not\s+offered|will\s+not\s+be\s+sponsored|cannot\s+be\s+sponsored)\b[^.!?\n]{0,120}\b(?:H-?1B|H1B|H-?1B\s+transfer|TN|E-?3|O-?1|J-?1|F-?1|OPT|CPT|STEM\s+OPT|work\s+visa|visa\s+transfer)\b/i,
    /\bno\s+(?:H-?1B|H1B|TN|E-?3|O-?1|J-?1|F-?1|OPT|CPT|STEM\s+OPT|work\s+visa|visa\s+transfers?)\b[^.!?\n]{0,120}/i,
    /\b(?:U\.?S\.?|US|United\s+States)\s+citizenship\s+(?:is\s+)?required\b[^.!?\n]{0,160}/i,
    /\b(?:requires?|requiring)\s+(?:U\.?S\.?|US|United\s+States)\s+citizenship\b[^.!?\n]{0,160}/i,
    /\bmust\s+be\s+(?:a\s+)?(?:U\.?S\.?|US|United\s+States)\s+citizen\b[^.!?\n]{0,160}/i,
    /\b(?:citizens?|green\s+card\s+holders?|lawful\s+permanent\s+residents?|permanent\s+residents?)\s+only\b[^.!?\n]{0,160}/i,
    /\b(?:U\.?S\.?|US|United\s+States)\s+persons?\s+(?:status\s+)?(?:is\s+)?required\b[^.!?\n]{0,160}/i,
    /\b(?:green\s+card|lawful\s+permanent\s+resident|permanent\s+resident)\b[^.!?\n]{0,120}\b(?:required|only|must)\b[^.!?\n]{0,80}/i,
    /\b(?:ITAR|EAR|export[-\s]?control(?:led)?|export\s+compliance)\b[^.!?\n]{0,180}\b(?:U\.?S\.?\s+person|US\s+person|U\.?S\.?\s+citizen|US\s+citizen|permanent\s+resident|green\s+card)\b[^.!?\n]{0,80}/i,
    /\b(?:active\s+)?(?:secret|top\s+secret|TS\/SCI|SCI|public\s+trust|security)\s+clearance\s+(?:is\s+)?required\b[^.!?\n]{0,160}/i,
  ];

  const SPONSORSHIP_AVAILABLE_PATTERNS = [
    /\b(?:visa|immigration|employment|work(?:\s+authorization)?|work\s+visa|green\s+card)\s+sponsorship\s+(?:is\s+)?(?:available|provided|offered|supported|considered)\b[^.!?\n]{0,160}/i,
    /\bsponsorship\s+(?:is\s+)?(?:available|provided|offered|supported|considered)\b[^.!?\n]{0,160}/i,
    /\b(?:will|can|may|able\s+to)\s+sponsor\b[^.!?\n]{0,140}\b(?:visa|immigration|employment|work\s+authorization|work\s+visa|H-?1B|H1B|TN|green\s+card)\b/i,
    /\b(?:we|company|employer|client)\s+(?:sponsor|sponsors|will\s+sponsor|can\s+sponsor|provides?|offers?|supports?)\b[^.!?\n]{0,140}\b(?:visa|immigration|employment|work\s+authorization|work\s+visa|H-?1B|H1B|TN|green\s+card)\b/i,
    /\b(?:H-?1B|H1B|H-?1B\s+transfer|TN|E-?3|O-?1|L-?1|visa\s+transfer|work\s+visa)\b[^.!?\n]{0,120}\b(?:sponsorship|sponsored|supported|available|accepted|welcome|considered)\b/i,
    /\b(?:sponsor(?:ship)?|support)\s+(?:for\s+)?(?:H-?1B|H1B|TN|E-?3|O-?1|L-?1|OPT|CPT|STEM\s+OPT|visa\s+transfer|work\s+visa)\b[^.!?\n]{0,120}/i,
    /\b(?:OPT|CPT|STEM\s+OPT|F-?1|EAD)\s+(?:candidates?\s+)?(?:are\s+)?(?:welcome|accepted|eligible|considered|supported)\b[^.!?\n]{0,120}/i,
    /\b(?:international\s+students?|international\s+candidates?|international\s+applicants?)\s+(?:are\s+)?(?:welcome|eligible|encouraged|considered)\b[^.!?\n]{0,120}/i,
    /\b(?:green\s+card|permanent\s+residency|immigration)\s+sponsorship\s+(?:is\s+)?(?:available|supported|provided|offered)\b[^.!?\n]{0,120}/i,
    /\bvisa\s+support\s+(?:is\s+)?(?:available|provided|offered|included)\b[^.!?\n]{0,120}/i,
    /\brelocation\s+(?:and|&)\s+visa\s+support\b[^.!?\n]{0,120}/i,
    /\bopen\s+to\s+(?:visa\s+|immigration\s+|employment\s+|work\s+authorization\s+)?sponsorship\b[^.!?\n]{0,120}/i,
    /\b(?:sponsorship|visa\s+sponsorship)\s+may\s+be\s+(?:available|considered)\b[^.!?\n]{0,120}/i,
  ];

  function findSponsorshipEvidence(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[0]) return cleanEvidence(match[0]);
    }

    return "";
  }

  function cleanSponsorshipText(text) {
    return (text || "")
      .replace(/ /g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanEvidence(text) {
    return cleanSponsorshipText(text)
      .replace(/^[,.;:\s]+|[,.;:\s]+$/g, "")
      .slice(0, 240);
  }

  function titleFromPageMetadata() {
    const titleSources = [
      document.title,
      metaContent("meta[property='og:title']"),
      metaContent("meta[name='twitter:title']"),
    ];

    for (const source of titleSources) {
      const title = titleFromLinkedInTitle(source);
      if (title) return title;
    }

    const descriptionSources = [
      metaContent("meta[name='description']"),
      metaContent("meta[property='og:description']"),
      metaContent("meta[name='twitter:description']"),
    ];

    for (const source of descriptionSources) {
      const title = titleFromRoleSentence(source);
      if (title) return title;
    }

    const canonicalLink = document.querySelector("link[rel='canonical']");
    const urlSources = [
      canonicalLink?.href || canonicalLink?.getAttribute("href") || "",
      metaContent("meta[property='og:url']"),
      window.location.href,
    ];

    for (const source of urlSources) {
      const title = titleFromUrlSlug(source);
      if (title) return title;
    }

    return "";
  }

  function metaContent(selector) {
    return cleanText(document.querySelector(selector)?.getAttribute("content") || "");
  }

  function titleFromLinkedInTitle(title) {
    const value = cleanText(title)
      .replace(/\s*\|\s*LinkedIn.*$/i, "")
      .replace(/\s*-\s*LinkedIn.*$/i, "")
      .trim();
    if (!value || /^linkedin$/i.test(value)) return "";

    const hiring = value.match(/^.+?\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
    if (isMetadataJobTitle(hiring?.[1] || "")) return cleanText(hiring[1]);

    const atCompany = value.match(/^(.+?)\s+at\s+.+$/i);
    if (isMetadataJobTitle(atCompany?.[1] || "")) return cleanText(atCompany[1]);

    const dash = value.match(/^(.+?)\s+[-–]\s+.+$/);
    if (isLikelyJobTitle(dash?.[1] || "")) return cleanText(dash[1]);

    return isLikelyJobTitle(value) ? value : "";
  }

  function titleFromRoleSentence(text) {
    const value = cleanText(text);
    if (!value) return "";

    const patterns = [
      /\bas\s+(?:an?|the)?\s+([^,.;\n]+?)(?:,|\syou\b|\swill\b)/i,
      /\b(?:is|are)\s+(?:looking|hiring|searching)\s+for\s+(?:an?|the)?\s+([^.\n;,]+)/i,
      /\bseeking\s+(?:an?|the)?\s+([^.\n;,]+)/i,
      /\b(?:role|position)\s+(?:of|for)\s+(?:an?|the)?\s+([^.\n;,]+)/i,
    ];

    for (const pattern of patterns) {
      const candidate = cleanText(value.match(pattern)?.[1] || "")
        .replace(/^(?:a|an|the)\s+/i, "")
        .trim();
      if (isLikelyJobTitle(candidate)) return candidate;
    }

    return "";
  }

  function titleFromUrlSlug(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      const slug = decodeURIComponent(
        url.pathname.match(/\/jobs\/view\/([^/?#]+)/i)?.[1] || "",
      )
        .replace(/\/$/, "")
        .replace(/-\d+$/, "");

      if (!slug || /^\d+$/.test(slug)) return "";

      const atIndex = slug.lastIndexOf("-at-");
      const titleSlug = atIndex > 0 ? slug.slice(0, atIndex) : slug;
      const title = titleSlug.replace(/-/g, " ");
      return isMetadataJobTitle(title) ? title : "";
    } catch (_) {
      return "";
    }
  }

  function isMetadataJobTitle(title) {
    const text = cleanText(title);
    return Boolean(
      text &&
        text.length >= 2 &&
        text.length <= 140 &&
        /[a-zA-Z]/.test(text) &&
        !isNoiseLine(text) &&
        !/^linkedin$/i.test(text),
    );
  }

  function titleFromDescription(description) {
    const explicitTitle = valueAfterLabel(description, "(?:job title|title)").replace(/^["']|["']$/g, "");
    if (isLikelyJobTitle(explicitTitle)) return explicitTitle;

    const roleSentenceTitle = titleFromRoleSentence(description);
    if (roleSentenceTitle) return roleSentenceTitle;

    return explicitTitle;
  }

  function companyFromDescription(description) {
    return valueAfterLabel(description, "company");
  }

  function locationFromDescription(description) {
    return cleanText(valueAfterLabel(description, "location").split(/[–-]/)[0]);
  }

  function valueAfterLabel(text, labelPattern) {
    const labels =
      "(?:job title|title|company|location|job description|description|requirements?|responsibilities|qualifications)";
    const match = text.match(new RegExp(`\\b${labelPattern}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*${labels}\\s*:|\\b${labels}\\s*:|$)`, "i"));
    return cleanText(match?.[1] || "");
  }

  function getSelectedJobCardLines() {
    const id = jobIdFromUrl();
    const cards = [];

    if (id) {
      const links = Array.from(
        document.querySelectorAll(
          `a[href*="/jobs/view/${id}"], a[href*="currentJobId=${id}"]`,
        ),
      );

      for (const link of links) {
        const card = link.closest(
          "[data-job-id], li, .job-card-container, .jobs-search-results__list-item",
        );
        if (card) cards.push(card);
      }
    }

    cards.push(
      ...document.querySelectorAll(
        [
          "[data-job-id][aria-current='page']",
          "[data-job-id][aria-selected='true']",
          "li[aria-current='page']",
          "li[aria-selected='true']",
          ".job-card-container--clickable[aria-current='page']",
          ".jobs-search-results__list-item--active",
          ".jobs-search-results-list__list-item--active",
          ".scaffold-layout__list-item--active",
          ".job-card-container--active",
        ].join(", "),
      ),
    );

    for (const card of cards) {
      if (!isVisible(card)) continue;
      const text = card.innerText || card.textContent || "";
      const lines = cleanLines(text);
      if (lines.length >= 2 && lines.length <= 25 && !lines.some((line) => /^about the job$/i.test(line))) {
        return lines;
      }
    }

    return [];
  }

  function titleFromCardLines(lines) {
    return lines.find(isLikelyJobTitle) || "";
  }

  function findTitleLineIndex(lines, rawTitle) {
    const title = cleanText(rawTitle);
    if (title) {
      const index = lines.findIndex((line) => {
        const current = cleanText(line);
        return current === title || current.includes(title) || title.includes(current);
      });
      if (index !== -1) return index;
    }

    return lines.findIndex(isLikelyJobTitle);
  }

  function jobIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      const currentJobId = url.searchParams.get("currentJobId");
      if (currentJobId) return currentJobId;
      return url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] || "";
    } catch (_) {
      return "";
    }
  }

  function canonicalJobUrl() {
    const id = jobIdFromUrl();
    if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    return window.location.href.split(/[?#]/)[0];
  }

  function isLikelyJobTitle(line) {
    const text = cleanText(line);
    if (!text || text.length < 2 || text.length > 140 || isNoiseLine(text)) return false;
    return /\b(engineer|scientist|manager|specialist|analyst|developer|designer|intern|lead|director|product|data|software|machine learning|ai|ml|consultant|associate|architect)\b/i.test(
      text,
    );
  }

  function isNoiseLine(line) {
    return /^(apply|easy apply|saved|save|remote|hybrid|on-site|onsite|full-time|part-time|contract|internship|yes|no|premium|about the job|people you can reach out to|job match|show match details|tailor my resume|create cover letter)$/i.test(
      cleanText(line),
    );
  }

  function cleanJobTitle(title) {
    const normalized = cleanText(title)
      .replace(/^selected,\s*/i, "")
      .replace(/\s*\(verified job\)\s*/i, "")
      .replace(/\s+with verification$/i, "")
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .trim();

    const knownRole = compactKnownRole(normalized);
    if (knownRole) return knownRole;

    const firstSegment = normalized
      .split(/[,|/]/)[0]
      .replace(/\b(entry[-\s]?level|new grad|early career|internship|intern)\b/gi, "")
      .replace(/\b(associate|senior|sr\.?|staff|principal|lead|ii|iii|iv|mid[-\s]?level)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    return compactKnownRole(firstSegment) || titleCaseRole(firstSegment || normalized);
  }

  function compactKnownRole(title) {
    const text = title.toLowerCase();

    if (/\bforward\s+deployed\b/.test(text) && /\bai\b/.test(text) && /\bengineer\b/.test(text)) {
      return "Forward Deployed AI Engineer";
    }
    if (/\bforward\s+deployed\b/.test(text) && /\bengineer\b/.test(text)) {
      return "Forward Deployed Engineer";
    }
    if (/\b(machine learning|ml)\s+engineer\b/.test(text)) {
      return "Machine Learning Engineer";
    }
    if (/\bai\s+engineer\b/.test(text) || /\bartificial intelligence\s+engineer\b/.test(text)) {
      return "AI Engineer";
    }
    if (/\bdata\s+scientist\b/.test(text)) return "Data Scientist";
    if (/\bdata\s+engineer\b/.test(text)) return "Data Engineer";
    if (/\bfull[-\s]?stack\s+engineer\b/.test(text)) return "Full Stack Engineer";
    if (/\bfront[-\s]?end\s+engineer\b/.test(text)) return "Frontend Engineer";
    if (/\bback[-\s]?end\s+engineer\b/.test(text)) return "Backend Engineer";
    if (/\bsoftware\s+engineer\b/.test(text)) return "Software Engineer";
    if (/\bprompt\s+engineer\b/.test(text)) return "Prompt Engineer";
    if (/\bprompt\s+specialist\b/.test(text)) return "Prompt Specialist";
    if (/\bresearch\s+scientist\b/.test(text)) return "Research Scientist";
    if (/\bproduct\s+manager\b/.test(text)) return "Product Manager";
    if (/\bproduct\s+designer\b/.test(text)) return "Product Designer";
    if (/\bsolutions?\s+engineer\b/.test(text)) return "Solutions Engineer";
    if (/\bsupport\s+engineer\b/.test(text)) return "Support Engineer";
    if (/\bdevops\s+engineer\b/.test(text)) return "DevOps Engineer";
    if (/\bmlops\s+engineer\b/.test(text)) return "MLOps Engineer";

    return "";
  }

  function titleCaseRole(title) {
    return title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((word) => {
        const upper = word.toUpperCase();
        if (["AI", "ML", "LLM", "RAG", "NLP", "MLOPS", "DEVOPS"].includes(upper)) {
          if (upper === "MLOPS") return "MLOps";
          if (upper === "DEVOPS") return "DevOps";
          return upper;
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(" ")
      .trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cleanText(text) {
    return (text || "")
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanBlockText(text) {
    return cleanLines(text).join("\n").trim();
  }

  function cleanLines(text) {
    return (text || "")
      .replace(/ /g, " ")
      .split(/\n+/)
      .map(cleanText)
      .filter(Boolean);
  }

  return extractJob();
})();
