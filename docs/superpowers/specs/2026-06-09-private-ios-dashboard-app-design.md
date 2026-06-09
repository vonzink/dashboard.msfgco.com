# Private iOS Dashboard App Design

- **Date:** 2026-06-09
- **Status:** Approved design, pre-implementation
- **Topic:** Build an installed iPhone app for personal MSFG dashboard use through Xcode, without App Store or enterprise distribution.

## Problem

The MSFG dashboard currently runs as a web application at `dashboard.msfgco.com` with a static frontend, shared JavaScript/CSS, and an Express API backend at `api.msfgco.com`. The backend already owns sensitive server-side behavior: Cognito JWT verification, DB-backed user lookup, MySQL data, S3 file flows, calendar sync, Monday integration, notifications, chat, checklists, pipeline data, and admin routes.

The goal is to make this available as an actual installed iPhone app built through Xcode for one private user. This is not an App Store app, not an Apple Business Manager app, and not an enterprise MDM rollout.

## Goals

- Create a real iOS app project that opens and runs from Xcode on the user's iPhone.
- Reuse the existing dashboard and API contracts wherever practical.
- Preserve backend authorization rules and Cognito identity.
- Move the secure app release path away from browser-only token storage and toward native iOS token storage.
- Keep the first implementation small enough to validate on device before broad mobile UI work.
- Document the exact local build, simulator, and iPhone install commands.

## Non-goals

- Public App Store submission.
- Apple Business Manager, MDM, or employee-wide distribution.
- A full Swift rewrite of the dashboard.
- Rebuilding the backend API.
- Offline-first behavior for sensitive dashboard data.
- New account management or user provisioning.

## Recommended Architecture

Use Capacitor as the iOS shell. Capacitor gives the project an Xcode-managed iOS target while allowing the existing dashboard frontend to keep running in a WKWebView-based runtime. Native iOS plugins can be added where security or device behavior needs more than browser APIs.

The app should live in a separate `mobile/` workspace so it does not disturb the existing static dashboard files:

```text
mobile/
  package.json
  capacitor.config.ts
  ios/
  src/ or www/
```

The backend remains the source of truth:

```text
iOS app shell
  -> dashboard frontend
  -> https://api.msfgco.com/api
  -> Cognito JWT verification
  -> existing DB/services/integrations
```

## Build Strategy

### Slice 1: Xcode Shell Proof

Create the smallest Capacitor iOS project that launches in Simulator and on an attached iPhone.

For speed, this slice may load the live dashboard URL or a minimal local placeholder while the iOS project, signing, bundle ID, icons, and device install process are proven.

This slice is not the secure release target. It is a setup proof only.

### Slice 2: Secure App Shell

Move the app to bundled dashboard assets or a controlled mobile web bundle served through Capacitor's local app origin, then connect to the production backend API.

This avoids treating the private app as only a remote website container and gives us control over app-specific JavaScript bridges, mobile routing, asset versioning, and native auth integration.

### Slice 3: Mobile Usability

Audit and fix the highest-value dashboard workflows at iPhone dimensions:

- login/session state
- dashboard home
- company calendar
- pipeline/tasks/notifications
- user profile/settings
- file/scanner flows only if needed for personal daily use

Admin-heavy tools can remain desktop-first unless the user explicitly needs them on iPhone.

## Authentication Design

The existing web app uses Cognito Hosted UI with authorization-code PKCE and stores tokens in browser storage/cookies. The iOS app should keep the Cognito Hosted UI and PKCE model, but move token ownership into native iOS code.

Target behavior:

1. User taps sign in.
2. Native auth plugin starts a Cognito authorization-code PKCE flow through `ASWebAuthenticationSession`.
3. Cognito redirects back to an app callback URL registered for the iOS bundle.
4. Native code exchanges the authorization code for tokens.
5. ID/access/refresh tokens are stored in iOS Keychain.
6. Dashboard requests ask the native bridge for a valid bearer token.
7. API calls continue sending `Authorization: Bearer <jwt>` to the existing backend.

The backend's existing Cognito JWT verification can stay mostly unchanged because the request format remains bearer JWTs.

## Required Cognito Configuration

Create or update a Cognito app client for the iOS app:

- Enable authorization-code grant with PKCE.
- Add an app callback URL such as `msfgdashboard://auth/callback`.
- Add a sign-out callback URL if logout uses Cognito's logout endpoint.
- Keep scopes limited to the existing needs: `openid`, `email`, and `profile` unless backend requirements change.
- Do not add a client secret to the iOS app. Native/mobile public clients cannot protect embedded secrets.

The existing web callback `https://dashboard.msfgco.com/login-callback.html` should remain for the browser version.

## Token And Secret Storage

Release-quality iOS builds should not depend on `localStorage` or shared web cookies for the main session.

Use Keychain for:

- refresh token
- ID token
- access token
- token expiry metadata if needed

Use normal app preferences only for non-sensitive settings such as theme or last selected role. The app should clear Keychain items on explicit logout and refresh tokens before expiry where Cognito allows it.

## API And Backend Changes

Expected backend work is small:

- Add the app origin to CORS if browser-origin requests come from Capacitor, likely `capacitor://localhost`.
- Keep accepting bearer tokens in `Authorization`.
- Confirm websocket auth still works from the app for chat or live updates.
- Confirm file upload and S3 presigned URL flows work from iOS.
- Add small health or app bootstrap endpoints only if the app needs mobile-specific configuration.

The API should not trust the app merely because it is installed locally. All sensitive actions still require valid Cognito auth and existing role checks.

## Navigation And External Links

Internal dashboard routes should stay inside the app.

External systems should open outside the app in the system browser unless there is a clear reason to embed them:

- Monday
- LendingPad
- payroll
- Teams
- ChatGPT/Claude/other third-party links

This keeps third-party login cookies and unrelated browsing isolated from the dashboard app.

## Device Capabilities

Only add native device features when they directly support existing dashboard workflows:

- Camera or document picker for scanner/file workflows.
- File preview/share sheet for downloaded documents.
- Push notifications only after the app shell and auth are stable.
- Face ID app lock as a later security enhancement.

No native feature is required for the first Xcode install proof.

## Security Requirements

- No secrets committed to git.
- No Cognito client secret in the mobile app.
- Tokens stored in Keychain for secure release builds.
- Explicit logout clears native tokens and web runtime session remnants.
- WebView navigation is restricted to approved MSFG origins for internal content.
- External links leave the app.
- API remains fully authenticated and role-aware.
- Sensitive cached data is minimized; no broad offline data store in v1.
- Debug logging must not print tokens, authorization codes, refresh tokens, or PII-heavy API payloads.

## Testing And Verification

### Local

- `npm` install/build for the mobile workspace.
- `npx cap sync ios`.
- Open the generated iOS project in Xcode.
- Build and run in iPhone Simulator.

### Device

- Connect iPhone by USB or trusted wireless debugging.
- Select the device in Xcode.
- Build and run with the user's Apple developer signing profile.
- Verify install, app launch, login, API calls, logout, and relaunch session behavior.

### Functional Smoke

- Login succeeds.
- `/api/me` returns the correct user.
- Dashboard home loads.
- Company calendar loads entries and sync status.
- Pipeline/tasks/notifications load without CORS or auth failures.
- External links open outside the app.
- Logout clears session and returns to login.

## Rollout Plan

1. Create the `mobile/` Capacitor workspace and iOS target.
2. Prove Xcode simulator launch.
3. Prove direct install to the user's iPhone.
4. Wire the app to the existing dashboard/backend in the fastest safe way.
5. Add native Cognito auth and Keychain token storage.
6. Patch API/CORS and web client token access for the app environment.
7. Mobile-audit and fix the core workflows.
8. Document rebuild/reinstall steps.

## Open Risks

- Current dashboard pages may need real responsive fixes before they feel good on iPhone.
- Cognito callback settings must be updated before native auth can work end to end.
- Some existing flows may assume browser cookies, `localStorage`, popups, or desktop screen width.
- Direct Xcode install depends on local Apple signing setup and may require trusting the developer profile on the iPhone.
- Push notifications require extra Apple developer capability setup and should wait until the shell is stable.

## References Checked

- Capacitor iOS documentation: https://capacitorjs.com/docs/ios
- Capacitor configuration: https://capacitorjs.com/docs/config
- Apple `ASWebAuthenticationSession`: https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession
- Apple Keychain Services: https://developer.apple.com/documentation/security/keychain-services
- Amazon Cognito PKCE: https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html
- Amazon Cognito authorization endpoint and callback URL rules: https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html
