# BoxCoach 🥊

A personal **boxing development system** that runs on your phone, not a fitness tracker. Every session, sparring round, drill, decision and coach note becomes evidence about your boxing. A development model is built from that evidence, and the training plan is the model's output.

It's an installable web app (PWA). It works offline after the first load, and all your data stays on your phone.

## Architecture

```
            ┌──────────────────────┐
            │ MEMORY (by source)   │  coach said · your notes · AI observations · measured
            └──────────┬───────────┘
                       ↓
┌─────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│ TRAINING LOG│──→│ DEVELOPMENT MODEL│←──│ CAMERA / VIDEO / IMU│
└─────────────┘   │ 18 skills from   │   └─────────────────────┘
                  │ evidence         │
                  └────────┬─────────┘
                           ↓
                  ┌──────────────────┐  problems · priorities · hypotheses
                  │ DECISION ENGINE  │  recovery · fight camp phase
                  └────────┬─────────┘
                           ↓
                  ┌──────────────────┐
                  │ ADAPTIVE PLAN →  │  week plan · "what should I train today?"
                  │ NEXT SESSION     │  constraint + opponent rounds
                  └──────────────────┘
```

The data model is built around **skills, observations, hypotheses, training stimuli (constraints, opponents, patterns), outcomes (per-round metrics, hits, decisions) and coach feedback**.

## Features

| # | Feature | Where |
|---|---|---|
| 1 | **Skill tree**: 18 attributes (footwork, distance, head movement, defense, jab, cross, hooks, uppercuts, combinations, counters, feints, timing, rhythm, angles, ring cutting, clinch, conditioning, fight IQ). Calculated from evidence and never set by hand, each with a confidence level and a list of the evidence behind it | Boxer → Skills |
| 2 | **Technique decay detection**: compares fresh rounds with late rounds and separates *technical* weakness (bad even when fresh) from *fatigue-induced* weakness (fine early, breaks late), with advice for each | Boxer → Analysis |
| 3 | **Training transfer score**: tracks each pattern through drilling → shadowboxing → bag → sparring (attempted and landed). The camera counts combinations automatically | Boxer → Analysis |
| 4 | **"Why did you get hit?"** Tap the reason after sparring (failed exit, hands down, rhythm, distance…); results are aggregated over your last 10 sessions and feed the plan | Log (sparring), Boxer → Analysis |
| 5 | **Style discovery**: tendencies (jab usage, movement, combination volume, body work, exits, counters) found from data, plus the style you currently lean towards, and how it has changed | Boxer → Style |
| 6 | **Decision drills**: fight scenarios with reaction time; wrong answers come back more often (spaced repetition); repeated mistakes are listed; builds a Fight IQ score | Coach → Fight IQ |
| 7 | **Randomised shadowboxing generator**: each round gets a constraint and sometimes an opponent, chosen from your weaknesses and gaps in exposure | Train, Today |
| 8 | **Constraint-based training**: rounds are problems to solve ("every combo ends with an exit"); compliance is auto-scored by the camera where possible, otherwise you rate it | Live session, post-session review |
| 9 | **Round-by-round fatigue map**: technique / pace / defense / footwork per round, and which one breaks first | Session summary, Boxer → Analysis |
| 10 | **Deload / overtraining logic**: session load (effort × minutes), acute vs 4-week chronic load, and morning check-ins (sleep, soreness, motivation, resting HR). Detects performance dropping while load rises and cuts volume automatically | Today, Plan |
| 11 | **Coach memory**: coach feedback, your observations, AI observations and measured data are kept separate. Tagged notes are traced over time ("recurring since August; 33% → 30% of hits; still appears under fatigue") | Coach → Memory |
| 12 | **Hypothesis system**: proposes hypotheses from your data, uses your last 3 weeks as the baseline, runs a 2-week intervention (injected into your plan), then reports supported / refuted / inconclusive with the effect size | Coach → Hypotheses |
| 13 | **Minimum effective dose**: finds the per-session rep count where jab/cross quality drops and warns you live when you pass it | Boxer → Analysis, live cue |
| 14 | **Opponent simulation**: 8 archetypes (pressure, counterpuncher, outfighter, southpaw, swarmer, body puncher, volume, clincher) with spoken prompts, plus an exposure map | Live session, Boxer → Analysis |
| 15 | **Fight camp mode**: set a date and opponent style. 8 weeks out: skill acquisition and volume. 5 weeks: tactical and opponent-specific. 3 weeks: fight-specific intensity. Fight week: taper | Coach → Settings |
| 16 | **Skill interference detection**: flags training congestion when more than 3 priorities are active, suggests the top 3 and lets you pause the rest | Coach → Priorities |
| 17 | **"What should I train today?"**: objective, why (with evidence), session blocks and minutes, priority order, a "do not add" list, and one tap to start | Today |
| 18 | **Development timeline**: month by month (weaknesses identified, blocks trained, skills improving) plus you 3 months ago vs now | Boxer → Timeline |
| 19 | **Proof of improvement**: every skill shows its 8-week change and the measured metrics behind it ("↓ 23% straight-back exits") | Boxer → Skills → tap a skill |
| 20 | **Video intelligence**: upload a video and it's analysed on-device. Every detection (punch type, guard drop, crossed feet, stance) comes with a confidence %, and you correct it before saving | Train → Analyse video |

Plus: a round timer with voice combos, the live camera coach, motion-sensor punch counting, a weekly plan built around your gym days, weight tracking, progress charts and JSON backup.

## Honest limits

- Camera analysis is an estimate from one phone camera. Confidence scores are shown so you can judge detections.
- Ratings start at 50 and only move with evidence. A skill with no evidence says so.
- Hypotheses are tests on your own data, not science. Small samples are labelled inconclusive rather than overclaimed.
- Decision-drill "best answers" follow conventional coaching; context in a real fight always matters.

## Put it on your phone

The camera and motion sensors only work over **https**, so the app needs to be hosted. GitHub Pages is already set up:

1. In this repo on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions** (one-time).
2. Merge to `main`. The workflow runs the tests and publishes the `web/` folder.
3. Open `https://<your-username>.github.io/<repo-name>/` on your phone.
4. **Add to Home Screen**. iPhone: Safari → Share → *Add to Home Screen*. Android: Chrome → ⋮ → *Install app*.

## Development

No build step; it's plain HTML/CSS/ES modules.

```bash
npm start   # serves web/ at http://localhost:8080 (localhost counts as secure, so the camera works)
npm test    # unit tests for the whole model: pose analysis, skills, decay, transfer, recovery, hypotheses, engine, plan
```

| Module | Purpose |
|---|---|
| `web/js/library.js` | Skills, hit reasons, constraints, opponents, decision scenarios, patterns |
| `web/js/skills.js` | Evidence extraction, ratings, proof of improvement, timeline, style |
| `web/js/analysis.js` | Fatigue map, decay, minimum effective dose, transfer, hit analysis, exposure |
| `web/js/recovery.js` | Load, readiness, deload detection |
| `web/js/hypotheses.js` | Hypothesis templates, testing, evaluation |
| `web/js/engine.js` | Problem ranking, priorities, round generator, today's session, AI observations |
| `web/js/plan.js` | Weekly plan, fight camp phases, rescheduling, weight |
| `web/js/coach.js` | Session scoring, feedback, habit memory |
| `web/js/form.js` | Pose → punches (with confidence), combinations, guard, stance, footwork |
| `web/js/views/*` | Boxer, Coach, review and video screens |
| `web/js/app.js` | Today, Plan, Train, Log, live session |
