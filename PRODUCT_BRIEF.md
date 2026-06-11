# Market Bubble Live Desk: Simple Product Brief

## One-Line Pitch

Market Bubble Live Desk turns Twitch, Kick, and X chatter into a focused internal rundown for a live Market Bubble show.

## What It Is

This is not a public chat app.

It is a backstage producer desk for the Market Bubble team.

When the show is live, the producer can see audience messages, market reactions, clip ideas, and topic momentum in one place instead of jumping between tabs.

## Why It Exists

Market Bubble moves fast.

The show jumps between crypto, prediction markets, AI, sports, culture, and audience speculation. Useful signals can get buried quickly.

The desk helps the operator answer one simple question:

> What is worth bringing to the hosts right now?

## What It Does

- Pulls Twitch, Kick, and X into one live feed.
- Labels every message by source.
- Shows which Market Bubble segment each message belongs to.
- Shows which core show pillar each message supports: make money, leverage AI, or command attention.
- Marks each message as `Use Now`, `Watch`, `Park`, or `Noise`.
- Routes good items into `Host Queue`.
- Separates questions, market signals, and clip candidates.
- Suppresses repeated text so one recycled message does not take over the feed.
- Opens on the `Use Now` feed for the current segment.
- Shows topic momentum in `Topics`.
- Gives the producer a clear `Next` instruction at the top of the desk.
- Creates copyable focus briefs and segment rundowns.
- Includes a latest-show rehearsal mode for demos and dry runs.
- Includes previous-show context so the tool feels built for Market Bubble, not generic livestreaming.
- Includes AWS Elastic Beanstalk deployment docs for an always-live web version.

## Recent Fixes

The biggest recent improvement is the simplified operator flow.

Before, the app could over-prioritize keyword hits like `HYPE`, `Polymarket`, or `ETH`. That made some feed items look important even when they were not useful.

Now the app asks a better question:

> Is this actually usable by the operator?

The feed now sorts messages into:

- `Use Now`: relevant to the current segment and worth acting on.
- `Watch`: potentially useful, but not urgent.
- `Park`: useful, but belongs to another segment.
- `Noise`: low-information chatter.

Example:

- `Ask Ansem what invalidates the ETH trade` becomes useful.
- `HYPE just different` becomes noise.

That makes the desk easier to skim during a real stream.

The first screen now starts with:

- `Next`: the best action for the producer right now.
- `Use Now`: the default feed view for the live show part.
- `Topics`: what is building across sources.
- `Host Queue`: the clean queue for hosts, clips, and segment notes.

## How A Producer Uses It

1. Open the desk before the show.
2. Set `Show Part` to the current show block.
3. Read `Next` first.
4. Use `Show Me` to move between `Use Now`, `Later`, and `All`.
5. Queue the best question, signal, or clip.
6. Park off-segment items for later.
7. Copy the segment brief or rundown when the hosts need a clean handoff.

The producer does not need to read everything.

The product should reduce the room to a short list of useful moves.

## What Makes It Different

A basic chat aggregator says:

> Here are all the messages.

Market Bubble Live Desk says:

> Here is what matters for this segment, and what the operator should do with it.

It also says why the item matters: money, AI leverage, or attention.

That is the difference.

## Best Use Case

This is best for:

- live podcast producers
- Market Bubble show operators
- clipping teams
- social/media operators
- creator-led market shows
- teams monitoring audience reaction across multiple platforms

## Current Status

The product is ready for internal review and demo mode.

It can run locally today, and the repo includes deployment guidance for putting it online as a long-running Node web service.

The recommended first deployment path is AWS Elastic Beanstalk because the app uses live server connections and should not be deployed as a static site.
