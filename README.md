# LinkedIn Referral Assistant

A **personal-use** tool that helps you plan referral outreach for LinkedIn jobs.

You click a Chrome extension button on a LinkedIn job page. The extension
extracts the job info and opens a local web app, which suggests three target
contact categories (same-role employee, hiring manager, recruiter), generates
LinkedIn people-search links for each one, and drafts one editable cold
outreach message you can copy and send yourself.

## Safety boundary (important)

This tool **never** automates LinkedIn actions:

- It does **not** auto-send messages, connect, follow, or click any LinkedIn button.
- It does **not** scrape LinkedIn search results.
- It does **not** bypass login, CAPTCHA, rate limits, or LinkedIn restrictions.
- It only reads the job page you are already viewing, generates search links,
  and copies message drafts to your clipboard.

Sending is always manual.

## Repo layout

```
linkedin-referral-assistant/
├── web-app/           # Next.js App Router app, runs at http://localhost:3000
├── chrome-extension/  # Manifest V3 extension you load unpacked
└── DEPLOYMENT.md      # GitHub/Vercel deployment checklist
```

---

## Web app setup

### 1. Install dependencies

```bash
cd web-app
npm install
```

### 2. Environment

No API key is required. The referral plan is generated locally with
deterministic rules.

You can still copy the example env file if you want a local placeholder:

```bash
cp .env.local.example .env.local
```

### 3. Run

```bash
npm run dev
```

Open <http://localhost:3000>.

For Vercel deployment, see [DEPLOYMENT.md](./DEPLOYMENT.md). When importing
the repo on Vercel, set the project **Root Directory** to `web-app`.

### Pages

- `/` — landing page and safety notes.
- `/referral` — main view. Accepts job data via query params (from the
  extension) or via manual entry. Click **Generate Referral Plan**.
- `/history` — list of jobs you've saved via **Save Job** (stored in
  `localStorage`).

### Rule-based generation

`/api/generate-referral-plan` uses deterministic local rules. It does not call
OpenAI, Anthropic, or any other model provider.

---

## Chrome extension setup

### 1. Load unpacked

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Choose the `chrome-extension/` folder.

You should see the extension icon in the toolbar. Pin it for convenience.

### 2. Use it

1. Make sure the configured web app is available. By default this is
   `http://localhost:3000`; for Vercel, edit `chrome-extension/config.js`.
2. Open a LinkedIn job, e.g.
   `https://www.linkedin.com/jobs/view/1234567890/`.
3. Click the extension's **Find Referral** button.
4. The extension extracts:
   - job title
   - company name
   - location
   - job URL
   - job description (truncated to a safe length)
5. A new tab opens at the configured `/referral` URL with the job data
   pre-filled.
6. Click **Generate Referral Plan**, then copy the cold outreach and open the
   LinkedIn search links the app suggests.

### How the data is passed

- **Short payloads** are passed via URL query params, the simplest path.
- **Long payloads** (big job descriptions) are stored in
  `chrome.storage.local`, then bridged into the web app's `localStorage`
  with a one-shot injected script before the page reloads. The
  `/referral` page reads it on mount.

### Permissions used

- `activeTab`, `scripting` — to run `content.js` in the LinkedIn tab you
  are viewing, only when you click the popup button.
- `storage` — for the bridge described above.
- `host_permissions` — `linkedin.com` (read job page), `localhost:3000`
  (local web app), and `*.vercel.app` (deployed web app).

---

## Customize the outreach message

Edit `connectionMessageFor` in `web-app/lib/rulePlan.ts` to tweak the default
cold outreach message. The current template is:

> Hi, I'm Junhui, a Brown DS master's grad focused on LLM/RAG. I'm applying
> for the [role] role at [company]. Do you happen to know the hiring team or
> referral process? I'd be grateful for any guidance and happy to chat briefly.

---

## API

### `POST /api/generate-referral-plan`

**Request body**

```json
{
  "jobTitle": "Data Scientist",
  "company": "Datadog",
  "location": "New York, NY",
  "jobUrl": "https://www.linkedin.com/jobs/view/1234567890/",
  "jobDescription": "..."
}
```

**Response**

```json
{
  "plan": {
    "jobSummary": "string",
    "targetPeople": [
      {
        "category": "Same-role employee",
        "whyRelevant": "...",
        "searchQuery": "Datadog \"Data Scientist\"",
        "linkedinSearchUrl": "https://www.linkedin.com/search/results/people/?keywords=...",
        "connectionMessage": "...",
        "followUpMessage": "",
        "referralAskMessage": ""
      }
    ]
  }
}
```

The route validates input, cleans the job title, builds three target
categories, creates LinkedIn people-search URLs, and returns one cold outreach
message per category.

---

## Troubleshooting

- **"Couldn't extract job details"** — LinkedIn rotates its DOM frequently.
  Scroll the job until title, company, and description are visible and try
  again. If it still fails, paste the text manually in the form on
  `/referral`.
- **Extension popup says "This isn't a LinkedIn job page"** — make sure
  the URL starts with `linkedin.com/jobs/view/` or `linkedin.com/jobs/search/`.
- **CORS or `localhost` refused** — confirm the web app is running on port
  3000 and is accessible at `http://localhost:3000`.

---

## Future extension points

- Save selected real profile data (when added manually).
- Outreach tracker (contacted / replied / follow-up needed).
- Optional Supabase / Postgres for cross-device sync.
