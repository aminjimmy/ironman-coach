# Ironman Coach

An installable triathlon training app (PWA) for Android phones, including the Galaxy Z Fold.
It runs full-screen from the home screen, works offline, and adapts its layout to the cover and inner screens.

## Features

- **Any race, any runway**: Ironman, 70.3, Olympic or Sprint. Pick a race date and training start date; the plan
  lays out Prep → Base → Build → Peak → Taper → Race week to fit the gap (1 week to 80+ weeks).
- **Volume-driven planning**: starts from your recent weekly hours (all sports combined), ramps ≤ ~10%/week with
  3:1 (or 2:1 if 50+) recovery cycles, and caps at the hours you have available.
- **Adaptive coach**: daily advice from fitness/fatigue/form (CTL/ATL/TSB), plan compliance, ramp rate and discipline balance,
  plus a volume suggestion for next week. Today's sessions are scaled when you're overly fatigued.
- **Strava sync**: OAuth, first sync pulls 26 weeks, then auto-syncs when the app opens (every 30 min max).
  Also imports **.FIT / .GPX / .TCX** files.
- **Workout insights**: HR / power / pace zones, NP, IF, VI, TSS, efficiency factor, aerobic decoupling,
  run cadence & stride length, splits, best efforts, VO₂max estimate, and plain-language notes.
- **Fitness level**: CTL level, VO₂max with age/sex category, W/kg, estimated thresholds, race-time prediction.
- **Food photo → macros**: snap a meal, Claude estimates items, grams, kcal, carbs, protein, fat; adjust portions and save.
  Daily targets adapt to the day's training (carbs g/kg by training hours).
- **Profile**: weight (with history), height, age, sex, HR/FTP/pace/CSS thresholds, rest-day preference.

- **Data-quality filter**: implausible workouts (e.g. a pool watch miscounting lengths) still count as load but don't skew
  your zones; each workout has "trust" / "use for estimates" switches.
- **Manual logging & plan tracking**: log swims without a watch, mark sessions done/skipped, move sessions, and mark
  sick/travel periods (the plan eases you back in after illness).
- **Zwift & treadmill**: every ride downloads as a Zwift `.zwo` workout; every run shows treadmill speed at 1% incline.
- **Swim comeback block** after a long break from the pool, plus **scheduled fitness tests** (FTP, 30-min run, CSS) with
  calculators that update your zones.
- **Heat & hydration**: local conditions → pace adjustment, sweat-rate tests, fluid and sodium targets.
- **Race-day plan**: heat-adjusted pacing, minute-by-minute fueling, carb-load and race-morning plan (printable).
- **Morning check-in**: sleep, soreness, energy, stress, resting HR/HRV → readiness score that steers the coach.
- **Faster food logging**: favourites, recent meals, Malaysian dishes, water tracker, automatic carb-load targets.
- **Calendar**: one-off `.ics` export or an auto-updating subscription link (via cloud sync).
- **Cloud backup & sync**: encrypted (AES-GCM, passphrase) backup in a secret GitHub Gist; merges between devices.

All data stays on the device (IndexedDB) unless you turn on cloud sync. Settings → Export backup also works.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # plan/metrics self-test
npm run build      # production build in dist/
```

## Put it on your phone

The app must be served over HTTPS to be installable and for Strava login. Pick one:

**A. GitHub Pages (free, auto-deploys)**
1. Create a GitHub repo (e.g. `ironman-coach`) and push this folder to `main`.
2. Repo → Settings → Pages → Source: **GitHub Actions**. The included workflow builds and deploys.
3. Your app is at `https://<username>.github.io/ironman-coach/`.

**B. Netlify / Cloudflare Pages (drag & drop)**
Run `npm run build` and upload the `dist/` folder (Netlify Drop: https://app.netlify.com/drop).

Then on the Z Fold: open the URL in **Chrome** → ⋮ → **Add to home screen** → **Install**.

## One-time setup inside the app

**Strava**: go to https://www.strava.com/settings/api, create an app, and set *Authorization Callback Domain*
to your app's host (e.g. `username.github.io`). Paste the Client ID and Client Secret in Settings → Connect.

**Food photos**: create an API key at https://console.anthropic.com/settings/keys and paste it in Settings.
Each photo costs roughly 1–3 US cents. The app calls `claude-opus-5-5` with structured JSON output and
server-side refusal fallback (`fallbacks: "default"`).

## Notes on the numbers

TSS, CTL/ATL/TSB, zones, VO₂max and race predictions are **calculated in the app** from your workouts and thresholds.
They are not Strava values. Thresholds marked "est." come from your hardest recent sessions (lower bounds) or from
experience-level defaults. Enter field-tested values in Me → Edit profile for accurate zones.
