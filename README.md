# Weight Tracker

A private, phone-friendly web app for tracking weight loss. No account, no server, no build step — your data stays in the browser on your device.

## Features

- Log one weigh-in per day in pounds; edit or delete any entry
- Chart with a smoothed trend line (1M / 3M / 1Y / All) and your goal line
- Goal weight with progress bar, recent pace (lb/week), and a projected goal date
- Stats: starting weight, total change, lowest, 7- and 30-day averages, BMI
- Export a backup (JSON) or CSV, and import either back in
- Works offline and can be added to your phone's home screen
- Light and dark mode follow your device setting

## Run it

It is plain HTML, CSS and JavaScript. Serve the folder with any static server:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Put it on your phone

Host the folder on any static host. With GitHub Pages: repository **Settings → Pages → Deploy from a branch**, pick the branch and `/ (root)`. Open the resulting URL on your phone and choose **Add to Home Screen** from the browser's share/menu.

## About your data

Weigh-ins are saved in the browser's local storage, so they exist only in that browser on that device. Clearing site data removes them — use **Settings → Export backup** now and then, and **Import** to restore or move to another device.

BMI and the projected goal date are rough estimates, not medical advice.
