# AGENTS.md

## Project Scope

- Work only inside `/Users/junhuihuang/Desktop/linkedin-referral-assistant` unless the user explicitly asks otherwise.
- This project contains a Next.js web app in `web-app/` and a Manifest V3 Chrome extension in `chrome-extension/`.
- Do not install or copy Claude Code skills into this repo unless the user explicitly asks.

## Repository Navigation

- Avoid broad recursive scans.
- Prefer targeted commands against known files and shallow directories.
- Ignore dependency and generated folders, including:
  - `node_modules`
  - `.git`
  - `.next`
  - `dist`
  - `build`
  - `.venv`
  - `venv`
  - `__pycache__`

## Working Style

- Explain the plan before editing files.
- Prefer small, reviewable changes.
- Keep code simple, typed, and beginner-readable.
- Follow existing project patterns before introducing new abstractions.
- Avoid speculative refactors or unrelated cleanup.

## Next.js Web App Guidance

- The web app lives in `web-app/`.
- Use existing App Router, component, and `lib/` organization.
- Keep client/server boundaries clear.
- Validate API route inputs and return clear, stable response shapes.
- Preserve mock/fallback behavior unless the user asks to change it.

## Chrome Extension Guidance

- The extension lives in `chrome-extension/`.
- Keep LinkedIn automation within the documented safety boundary.
- Do not add behavior that auto-sends messages, auto-connects, scrapes search results, bypasses login/CAPTCHA/rate limits, or clicks LinkedIn actions for the user.

## Security

- Do not overwrite secrets or `.env` files.
- Do not hardcode API keys, tokens, or credentials.
- Keep provider API keys server-side only.
- Be careful with user-provided job descriptions and generated text.

## Verification

- After code changes, run the relevant checks for the touched area when feasible.
- For web app changes, consider:
  - `npm run lint`
  - `npm run build`
  - focused tests, if tests exist or are added
- For UI flow changes, verify the affected page or flow in a browser when practical.
- If a check cannot be run, explain why.

## Task Wrap-Up

- Summarize changed files after each task.
- Mention which checks were run and whether they passed.
- Call out any remaining risks, skipped checks, or follow-up work.
