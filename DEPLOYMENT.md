# Deployment Checklist

This repo is ready for a GitHub to Vercel deploy. The web app lives in
`web-app/`, so Vercel must use that folder as the project root.

## 1. Push to GitHub

Important: on this machine, `git rev-parse --show-toplevel` currently resolves
to `/Users/junhuihuang/Desktop`. That means this project is inside a parent git
repo. Be careful not to push your whole Desktop by accident.

Recommended safest path:

```bash
cd /Users/junhuihuang/Desktop/linkedin-referral-assistant
git init
```

That creates a dedicated nested git repo for just this project folder.

From the repo folder:

```bash
git add .
git commit -m "Prepare Vercel deployment"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

If you intentionally want to keep using the parent Desktop git repo, skip the
nested `git init` step and create a normal commit from that repo setup instead.

## 2. Import on Vercel

1. Open Vercel and choose **Add New Project**.
2. Import the GitHub repo.
3. Set **Root Directory** to `web-app`.
4. Framework should auto-detect as **Next.js**.
5. No environment variables are required.
6. Deploy.

Expected Vercel settings:

```text
Root Directory: web-app
Framework Preset: Next.js
Build Command: npm run build
Install Command: npm install or npm ci
Output Directory: .next
```

## 3. Point the extension to Vercel

After Vercel gives you a URL, edit:

```text
chrome-extension/config.js
```

Change:

```js
globalThis.LRA_WEB_APP_URL = "http://localhost:3000/referral";
```

to:

```js
globalThis.LRA_WEB_APP_URL = "https://your-project-name.vercel.app/referral";
```

Then reload the unpacked extension in `chrome://extensions`.

The manifest already allows `https://*.vercel.app/*`. If you use a custom
domain, add that domain to `host_permissions` in `chrome-extension/manifest.json`.

## 4. Local verification before pushing

```bash
cd web-app
npm run lint
npx tsc --noEmit
npm run build
```

Extension sanity checks from the repo root:

```bash
node --check chrome-extension/background.js
node --check chrome-extension/popup.js
node --check chrome-extension/content.js
node --check chrome-extension/pageAction.js
node --check chrome-extension/profileContent.js
```
