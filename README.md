# AutoPost

Multi-platform content syndication console with RSS/Atom/Sitemap discovery, public Gravatar linked-site syncing, server-side Gemini 15-field copy generation, `@resvg/resvg-js` 1200×630 PNG thumbnails, SQLite deduplication ledger, and 11 official social API publishers.

## Architecture

- **Frontend (`src/` + `static-app/`)**: React + Vite + Tailwind CSS workspace. Supports both same-origin full-stack serving and static GitHub Pages (`main / (root)` or `./dist` via GitHub Actions) connected to a live backend (`?api=https://your-server` or `VITE_API_BASE_URL`).
- **Backend (`server.ts` + `server/`)**: Express + SQLite (`data/autopost.sqlite`) + daily scheduler + scrypt/SHA-256 session & Bearer auth + HMAC-SHA256 signed public `/api/media/...` PNG links + `@google/genai` server-side copy writer.
- **Headless CLI (`scripts/autopost-cli.ts`)**: Runs exported `config.yaml` workflows directly in GitHub Actions (`.github/workflows/autopost.yml`).

## Quick Start (Local Full-Stack)

```bash
npm install
GEMINI_API_KEY="your-key" npm start
```

Open `http://localhost:3000`.

## Deploying the Node Backend (Cloud Run / Render / Docker)

```bash
docker build -t autopost .
docker run -p 8080:8080 -e GEMINI_API_KEY="your-key" -v autopost_data:/app/data autopost
```

On Google Cloud Run:

```bash
gcloud run deploy autopost \
  --source . \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY="your-key"
```

## GitHub Pages Deployment

1. **Deploy from `main / (root)`**: Root `index.html` automatically loads the prebuilt `./static-app/app.js` bundle on `*.github.io` hosts.
2. **Deploy via GitHub Actions (`.github/workflows/deploy.yml`)**: Optionally set repository variable `VITE_API_BASE_URL` to your Cloud Run / Render backend URL so the frontend connects automatically on load, or append `?api=https://your-backend-url` in the browser URL.
