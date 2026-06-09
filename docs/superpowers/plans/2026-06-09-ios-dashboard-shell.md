# Private iOS Dashboard Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first private Xcode-installed iOS shell for the MSFG dashboard without changing the active website code.

**Architecture:** Add an isolated `mobile/` Capacitor workspace that produces an iOS project under `mobile/ios/`. The shell proof loads `https://dashboard.msfgco.com` as the initial app URL so Xcode signing, Simulator launch, and device install can be proven before secure native auth and bundled assets are added.

**Tech Stack:** Node.js, npm, Capacitor, iOS/Xcode, WKWebView.

---

## File Structure

- Create `mobile/package.json`: owns mobile scripts and Capacitor dependencies.
- Create `mobile/capacitor.config.ts`: defines app id, app name, web directory, live dashboard URL, and allowed dashboard/API origins.
- Create `mobile/src/index.html`: local fallback page used when not loading the live dashboard URL.
- Create `mobile/src/styles.css`: simple fallback page styling.
- Create `mobile/scripts/build.js`: copies `mobile/src/` into `mobile/www/` for Capacitor.
- Create `mobile/README.md`: documents local build, Xcode open, Simulator run, and iPhone install notes.
- Generate `mobile/package-lock.json`: locks installed Capacitor package versions.
- Generate `mobile/ios/`: Xcode iOS project created by `npx cap add ios --packagemanager SPM`.

Existing dashboard source files outside `mobile/` must not be edited in this first milestone.

---

### Task 1: Create Isolated Mobile Workspace Files

**Files:**
- Create: `mobile/package.json`
- Create: `mobile/capacitor.config.ts`
- Create: `mobile/src/index.html`
- Create: `mobile/src/styles.css`
- Create: `mobile/scripts/build.js`
- Create: `mobile/README.md`

- [ ] **Step 1: Add the mobile package manifest**

Create `mobile/package.json`:

```json
{
  "name": "msfg-dashboard-ios",
  "version": "0.1.0",
  "private": true,
  "description": "Private iOS shell for the MSFG dashboard.",
  "type": "module",
  "scripts": {
    "build": "node scripts/build.js",
    "sync:ios": "npm run build && cap sync ios",
    "open:ios": "cap open ios",
    "doctor": "cap doctor"
  },
  "dependencies": {
    "@capacitor/core": "^8.4.0",
    "@capacitor/ios": "^8.4.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^8.4.0",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Add the Capacitor configuration**

Create `mobile/capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.msfgco.dashboard',
  appName: 'MSFG Dashboard',
  webDir: 'www',
  server: {
    url: 'https://dashboard.msfgco.com',
    cleartext: false,
    allowNavigation: [
      'dashboard.msfgco.com',
      'api.msfgco.com',
      '*.amazoncognito.com'
    ]
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
```

- [ ] **Step 3: Add a local fallback page**

Create `mobile/src/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>MSFG Dashboard</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <main class="shell">
    <img class="logo" src="https://msfg-media.s3.us-west-2.amazonaws.com/Assets/LOGOS/MSFG+Home+Loans/MSFG+Clear+backdrop.png" alt="MSFG Home Loans" />
    <h1>MSFG Dashboard</h1>
    <p>This local shell is ready. The iOS proof build loads dashboard.msfgco.com from the Capacitor configuration.</p>
    <a class="button" href="https://dashboard.msfgco.com">Open Dashboard</a>
  </main>
</body>
</html>
```

- [ ] **Step 4: Add fallback page styling**

Create `mobile/src/styles.css`:

```css
:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172033;
  background: #f4f7fb;
}

* {
  box-sizing: border-box;
}

body {
  min-height: 100vh;
  margin: 0;
  display: grid;
  place-items: center;
  padding: 24px;
}

.shell {
  width: min(100%, 380px);
  text-align: center;
}

.logo {
  width: min(220px, 70vw);
  height: auto;
  margin-bottom: 28px;
}

h1 {
  margin: 0 0 12px;
  font-size: 28px;
  line-height: 1.15;
}

p {
  margin: 0 0 24px;
  color: #516071;
  line-height: 1.5;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 8px;
  color: #fff;
  background: #155f83;
  text-decoration: none;
  font-weight: 700;
}
```

- [ ] **Step 5: Add the build script**

Create `mobile/scripts/build.js`:

```js
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'src');
const dest = resolve(root, 'www');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

console.log(`Built Capacitor web assets: ${dest}`);
```

- [ ] **Step 6: Add the mobile README**

Create `mobile/README.md`:

```md
# MSFG Dashboard iOS Shell

Private iOS shell for personal MSFG dashboard use.

## First-Time Setup

```bash
cd mobile
npm install
npm run build
npx cap add ios --packagemanager SPM
npm run sync:ios
npm run open:ios
```

## Xcode Simulator

1. Open `mobile/ios/App/App.xcodeproj`.
2. Select an iPhone simulator.
3. Press Run.

## iPhone Install

1. Connect the iPhone to the Mac and trust the computer.
2. Open `mobile/ios/App/App.xcodeproj`.
3. Select the physical iPhone as the run target.
4. In Xcode, set the signing team for the `App` target.
5. Press Run.
6. If iOS asks, trust the developer profile in Settings.

## Current Scope

This first shell proof loads `https://dashboard.msfgco.com` from the Capacitor config. Secure native Cognito auth, Keychain token storage, bundled dashboard assets, and mobile UI fixes are later milestones.
```

- [ ] **Step 7: Build local web assets**

Run:

```bash
cd mobile
npm run build
```

Expected: command exits 0 and prints `Built Capacitor web assets:`.

- [ ] **Step 8: Commit workspace files**

Run:

```bash
git add mobile/package.json mobile/capacitor.config.ts mobile/src/index.html mobile/src/styles.css mobile/scripts/build.js mobile/README.md
git commit -m "Add private iOS mobile workspace"
```

Expected: commit succeeds.

---

### Task 2: Install Capacitor And Generate iOS Project

**Files:**
- Generate: `mobile/package-lock.json`
- Generate: `mobile/ios/`

- [ ] **Step 1: Install mobile dependencies**

Run:

```bash
cd mobile
npm install
```

Expected: command exits 0 and creates `mobile/package-lock.json`.

- [ ] **Step 2: Run Capacitor doctor**

Run:

```bash
cd mobile
npm run doctor
```

Expected: command exits 0 or reports only non-blocking environment guidance. If it reports a missing iOS platform, continue to Step 3 because this task creates it.

- [ ] **Step 3: Generate the iOS platform**

Run:

```bash
cd mobile
npx cap add ios --packagemanager SPM
```

Expected: command exits 0 and creates `mobile/ios/App/App.xcodeproj`.

- [ ] **Step 4: Sync web assets into iOS**

Run:

```bash
cd mobile
npm run sync:ios
```

Expected: command exits 0 and copies `mobile/www/` assets into the iOS project.

- [ ] **Step 5: Verify Xcode project metadata**

Run:

```bash
xcodebuild -list -project mobile/ios/App/App.xcodeproj
```

Expected: output includes scheme `App`.

- [ ] **Step 6: Commit generated iOS project**

Run:

```bash
git add mobile/package-lock.json mobile/ios
git commit -m "Generate Capacitor iOS project"
```

Expected: commit succeeds.

---

### Task 3: Verify Simulator Build

**Files:**
- Modify only if generated signing/build settings require safe local defaults: `mobile/ios/App/App.xcodeproj/project.pbxproj`

- [ ] **Step 1: List available iPhone simulators**

Run:

```bash
xcrun simctl list devices available | grep -E "iPhone|Booted" | head -20
```

Expected: at least one iPhone simulator appears.

- [ ] **Step 2: Build for iOS Simulator**

Run:

```bash
xcodebuild \
  -project mobile/ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  build
```

Expected: output ends with `** BUILD SUCCEEDED **`.

- [ ] **Step 3: Commit build-setting fixes if needed**

If Step 2 required changes to generated project settings, run:

```bash
git add mobile/ios/App/App.xcodeproj/project.pbxproj
git commit -m "Fix iOS simulator build settings"
```

Expected: commit succeeds only if a project file changed. If no file changed, skip this step.

---

### Task 4: Document Completion State

**Files:**
- Modify: `mobile/README.md`

- [ ] **Step 1: Add verified commands to README**

Append a `Verified Locally` section to `mobile/README.md`:

```md
## Verified Locally

- `npm run build`
- `npm run sync:ios`
- `xcodebuild -list -project mobile/ios/App/App.xcodeproj`
- `xcodebuild -project mobile/ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' build`
```

- [ ] **Step 2: Commit documentation update**

Run:

```bash
git add mobile/README.md
git commit -m "Document iOS shell verification"
```

Expected: commit succeeds.

---

## Self-Review

- Spec coverage: this plan implements the first Xcode shell proof, creates the isolated `mobile/` workspace, preserves the active site, and documents build/install steps. Later spec items for native Cognito auth, Keychain storage, CORS, mobile UI audit, push notifications, and scanner/file native capabilities remain intentionally outside this first milestone.
- Placeholder scan: no placeholder markers or vague implementation-only steps are allowed.
- Type consistency: `mobile/capacitor.config.ts`, `mobile/src/`, `mobile/www/`, `mobile/scripts/build.js`, and `mobile/ios/` paths match across all tasks.
