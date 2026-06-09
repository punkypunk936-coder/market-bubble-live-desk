# Deployment

Deploy this as a Node web service. Static hosts will not work because the app keeps long-running source connections and streams updates to browsers through Server-Sent Events.

## Recommendation

Use Render Starter for the first external Market Bubble review.

Why:

- the repo already includes `render.yaml`
- it can auto-deploy from GitHub on every push
- it supports a long-running Node service
- it supports managed TLS and a public `onrender.com` URL
- the included persistent disk keeps `data/operator-state.json` across restarts

Do not use GitHub Pages, Vercel static hosting, Netlify static hosting, or any purely static host. The desk is a live Node server, not a static page.

## Render Always-On Path

1. In Render, create a Blueprint from the GitHub repo.
2. Render will read `render.yaml`.
3. Keep the service on `starter` or higher. Free is only useful for a temporary preview because it can spin down and lose local filesystem state.
4. Fill the synced secrets in the dashboard:

- `TWITCH_CHANNELS`
- `TWITCH_USERNAME`
- `TWITCH_TOKEN`
- `KICK_CHANNELS`
- `X_BEARER_TOKEN`
- `X_RULES`

5. Leave `DEMO_MODE=1` for a shareable review link.
6. Set `DEMO_MODE=0` when live credentials are ready.
7. Use `/healthz` as the health check path.

Manual Render setup also works:

- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/healthz`
- Persistent disk mount: `/opt/render/project/src/data`
- Minimum paid instance: Starter

## Railway

Railway is a strong quick-demo option if the team wants a fast public URL and simple GitHub deploys.

1. Create a new Railway project from the GitHub repo.
2. Railway should detect Node automatically or use the Dockerfile.
3. Add the environment variables from `.env.example`.
4. Keep it as a persistent service, not serverless, for live-show use.
5. Set `DEMO_MODE=1` for review, then `DEMO_MODE=0` for live mode.
6. Configure `/healthz` as the health check if Railway asks for one.

Railway is useful for speed. Render is the cleaner first recommendation here because the blueprint and disk config are now committed.

## Fly.io

Fly.io is a good fit if the team wants more control over regions and container behavior. It is more operational than Render or Railway and does not have a true free tier for always-on production use.

The repo includes `fly.toml` for an always-on demo service:

```sh
fly auth login
fly launch --copy-config --no-deploy
fly deploy
```

Default app URL:

```txt
https://market-bubble-live-desk.fly.dev
```

If the app name is taken, change `app` in `fly.toml` and deploy again.

## Docker

```sh
docker build -t market-bubble-live-desk .
docker run --rm -p 8899:8899 --env-file .env.example market-bubble-live-desk
```

## External Review Mode

For a shareable demo without exposing platform credentials:

```sh
DEMO_MODE=1 npm start
```

The demo feed uses Market Bubble-flavored sample messages based on prior show patterns and exercises the producer queue, radar, segment routing, and clip/question/signal workflow.
