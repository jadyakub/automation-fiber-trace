# Automation Fiber Trace

Mobile-first fiber topology tracing web app for DP → FDC route visualization and playback.

## V1 Features
- Load fiber topology from GeoJSON
- Auto-detect DP / FDC / Joint labels
- Tap or search DP to trace shortest connected fiber route back to `FDC KGU C029M`
- Highlight active route
- Animated moving trace icon
- Camera follow during playback
- Live distance covered + balance to FDC
- Slow / Normal / Fast playback
- Map / Satellite layer toggle
- Responsive desktop and mobile UI
- PWA-ready shell
- Netlify-ready static deployment

## Stack
- HTML
- Tailwind CSS CDN
- Vanilla JavaScript
- Leaflet
- GeoJSON
- Netlify static hosting

## Local Preview
Serve the folder with any static web server, for example:

```bash
python -m http.server 8888
```

Then open `http://localhost:8888`.

## Netlify
No build step is required. `netlify.toml` publishes the repository root.

Connect this repository to Netlify and deploy from the default branch.

## Data
Current seed topology:

`data/f14-kgu-c029m-1.geojson` through `data/f14-kgu-c029m-4.geojson`

The app intentionally fetches topology data with `no-store` behavior so future data replacement can refresh without rebuilding application code.
