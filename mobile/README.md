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

## Verified Locally

- `npm run build`
- `npm run doctor`
- `npx cap add ios --packagemanager SPM`
- `npm run sync:ios`
- `xcodebuild -list -project mobile/ios/App/App.xcodeproj`
- `xcodebuild -project mobile/ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' build`

This project uses Swift Package Manager for Capacitor iOS dependencies, so CocoaPods is not required for the current shell proof.
