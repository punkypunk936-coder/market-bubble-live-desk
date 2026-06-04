# Deployment

Deploy this as a Node web service. Static hosts will not work because the app keeps long-running source connections and streams updates to browsers through Server-Sent Events.

## Render

1. Create a new Web Service from the GitHub repo.
2. Set build command:

```sh
npm install
```

3. Set start command:

```sh
npm start
```

4. Add environment variables from `.env.example`.
5. Set `DEMO_MODE=0` when live credentials are ready.

## Railway

1. Create a new project from the GitHub repo.
2. Railway should detect Node automatically.
3. Add the environment variables from `.env.example`.
4. Set `DEMO_MODE=0` for live mode.

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

The demo feed uses Market Bubble-flavored sample messages and exercises the producer queue.
