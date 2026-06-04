# Unified Chat Aggregator

Fresh local build for one real-time feed across Twitch, X, and Kick. Messages are normalized into one shape and rendered with source labels, channel/rule context, timestamps, search, source filters, pause/resume, clear, and a manual test pulse.

## Run

```sh
cd project/chat_aggregator
npm install
npm run dev
```

Open `http://127.0.0.1:8899`.

`npm run dev` enables demo messages so the UI can be tested with no credentials. For live sources, copy `.env.example` into your shell/export setup and run:

```sh
PORT=8899 DEMO_MODE=0 TWITCH_CHANNELS=twitchdev TWITCH_USERNAME=bot_login TWITCH_TOKEN=oauth:token KICK_CHANNELS=xqc X_BEARER_TOKEN=token X_RULES='HYPE OR polymarket' npm start
```

## Source Notes

Twitch uses IRC over WebSocket at `wss://irc-ws.chat.twitch.tv:443`, requests tags/commands, replies to `PING`, and parses `PRIVMSG`.

X uses the v2 filtered stream endpoint. If `X_RULES` is provided, missing rules are added without deleting existing rules.

Kick uses its public Pusher chat transport as a best-effort live reader. If Kick changes its public Pusher app key or payload shape, set `KICK_PUSHER_KEY`/`KICK_PUSHER_CLUSTER` or update `normalizeKickPayload` in `server.js`.

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Local HTTP port. Defaults to `8899`. |
| `DEMO_MODE` | `1` emits sample Kick/X/Twitch messages. |
| `TWITCH_CHANNELS` | Comma-separated Twitch channel names. |
| `TWITCH_USERNAME` | Twitch bot/login name. |
| `TWITCH_TOKEN` | Twitch user access token with `chat:read`. |
| `KICK_CHANNELS` | Comma-separated Kick channel slugs. |
| `KICK_PUSHER_KEY` | Kick Pusher key override. |
| `KICK_PUSHER_CLUSTER` | Kick Pusher cluster override. Defaults to `us2`. |
| `X_BEARER_TOKEN` | X API bearer token. |
| `X_RULES` | Comma-separated X filtered stream rules. `tag=rule` is supported. |
