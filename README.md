# BoxCoach 🥊

A boxing coach that lives on your phone. It times your rounds, counts your punches, watches your guard, stance and footwork through the camera, gives feedback after every round and session, and **remembers your habits** so each workout builds on the last.

It's an installable web app (PWA): no app store, it works offline after the first load, and all your data stays on your phone.

## What it does

| | |
|---|---|
| **Round timer** | Bell, 10-second warning, rest countdown, presets (3×2, 6×3, 12×3, Tabata), screen stays awake |
| **Camera coach** | Prop the phone up 2–3 m away. On-device pose tracking (MediaPipe) counts and classifies punches (jab, cross, hooks, uppercuts) and grades:<br>• **Guard**: hands up between punches<br>• **Stance**: width, crossed feet<br>• **Bladed stance**: not squaring up<br>• **Footwork**: moving vs. planted<br>• **Head movement**: off the centre line<br>• **Hand return**: speed back to the face<br>• **Rear hand drop**: when you jab |
| **Live cues** | Spoken "Hands up", "Don't cross your feet", "Move your head"… plus a spoken report at the end of every round |
| **Motion mode** | Hold the phone or strap it to your wrist; the accelerometer counts punches and measures intensity. Good for bag work |
| **Combo caller** | Calls combos out loud at your level, mixing in drills for whatever you're working on |
| **Session feedback** | Scores, what went well, what to fix, round-by-round table, punch mix, drills for next time, effort (RPE) and notes |
| **Coach memory** | Tracks rolling averages per skill, spots habits that repeat across sessions, tells you when you've fixed one, keeps personal records and a streak, and picks **today's focus** |
| **Suggested workout** | Adds a round when you finished with gas left, backs off after a brutal session, and scales combo difficulty with experience |
| **Weekly plan** | Tap your gym days each week and the coach fills the other days for a competing pro: a fight-pace bag simulation at your fight format, technique shadowboxing on your weak spot, fight-pace interval runs, strength, easy roadwork and rest. It keeps hard days apart, ticks sessions off as you log them, moves missed key sessions later in the week, trims volume after a rough week, and backs off when your effort ratings run high |
| **Fight phases** | Optional fight date: the plan runs build → fight camp → sharpen → taper toward it |
| **Weight** | Log your morning weight to get the 7-day average, weekly rate and distance to target. It warns you when you're losing more than 1% a week, and adds easy roadwork when you're behind |
| **Workout log** | Log runs, strength, jump rope, and sessions done without the app, so all your training is in one place |
| **Progress** | Charts for overall score, punches/min, guard, stance, footwork and weekly minutes |
| **Backup** | Export/import your data as JSON |

## Put it on your phone

The camera and motion sensors only work over **https**, so the app has to be hosted. GitHub Pages is set up already:

1. In this repo on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions** (one-time).
2. Push to `main` (or re-run the "Test and deploy to GitHub Pages" workflow). The workflow runs the tests and publishes the `web/` folder.
3. Open `https://<your-username>.github.io/<repo-name>/` on your phone.
4. **Add to Home Screen**. iPhone: Safari → Share → *Add to Home Screen*. Android: Chrome → ⋮ → *Install app*.
5. Under **Coach**, check your stance, fight format and target weight. Then tap this week's gym days under **Plan**.

## Getting good camera readings

- Phone upright at about waist height, facing you, 2–3 m back, with your whole body (head to feet) in frame.
- Light in front of you, not behind you.
- Face the camera the way you'd face an opponent.
- If punches are missed or over-counted, adjust **Punch detection sensitivity** under Coach.

Camera analysis is an estimate from a single phone camera. Treat it as a mirror that remembers, not a judge.

## Development

No build step; it's plain HTML/CSS/ES modules.

```bash
npm start   # serves web/ at http://localhost:8080 (localhost counts as secure, so the camera works)
npm test    # unit tests for pose analysis, punch detection, coach logic and storage
```

| File | Purpose |
|---|---|
| `web/js/form.js` | Pose → punches, guard, stance, footwork, cues |
| `web/js/motion.js` | Accelerometer punch detector |
| `web/js/coach.js` | Scoring, feedback, habit memory, focus, workout suggestions, combos |
| `web/js/plan.js` | Weekly plan, fight phases, rescheduling, weight trend |
| `web/js/app.js` | UI and live session flow |
| `web/js/pose.js` | Camera plus MediaPipe pose landmarker |
| `web/js/store.js` | Local storage, export and import |
| `web/js/timer.js` | Round timer |
| `web/js/audio.js` | Bell, beeps and voice |
| `web/js/chart.js` | Progress charts |
