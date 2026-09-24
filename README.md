# Automation Fiber Trace

Mobile-first fiber topology tracing web app for DP → FDC route visualization and playback.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/jadyakub/automation-fiber-trace)

## V2 Features
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
- Validated topology check for all registered DP
- Clear DP / FDC / Joint / FD Cable markers
- Existing red/blue route layers explained in the UI
- Direction arrows on active DP → FDC route
- Stronger moving pulse and mobile quick playback bar
- OTDR Fault Locator: select FDP/DP + enter OTDR distance to locate suspected cut along registered fiber topology
- Suspected-cut GPS result with Google Maps quick open

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

Use the Deploy to Netlify button above, or import this repository from the Netlify dashboard. Production branch: `main`. Build command: leave blank. Publish directory: `.`.

## Data
Current seed topology:

`data/f14-kgu-c029m-1.geojson` through `data/f14-kgu-c029m-4.geojson`

The app intentionally fetches topology data with `no-store` behavior so future data replacement can refresh without rebuilding application code.
