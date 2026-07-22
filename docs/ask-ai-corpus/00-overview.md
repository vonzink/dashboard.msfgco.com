---
visibility: PUBLIC
---
# MSFG Dashboard — Overview

## What it is
The MSFG Dashboard (dashboard.msfgco.com) is Mountain State Financial Group's internal staff portal: a single long-scroll home page plus a top navigation bar of menus that link out to other internal tools. There's no separate "page" for each feature — most of the dashboard's own data (Goals, News, Pre-Approvals, Applications, Pipeline, Loans Funded) lives as sections you scroll through on the home page, while HR, Systems, Marketing, Programs, Investors, and Tools are dropdown menus in the top nav that open modals or link to outside systems.

## How to find it
Sign in at dashboard.msfgco.com — you're redirected automatically to sign-in if you don't have a session (see Login below). Once in, the header has a logo, a utility toolbar (Rates, Applications, Alerts, Settings, Admin), your user info, and a dark/light theme toggle. Below that is the main navigation bar with dropdown menus. The rest of the page is the scrolling section stack.

## The 6 scroll sections (home page, top to bottom)
- **Goals** — units/volume performance tiles for the loan officer, with a period selector. See the Goals guide.
- **News & Announcements** — a filterable carousel of company announcements (Rates, Events, Training, Alerts categories) plus a link to the full archive.
- **Pre-Approvals** — Monday.com-synced pre-approval list. See the Pre-Approvals guide.
- **Applications** — placeholder section for applications coming in from MSFG Apps; currently shows an empty state.
- **Loan Pipeline** — active loan rows with status dropdowns and Monday.com sync. See the Pipeline guide.
- **Loans Funded** — funded-loan archive with period/board/group filters. See the Funded Loans guide.

## Top navigation menus (not scroll sections — dropdowns/modals)
- **HR** — View Paycheck, 401K, Handbook, Training, FAMLI, Employee Posters, and a searchable Team Directory of employee contact cards.
- **Systems** — links out to Go High Level, LendingPad, Monday.com, MMI, Loan Sifter, List Reports, Passport, Fidelity Live Farm, Flueid, Document Scanner, KBase Docs, Dropbox, Advantage Credit, Microsoft, and AI tools (AngelAI, ChatGPT, Claude).
- **Schedule** — Company Calendar (opens in-app) and Meeting Rooms (Teams).
- **Marketing** — Logos browser (brand assets), Keyword Explorer, Content Studio (AI social content generation), and links to the company's social accounts.
- **Programs** — quick-reference program sheets by loan type: Conventional, FHA, VA, USDA, Non-QM, Other.
- **Investors** — "Show All" opens the full investor directory modal; the menu also lists individual wholesale partners, and admins get a "Manage Investors" option.
- **Tools** — Loan Calculator Hub, Document Creator, MSFG Docs (forms library), Processing, and a "More…" submenu with the Mil Levy Calculator, Time Calculator, and Document Scanner.

## Header utility buttons
- **Rates** — today's rate sheet.
- **Applications** — opens app.msfgco.com in a new tab.
- **Alerts** (bell icon) — notifications panel.
- **Settings** (gear icon) — user settings, including the Goals target-setting tab.
- **Admin** (shield icon, admins only) — admin settings panel.

## Login
Visiting the dashboard without a valid session redirects to `login.html`, which immediately (no button click needed) redirects to the AWS Cognito hosted sign-in page using PKCE OAuth 2.0. After signing in there, Cognito redirects back to the dashboard with a session. There's no separate username/password form built into the dashboard itself.

## Dark / light theme
The moon/sun icon button in the top-right of the header toggles between dark and light mode. The dashboard also respects your OS's dark-mode preference automatically until you toggle it manually, at which point your choice is remembered.

## Ask AI / Team Chat
The robot-icon button floating in the corner of every page opens a panel with two tabs: **Ask AI** (ask questions about how to use the dashboard or find something — this assistant) and **Team Chat** (internal messaging with tags and file attachments). When an answer suggests a specific dashboard section, a "Take me there" button scrolls you straight to it.

## FAQ
**Q: Where do I sign in?**
A: Go to dashboard.msfgco.com; if you're not already signed in you're redirected to the Cognito sign-in page automatically.

**Q: How do I switch to dark mode?**
A: Click the moon/sun icon in the top-right of the header.

**Q: I don't see a page for Applications — is that broken?**
A: No — the Applications section on the home page is a placeholder for loans coming in from MSFG Apps and shows an empty state until that integration delivers data. Use the "Applications" header button to open app.msfgco.com directly.

**Q: Where do I go to browse logos or brand assets?**
A: Marketing menu → Logos.
