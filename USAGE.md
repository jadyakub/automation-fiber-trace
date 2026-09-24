# Netlify Deployment

This project is designed for static hosting on Netlify.

## Recommended settings
- Production branch: `main`
- Build command: leave blank
- Publish directory: `.`

The repository includes `netlify.toml`, so Netlify can read the publish and header configuration automatically.

## Continuous deployment
Link this GitHub repository to Netlify. Each push to `main` will trigger a new production deployment.

## Data refresh
Fiber topology is loaded from the files under `/data/` with no-store caching headers. Updating the GeoJSON data files is enough to publish updated topology without changing the application code.
