# AWS Deployment

Deploy this as a long-running Node web service. Do not use static hosting: the desk keeps live source connections and streams browser updates through Server-Sent Events.

## Recommendation

Use AWS Elastic Beanstalk first.

Why this fits:

- it runs a normal Node.js web server
- it gives you a public AWS URL
- it handles EC2, load balancing, logs, health checks, and restarts
- it does not require Docker
- this repo now includes `Procfile` and `.ebextensions/01_market_bubble.config`

## Elastic Beanstalk Console Path

1. Open AWS Console.
2. Search for `Elastic Beanstalk`.
3. Click `Create application`.
4. Application name: `market-bubble-live-desk`.
5. Environment tier: `Web server environment`.
6. Platform: `Node.js`.
7. Application code:
   - easiest first pass: upload a source bundle zip from this repo
   - later: connect GitHub through AWS CodePipeline if you want automatic deploys
8. Environment type:
   - choose `Single instance` for the cheapest internal demo
   - choose `Load balanced` later if Market Bubble needs more reliability
9. Keep the default public URL.
10. Create the environment.

The app listens on `PORT=8080` in Elastic Beanstalk and exposes `/healthz` for health checks.

## Make The Source Bundle

From the repo root:

```sh
npm run bundle:eb
```

Upload `market-bubble-live-desk-eb.zip` to Elastic Beanstalk.

## First Review Mode

The checked-in Elastic Beanstalk config uses:

```txt
DEMO_MODE=1
PORT=8080
HOST=0.0.0.0
WORKSPACE_NAME=Market Bubble Live Desk
```

That gives you a shareable external demo without Twitch/X/Kick credentials.

## Live Source Mode

When the team is ready for real source ingestion, set these Elastic Beanstalk environment variables in `Configuration > Software > Environment properties`:

```txt
DEMO_MODE=0
TWITCH_CHANNELS=marketbubble
TWITCH_USERNAME=bot_login
TWITCH_TOKEN=oauth:token
KICK_CHANNELS=marketbubble
X_BEARER_TOKEN=token
X_RULES=marketbubble OR "Market Bubble" OR polymarket OR Bullpen OR Ansem OR Banks OR HYPE
```

Replace channel names and tokens with the real production values.

## Health Check

The repo sets the default process health check to:

```txt
/healthz
```

If the AWS console overrides this, set the health check path manually to `/healthz`.

## Local Run

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:8899`.
