# Getting BoxCoach into the App Store and Play Store

The website (GitHub Pages) stays the main way to use and test BoxCoach. The store apps are the same
code wrapped with [Capacitor](https://capacitorjs.com): `ios/` and `android/` are the native
projects, `capacitor.config.json` the shared settings.

## What's ready

- Native projects for iPhone (`ios/`, Swift Package Manager, no CocoaPods) and Android (`android/`).
- App id `com.boxcoach.app`, name "BoxCoach", portrait only.
- Camera permission text (iPhone) and camera permission (Android).
- App icons and splash screens for both, from `resources/icon.png` and `resources/splash.png`
  (re-run `npx @capacitor/assets generate --ios --android` after changing them).
- The tracking runtime and models ship inside the app (`npm run vendor`), so the store app works
  offline from the first launch and downloads no code. Apple rejects apps that download code.
- Privacy policy: `web/privacy.html`, live at
  https://kennithdones8-glitch.github.io/box-coach/privacy.html

## Build the apps

```sh
npm install
npm run native:sync      # bundles the tracking model (~65 MB) and copies web/ into both apps
npm run native:android   # opens Android Studio → Run, or Build → Generate Signed Bundle
npm run native:ios       # opens Xcode (Mac only) → pick your team → Run / Product → Archive
```

No Mac? The iPhone build can run on GitHub Actions' macOS machines and upload to TestFlight. That
needs the Apple developer account first (below); then the workflow can be added.

## Before submitting

1. **Accounts**: Apple Developer Program ($99/year), Google Play Console ($25 once).
2. **App id**: `com.boxcoach.app` must be unique on each store; change it in
   `capacitor.config.json` (and run `npx cap sync`) before the first upload if it's taken.
3. **Support contact**: both stores require a support email or URL. Add one to
   `web/privacy.html` (Contact) and the store listings.
4. **Store listing**: name, subtitle, description, keywords, category (Health & Fitness), age
   rating (4+ / Everyone).
5. **Screenshots**: iPhone 6.7" and 6.5" (1290×2796, 1242×2688), Android phone. Take them from
   Today, Coach me, a live round with the camera, the punch test result, Progress.
6. **Privacy answers**: Apple "Data not collected"; Google Data safety "No data collected or
   shared". (The optional Claude check sends frames only with the user's own key, on request.)
7. **Test on real phones** via TestFlight (iPhone) and an internal testing track (Android).

## Paid version (later)

Decide the free/Pro split first. In-app purchases on both stores go through their billing
(e.g. RevenueCat's Capacitor plugin keeps one code path for both).
