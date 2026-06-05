# Market Bubble Live Desk

Internal live production desk for Market Bubble: one real-time, source-labeled feed across Twitch, X, and Kick, with a shared producer queue for questions, market signals, and clip candidates.

Market Bubble is built around prediction-market discourse: digital culture, sports, crypto, tech, attention, and speculation. This desk is meant for the room during live recording, not as a generic chat toy.

For a plain-English business pitch, see [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md).

## What It Does

- Merges Twitch, X filtered-stream posts, and Kick chat into one feed.
- Labels every item by source and channel/rule.
- Auto-tags messages as `Question`, `Market`, `Clip`, `Culture`, or `Chat`.
- Scores messages against the Market Bubble watchlist and exposes a `High Signal` view.
- Shows matched watchlist terms directly on rows and queued items.
- Adds `Segment Mode` for the current show block: Future-Proof, Culture Shock, Pick n' Roll, or The Price Is Wrong.
- Adds a `Signal Radar` that ranks active watchlist topics by recent heat, source mix, and high-signal count.
- Generates a copyable focus brief with current-segment timing, source mix, sample message, and a suggested on-air move.
- Lets producers queue items as on-air questions, market signals, or clip candidates.
- Stamps queued items with the active segment and sorts the active segment to the top.
- Persists recent feed history and the operator queue to `data/operator-state.json` so a restart does not wipe the live rundown.
- Shows per-source freshness so operators can see whether a source is live or stale.
- Keeps a run-of-show panel for Future-Proof, Culture Shock, Pick n' Roll, and The Price Is Wrong.
- Runs in demo mode without credentials for review.
- Stays read-only against external platforms: it does not post back into Twitch, X, or Kick.

## Local Run

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:8899`.

`npm run dev` enables demo messages. For live mode:

```sh
DEMO_MODE=0 \
TWITCH_CHANNELS=marketbubble \
TWITCH_USERNAME=bot_login \
TWITCH_TOKEN=oauth:token \
KICK_CHANNELS=marketbubble \
X_BEARER_TOKEN=token \
X_RULES='marketbubble OR "Market Bubble" OR polymarket OR Bullpen OR Ansem OR Banks OR HYPE' \
npm start
```

Replace the Twitch/Kick channel names with the actual live channel slugs if they differ.

## Producer Flow

1. Keep the main feed open during the live show.
2. Use source toggles and search to narrow the room.
3. Set `Segment Mode` to the current show block so the radar and queue are biased toward the right context.
4. Use the `View` controls to isolate questions, market signals, clip candidates, or culture chatter.
5. Use `High Signal` when the room gets loud; it prioritizes watchlist hits and show-relevant questions.
6. Use `Signal Radar` to see which watchlist topics are heating up across sources. Click a radar item to focus the feed.
7. Click `Copy Focus Brief` to hand a concise on-air prompt to the hosts or producer chat.
8. Click `Queue` for the app's best guess, or use `Ask`, `Signal`, and `Clip` to route a message manually.
9. Work the Operator Queue: `Done` closes an item, `Reopen` brings it back, `Copy` copies one item, and `Copy Rundown` copies the open queue grouped by segment.
10. Use `Auto-scroll` when actively watching live flow, and turn it off when reviewing older messages. `Dense` compresses the feed for high-volume moments.

## Deployment

This is a Node HTTP server with long-lived outbound connections and Server-Sent Events, so deploy it as a web service, not as static hosting.

Good fits:

- Render Web Service
- Railway service
- Fly.io app
- Any VPS/container host

See [DEPLOYMENT.md](DEPLOYMENT.md).

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Local HTTP port. Defaults to `8899`. |
| `DEMO_MODE` | `1` emits sample Kick/X/Twitch messages. |
| `WORKSPACE_NAME` | Header title. Defaults to `Market Bubble Live Desk`. |
| `WORKSPACE_CONTEXT` | Comma-separated context chips. |
| `WORKSPACE_WATCHLIST` | Comma-separated watchlist chips. |
| `TWITCH_CHANNELS` | Comma-separated Twitch channel names. |
| `TWITCH_USERNAME` | Twitch bot/login name. |
| `TWITCH_TOKEN` | Twitch user access token with `chat:read`. |
| `KICK_CHANNELS` | Comma-separated Kick channel slugs. |
| `KICK_PUSHER_KEY` | Kick Pusher key override. |
| `KICK_PUSHER_CLUSTER` | Kick Pusher cluster override. Defaults to `us2`. |
| `X_BEARER_TOKEN` | X API bearer token. |
| `X_RULES` | Comma-separated X filtered stream rules. `tag=rule` is supported. |

## Source Notes

Twitch uses IRC over WebSocket at `wss://irc-ws.chat.twitch.tv:443`, requests tags/commands, replies to `PING`, and parses `PRIVMSG`.

X uses the v2 filtered stream endpoint. If `X_RULES` is provided, missing rules are added without deleting existing rules.

Kick uses its public Pusher chat transport as a best-effort live reader. If Kick changes its public Pusher app key or payload shape, set `KICK_PUSHER_KEY`/`KICK_PUSHER_CLUSTER` or update `normalizeKickPayload` in `server.js`.
