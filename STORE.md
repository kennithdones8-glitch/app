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
- Support page (both stores ask for a support URL): `web/support.html`, live at
  https://kennithdones8-glitch.github.io/box-coach/support.html
- Screenshots, iPhone 6.7" (1290×2796): `store/screenshots/`. Apple scales them for smaller
  iPhones; Google Play accepts the same files.
- Listing text: below.

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
3. **Support email**: the support URL above is ready, but both stores also want a contact email
   on the listing (Google shows it publicly). Use a separate address for the app, not a personal
   one, and add it to `web/support.html`.
4. **Store listing**: the text below; category Health & Fitness; age rating 4+ / Everyone.
5. **Screenshots**: `store/screenshots/` covers Today, Coach me, a punch test result, Skills and
   Progress. A shot of a live round with the camera is worth adding from a real phone.
6. **Privacy answers**: Apple "Data not collected"; Google Data safety "No data collected or
   shared". (The optional Claude check sends frames only with the user's own key, on request.)
7. **Test on real phones** via TestFlight (iPhone) and an internal testing track (Android).

## Listing text

**Name:** BoxCoach
**Subtitle (Apple, 30 max):** Your boxing coach, on camera
**Short description (Google, 80 max):** Counts and reads your punches with the camera, and coaches your form.
**Keywords (Apple, 100 max):** boxing,shadowboxing,punch counter,heavy bag,boxing timer,coach,workout,mitts,fight,training

**Description:**

Prop your phone up, train, and BoxCoach watches.

• Counts your punches and reads them: jab, cross, hooks, uppercuts.
• Coaches your form out loud: hands up, move your feet, move your head. Short fixes, no chatter.
• Coach me: say how long you have, and it plans the session from what it has seen you do.
• Learns you: a 3-minute punch test shows what it read right and wrong, and tunes it to your punches
  and your camera spot.
• Progress: guard, output, punch mix and habits over weeks, and a weekly recap.
• Round timer, combo calls, fight simulations, sparring and coach notes in one log.

Private by design: no account, no ads, no tracking. The camera is read on your phone, video is never
uploaded, and your training data stays on your phone.

## Paid version (later)

Decide the free/Pro split first. In-app purchases on both stores go through their billing
(e.g. RevenueCat's Capacitor plugin keeps one code path for both).
