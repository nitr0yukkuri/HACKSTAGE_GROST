# Deploy Now exhibition

This repository has a private exhibition copy of Hoshirube for the Deploy Now contest.

- Framework: Next.js
- Project root: `frontend`
- Production branch: `codex/deploy-now-exhibition`
- Install command: `npm ci --ignore-scripts`
- Build command: `npm run build`
- Output directory: `.next/standalone/frontend`
- Environment variables: set `NEXT_PUBLIC_SITE_URL` to the public Deploy Now origin so Open Graph and Twitter image URLs use the deployed host. Leave the API base unset to keep the exhibition in local demo mode with bundled sample books.
