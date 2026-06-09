const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { WebSocket } = require("ws");

const ROOT = __dirname;
const STATIC_DIR = path.join(ROOT, "gui");
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "operator-state.json");
const PORT = Number(process.env.PORT || 8899);
const HOST = process.env.HOST || "0.0.0.0";
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 500);
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const PERSIST_DEBOUNCE_MS = 250;
const TEXT_REPEAT_SUPPRESS_MS = Number(process.env.TEXT_REPEAT_SUPPRESS_MS || 120000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const SOURCE_LABELS = {
  twitch: "Twitch",
  x: "X",
  kick: "Kick",
  system: "System",
};

const DEFAULT_SEGMENTS = [
  {
    name: "Future-Proof",
    brief: "AI, compute, frontier tech, and post-AGI money rails.",
    keywords: ["ai", "agent", "agents", "compute", "near", "hyperliquid", "hype", "frontier", "spacex", "venice", "nuclear", "infrastructure"],
  },
  {
    name: "Culture Shock",
    brief: "Internet-native moments, creator drama, viral clips, and attention.",
    keywords: ["gta", "culture", "viral", "creator", "banks", "stream", "twitter", "x", "timeline", "attention", "clip", "mizkif", "faze", "ct"],
  },
  {
    name: "Pick n' Roll",
    brief: "Sports storylines, matchups, lines, and momentum.",
    keywords: ["nba", "nfl", "mlb", "ufc", "sports", "spread", "line", "game", "match", "baseball", "bullpen", "bet"],
  },
  {
    name: "The Price Is Wrong",
    brief: "Mispricings, sentiment gaps, and market probabilities.",
    keywords: ["60k", "liquidation", "liquidations", "funding", "open interest", "oi", "support", "resistance", "wick", "breakdown", "breakout", "mispriced", "probability", "odds", "polymarket", "zcash", "zec", "bitcoin", "btc", "eth", "ethereum", "sol", "solana", "market", "ticker", "short", "long"],
  },
];

const appConfig = {
  workspaceName: process.env.WORKSPACE_NAME || "Market Bubble Live Desk",
  eyebrow: process.env.WORKSPACE_EYEBROW || "Internal producer console",
  brandMark: process.env.WORKSPACE_MARK || "MB",
  buildLabel: process.env.BUILD_LABEL || "Live desk",
  buildCopy: process.env.BUILD_COPY || "Audience signals, routed for the room.",
  strategicPillars: [
    {
      id: "make-money",
      label: "Make Money",
      short: "Trades, odds, mispricings",
      detail: "Anything that helps the room find, challenge, size, or explain a trade.",
      keywords: ["money", "trade", "trades", "profit", "pnl", "position", "size", "sizing", "odds", "mispriced", "polymarket", "prediction", "btc", "bitcoin", "eth", "sol", "hype", "hyperliquid", "liquidation", "funding", "support", "resistance", "long", "short", "ticker", "stock", "equity", "sportsbook", "spread", "line"],
    },
    {
      id: "leverage-ai",
      label: "Leverage AI",
      short: "Agents, compute, automation",
      detail: "Anything that helps the show explain or use AI as a market and operating edge.",
      keywords: ["ai", "agent", "agents", "automation", "automate", "compute", "model", "models", "frontier", "openai", "anthropic", "venice", "nuclear", "infra", "infrastructure", "gpu", "data center", "data centres"],
    },
    {
      id: "command-attention",
      label: "Command Attention",
      short: "Clips, culture, social heat",
      detail: "Anything that can travel on X, TikTok, Shorts, or the timeline.",
      keywords: ["attention", "clip", "clips", "viral", "culture", "creator", "stream", "timeline", "x", "twitter", "tiktok", "shorts", "youtube", "guest", "faze", "banks", "ansem", "quote", "moment", "meme"],
    },
  ],
  context: envList("WORKSPACE_CONTEXT").length
    ? envList("WORKSPACE_CONTEXT")
    : ["Banks + Ansem", "Prediction markets", "Crypto + AI", "Sports + culture", "Thursdays 1PM PST"],
  previousEpisodes: [
    {
      title: "The Dollar Is Going to Zero",
      airDate: "June 5, 2026",
      themes: ["Bitcoin caution", "Hyperliquid strength", "Venice AI", "compounding"],
      deskFit: "Track market caution, AI rails, and clip-worthy guest moments in separate queues.",
    },
    {
      title: "Why Ansem Thinks Ethereum Is Done..",
      airDate: "May 22, 2026",
      themes: ["Ethereum debate", "Akash compute", "Crypto Twitter rankings", "Bullpen baseball spreads"],
      deskFit: "Route ETH/HYPE/compute into market or Future-Proof while Bullpen stays in Pick n' Roll.",
    },
    {
      title: "How to Get Rich Playing GTA 6",
      airDate: "May 15, 2026",
      themes: ["GTA 6", "HyperLiquid", "SpaceX", "attention economy", "sports investing"],
      deskFit: "Catch culture moments without losing market questions and prediction-market links.",
    },
    {
      title: "Why AI Is Beating Crypto Right Now",
      airDate: "May 8, 2026",
      themes: ["AI boom", "tickers", "clipping meta", "investing with limited time"],
      deskFit: "Surface practical viewer questions and clip candidates during AI versus crypto debates.",
    },
    {
      title: "The Truth About Crypto in 2026",
      airDate: "May 1, 2026",
      themes: ["Solana", "major coins", "For You content", "misinformation", "Dead Internet Theory", "AI infrastructure", "GTA 6", "FaZe"],
      deskFit: "Keep crypto, AI, and culture lanes clean so the hosts can move fast without tab switching.",
    },
  ],
  workflowFit: [
    {
      label: "Best fit",
      body: "Market Bubble repeatedly jumps across crypto, AI, culture, sports, and live audience speculation, so the desk should route signals by segment instead of showing raw chat as one stream.",
    },
    {
      label: "Producer job",
      body: "The operator should watch for questions, market signals, and clips, then hand hosts a concise queue instead of explaining the whole feed.",
    },
    {
      label: "Missing without this",
      body: "The team loses the thread when Polymarket, Bullpen, CT, Kick, Twitch, and guest reactions all move at once.",
    },
  ],
  latestEpisode: {
    title: "The Dollar Is Going to Zero",
    airDate: "June 5, 2026",
    sourceNote: "Built from the latest public Market Bubble episode listing and the show's public format.",
    thesis: "Operate the latest public episode flow first: Bitcoin caution, Hyperliquid conviction, Venice AI, guest-room energy, and Flood's compounding close.",
    segments: [
      {
        segment: "The Price Is Wrong",
        beat: "Bitcoin caution versus Hyperliquid conviction",
        producerGoal: "Queue one clean market-invalidation question and one practical position-sizing signal.",
      },
      {
        segment: "Future-Proof",
        beat: "Venice AI and private AI as a real product, not just an AI wrapper",
        producerGoal: "Separate investable infrastructure from product hype and save one plain-English host prompt.",
      },
      {
        segment: "Culture Shock",
        beat: "Mike Majlak guest energy and the clips that can travel after the episode",
        producerGoal: "Catch quotable reactions without letting culture chatter bury market questions.",
      },
      {
        segment: "Future-Proof",
        beat: "Flood's power-law compounding close",
        producerGoal: "Turn the closing thesis into a concise clip or follow-up question for the next show.",
      },
    ],
    watchTerms: ["Bitcoin", "BTC", "HyperLiquid", "HYPE", "Venice AI", "compounding", "Polymarket", "AI compute", "guest"],
  },
  segments: cloneSegments(DEFAULT_SEGMENTS),
  watchlist: envList("WORKSPACE_WATCHLIST").length
    ? envList("WORKSPACE_WATCHLIST")
    : ["Polymarket", "Bullpen", "Bullpen Competition", "BTC 60K", "liquidations", "Bitcoin", "funding", "open interest", "Zcash", "ZEC", "NEAR", "AI agents", "HYPE", "HyperLiquid", "Ethereum", "Solana", "GTA 6", "AI compute"],
};

function normalizeKeywordList(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  return raw
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 18);
}

function cloneSegments(segments) {
  return sanitizeSegments(segments, []);
}

function sanitizeSegments(input, fallback = DEFAULT_SEGMENTS) {
  const source = Array.isArray(input) ? input : [];
  const seen = new Set();
  const cleaned = source
    .map((segment) => {
      const name = String(segment?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
      if (!name) return null;
      const key = name.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        name,
        brief: String(segment?.brief || "").trim().replace(/\s+/g, " ").slice(0, 140),
        keywords: normalizeKeywordList(segment?.keywords),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
  if (cleaned.length) return cleaned;
  return fallback === input ? [] : sanitizeSegments(fallback, input);
}

function configuredSegmentNames() {
  return appConfig.segments.map((segment) => segment.name).filter(Boolean);
}

function normalizeSegmentName(value, fallback = appConfig.segments[0]?.name || "") {
  const requested = String(value || "").trim().toLowerCase();
  const match = configuredSegmentNames().find((name) => name.toLowerCase() === requested);
  return match || fallback;
}

function segmentForText(text, terms = []) {
  const normalizedTerms = Array.isArray(terms) ? terms : [terms].filter(Boolean);
  const value = `${text || ""} ${normalizedTerms.join(" ")}`.toLowerCase();
  const scored = appConfig.segments
    .map((segment) => {
      const keywords = normalizeKeywordList(segment.keywords);
      const score = keywords.reduce((total, keyword) => {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = keyword.length <= 3
          ? new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i")
          : new RegExp(escaped, "i");
        return total + (pattern.test(value) ? 1 : 0);
      }, 0);
      return { segment, score };
    })
    .sort((a, b) => b.score - a.score);
  if (scored[0]?.score > 0) return scored[0].segment.name;
  return normalizeSegmentName("The Price Is Wrong", appConfig.segments[0]?.name || "");
}

function remapSegmentName(value, previousSegments, nextSegments, text = "", terms = []) {
  const requested = String(value || "").trim().toLowerCase();
  const exact = nextSegments.find((segment) => segment.name.toLowerCase() === requested);
  if (exact) return exact.name;
  const previousIndex = previousSegments.findIndex((segment) => segment.name.toLowerCase() === requested);
  if (previousIndex >= 0 && nextSegments[previousIndex]) return nextSegments[previousIndex].name;
  return normalizeSegmentName(segmentForText(text, terms), nextSegments[0]?.name || "");
}

function applySegments(segments) {
  const previousSegments = cloneSegments(appConfig.segments);
  const nextSegments = sanitizeSegments(segments);
  appConfig.segments = nextSegments;
  state.showState = {
    currentSegment: remapSegmentName(state.showState.currentSegment, previousSegments, nextSegments),
    updatedAt: new Date().toISOString(),
  };
  state.history = state.history.map((message) => {
    const segment = remapSegmentName(message.segment, previousSegments, nextSegments, message.text, message.matchedTerms || []);
    return {
      ...message,
      segment,
      operator: message.operator ? { ...message.operator, segment } : message.operator,
    };
  });
  state.producerQueue = state.producerQueue.map((item) => ({
    ...item,
    segment: remapSegmentName(item.segment, previousSegments, nextSegments, item.text, item.matchedTerms || []),
    topicSegment: remapSegmentName(item.topicSegment, previousSegments, nextSegments, item.text, item.matchedTerms || []),
  }));
}

const state = {
  bootedAt: new Date().toISOString(),
  history: [],
  producerQueue: [],
  showState: {
    currentSegment: appConfig.segments[0]?.name || "",
    updatedAt: new Date().toISOString(),
  },
  clients: new Set(),
  seen: new Map(),
  recentText: new Map(),
  counts: { twitch: 0, x: 0, kick: 0, system: 0 },
  sources: {
    twitch: { enabled: false, status: "idle", detail: "No channels configured.", channels: [], lastMessageAt: null },
    x: { enabled: false, status: "idle", detail: "No bearer token configured.", rules: [], lastMessageAt: null },
    kick: { enabled: false, status: "idle", detail: "No channels configured.", channels: [], lastMessageAt: null },
  },
};

let persistTimer = null;

function envList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function truthy(value) {
  return String(value || "").trim().toLowerCase() === "1" ||
    String(value || "").trim().toLowerCase() === "true" ||
    String(value || "").trim().toLowerCase() === "yes" ||
    String(value || "").trim().toLowerCase() === "on";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampReconnect(attempt) {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * Math.max(1, 2 ** Math.min(attempt, 5)));
}

function normalizeToken(token) {
  const clean = String(token || "").trim();
  if (!clean) return "";
  return clean.startsWith("oauth:") ? clean : `oauth:${clean}`;
}

function hashId(parts) {
  return crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 20);
}

function recomputeCounts() {
  state.counts = { twitch: 0, x: 0, kick: 0, system: 0 };
  for (const message of state.history) {
    state.counts[message.source] = (state.counts[message.source] || 0) + 1;
  }
}

function restoreSeenKeys() {
  state.seen.clear();
  for (const message of state.history) {
    if (message.id && message.source) state.seen.set(`${message.source}:${message.id}`, Date.now());
  }
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const payload = {
        version: 2,
        savedAt: new Date().toISOString(),
        segments: appConfig.segments,
        history: state.history.slice(-HISTORY_LIMIT),
        producerQueue: state.producerQueue.slice(0, 80),
        showState: state.showState,
      };
      const tmp = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, STATE_FILE);
    } catch (error) {
      console.warn(`Failed to persist operator state: ${error.message}`);
    }
  }, PERSIST_DEBOUNCE_MS);
}

function loadRuntimeState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const payload = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (Array.isArray(payload.segments)) {
      appConfig.segments = sanitizeSegments(payload.segments);
    }
    state.history = Array.isArray(payload.history)
      ? payload.history.slice(-HISTORY_LIMIT).map((message) => {
        const segment = normalizeSegmentName(message.segment || segmentForText(message.text, message.matchedTerms || []));
        return {
          ...message,
          segment,
          operator: message.operator ? { ...message.operator, segment } : message.operator,
        };
      })
      : [];
    state.producerQueue = Array.isArray(payload.producerQueue)
      ? payload.producerQueue.slice(0, 80).map((item) => ({
        ...item,
        topicSegment: normalizeSegmentName(item.topicSegment || segmentForText(item.text, item.matchedTerms || [])),
        segment: normalizeSegmentName(item.segment || item.topicSegment || segmentForText(item.text, item.matchedTerms || [])),
      }))
      : [];
    if (payload.showState && typeof payload.showState === "object") {
      state.showState = {
        currentSegment: normalizeSegmentName(payload.showState.currentSegment || state.showState.currentSegment),
        updatedAt: payload.showState.updatedAt || state.showState.updatedAt,
      };
    }
    recomputeCounts();
    restoreSeenKeys();
  } catch (error) {
    console.warn(`Failed to load operator state: ${error.message}`);
  }
}

function compactSeen() {
  if (state.seen.size < HISTORY_LIMIT * 4) return;
  const keys = Array.from(state.seen.keys()).slice(0, state.seen.size - HISTORY_LIMIT * 2);
  keys.forEach((key) => state.seen.delete(key));
}

function normalizeTextForDedupe(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\w\s$.-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldSuppressRepeatText(text, now = Date.now()) {
  if (!TEXT_REPEAT_SUPPRESS_MS) return false;
  const key = normalizeTextForDedupe(text);
  if (key.length < 24) return false;
  const previous = state.recentText.get(key);
  state.recentText.set(key, now);
  if (state.recentText.size > HISTORY_LIMIT * 3) {
    for (const [storedKey, seenAt] of state.recentText) {
      if (now - seenAt > TEXT_REPEAT_SUPPRESS_MS) state.recentText.delete(storedKey);
    }
  }
  return previous && now - previous < TEXT_REPEAT_SUPPRESS_MS;
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event, payload) {
  for (const client of state.clients) {
    sendSse(client, event, payload);
  }
}

function publishStatus(source, status, detail, extra = {}) {
  state.sources[source] = {
    ...(state.sources[source] || {}),
    ...extra,
    status,
    detail,
    updatedAt: new Date().toISOString(),
  };
  broadcast("status", publicState());
}

function classifyMessage(text) {
  const value = String(text || "").toLowerCase();
  if (/[?？]/.test(value) || /\b(ask|question|why|how|what|wen|when|can you|thoughts)\b/.test(value)) return "question";
  if (/\b(poly|polymarket|bullpen|odds|market|spread|line|mispriced|arb|probability|price|short|long|ticker|hype|eth|btc|bitcoin|sol|hyperliquid|zec|zcash|funding|open interest|liquidation|liquidations|60k|near)\b/.test(value)) return "market";
  if (/\b(clip|clipping|viral|quote|timestamp|cook|cooking|fire|insane)\b/.test(value)) return "clip";
  if (/\b(gta|mizkif|banks|ansem|culture|stream|ct|twitter|x)\b/.test(value)) return "culture";
  return "chat";
}

function matchedWatchTerms(text) {
  const value = String(text || "").toLowerCase();
  return appConfig.watchlist
    .filter((term) => term && value.includes(String(term).toLowerCase()))
    .slice(0, 6);
}

function concreteSignals(text) {
  const value = String(text || "").toLowerCase();
  const signals = [];
  if (/(?:^|\s)(?:\$?\d+(?:\.\d+)?%?|\d+k|\d+m|\d+b)(?:\s|$|[.,:;?!])/.test(value)) signals.push("number");
  if (/\b(entry|exit|invalidat(?:e|es|ion)|time horizon|setup|line|spread|odds|probability|funding|open interest|oi|liquidation|support|resistance|valuation|price)\b/.test(value)) signals.push("market detail");
  if (/\b(ask|queue|clip|save|turn this|follow[- ]?up|what would|what invalidates|why is|how does|who captures|where is|should)\b/.test(value)) signals.push("operator-ready");
  if (/\b(banks|ansem|flood|erik|voorhees|majlak|guest|host|producer)\b/.test(value)) signals.push("host context");
  return signals;
}

function isLowInfoMessage(text) {
  const value = String(text || "").trim().toLowerCase();
  if (value.length < 28) return true;
  const filler = /\b(cooking|cook|fire|lfg|moon|send it|based|lol|lmao|wagmi|insane|crazy|different|goat|vibes|eyes)\b/g;
  const matches = value.match(filler) || [];
  return matches.length >= 2 && !/[?？]/.test(value) && !/\d/.test(value);
}

function operatorAssessment({ text, intent, matchedTerms, segment, score, priority }) {
  const concrete = concreteSignals(text);
  const reasons = [];
  if (intent === "question") reasons.push("clear ask");
  if (intent === "clip") reasons.push("clip candidate");
  if (intent === "market") reasons.push("market signal");
  if (concrete.includes("operator-ready")) reasons.push("operator-ready wording");
  if (concrete.includes("market detail")) reasons.push("specific market detail");
  if (concrete.includes("host context")) reasons.push("host context");
  if (matchedTerms.length) reasons.push(`watchlist: ${matchedTerms.slice(0, 2).join(", ")}`);

  const actionability = Math.max(0, Math.min(10,
    score +
    (intent === "question" ? 1 : 0) +
    (concrete.includes("operator-ready") ? 2 : 0) +
    (concrete.includes("market detail") ? 1 : 0) -
    (isLowInfoMessage(text) ? 3 : 0)
  ));
  const lowInfo = isLowInfoMessage(text) && concrete.length === 0;
  const decision = lowInfo
    ? "ignore"
    : actionability >= 8
      ? "queue"
      : actionability >= 4
        ? "watch"
        : "ignore";
  const kind = intent === "question"
    ? "question"
    : intent === "clip" || intent === "culture"
      ? "clip"
      : "signal";
  const label = decision === "queue"
    ? "Queue"
    : decision === "watch"
      ? "Watch"
      : "Noise";
  const reason = decision === "ignore" && lowInfo
    ? "low information"
    : reasons.slice(0, 2).join(" + ") || `${priority} priority`;
  return {
    decision,
    label,
    kind,
    actionability,
    reason,
    reasons: reasons.slice(0, 4),
    segment,
  };
}

function scoreMessage({ source, text, intent }) {
  const matchedTerms = matchedWatchTerms(text);
  const segment = segmentForText(text, matchedTerms);
  let score = 0;
  if (intent === "question") score += 3;
  if (intent === "market") score += 2;
  if (intent === "clip") score += 2;
  if (intent === "culture") score += 0;
  if (source === "x" && /\b(thread|clip|chart|odds|line|market|source)\b/i.test(text || "")) score += 1;
  score += Math.min(matchedTerms.length, 4);
  const concrete = concreteSignals(text);
  if (concrete.includes("operator-ready")) score += 2;
  if (concrete.includes("market detail")) score += 2;
  if (concrete.includes("host context")) score += 1;
  if (/\b(banks|ansem|polymarket|bullpen|bitcoin|btc|60k|zcash|zec|near|liquidation|liquidations)\b/i.test(text || "")) score += 1;
  if (isLowInfoMessage(text)) score -= 3;
  score = Math.max(0, score);
  const priority = score >= 8 ? "high" : score >= 4 ? "medium" : "normal";
  const operator = operatorAssessment({ text, intent, matchedTerms, segment, score, priority });
  return { score, priority, matchedTerms, segment, operator };
}

function pushMessage(input) {
  const receivedAt = new Date().toISOString();
  const now = Date.now();
  const source = input.source || "system";
  const id = input.id || hashId([source, input.channel, input.user, input.text, input.createdAt || receivedAt]);
  const dedupeKey = `${source}:${id}`;
  if (state.seen.has(dedupeKey)) return null;
  if (!input.meta?.allowRepeat && shouldSuppressRepeatText(input.text, now)) return null;
  state.seen.set(dedupeKey, Date.now());
  compactSeen();

  const intent = input.intent || classifyMessage(input.text);
  const signal = scoreMessage({ source, text: input.text, intent });
  const segment = normalizeSegmentName(input.segment, signal.segment);
  const message = {
    id,
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    channel: input.channel || "",
    user: input.user || "unknown",
    displayName: input.displayName || input.user || "unknown",
    text: input.text || "",
    color: input.color || "",
    badges: Array.isArray(input.badges) ? input.badges : [],
    createdAt: input.createdAt || receivedAt,
    receivedAt,
    link: input.link || "",
    intent,
    signalScore: signal.score,
    priority: signal.priority,
    matchedTerms: signal.matchedTerms,
    segment,
    operator: { ...signal.operator, segment },
    meta: input.meta || {},
  };

  state.history.push(message);
  if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT);
  state.counts[source] = (state.counts[source] || 0) + 1;
  if (state.sources[source]) state.sources[source].lastMessageAt = receivedAt;
  broadcast("message", message);
  broadcast("metrics", metrics());
  schedulePersist();
  return message;
}

function queueProducerItem(message, kind, segmentOverride) {
  const safeKind = ["question", "signal", "clip"].includes(kind) ? kind : "signal";
  const inferredSegment = segmentForText(message.text, message.matchedTerms || []);
  const topicSegment = normalizeSegmentName(message.topicSegment || message.segment, inferredSegment);
  const segment = normalizeSegmentName(segmentOverride || state.showState.currentSegment || topicSegment, topicSegment);
  const queueId = hashId(["queue", safeKind, message.id]);
  const existingIndex = state.producerQueue.findIndex((item) => item.id === queueId);
  const queueItem = {
    id: queueId,
    kind: safeKind,
    messageId: message.id,
    source: message.source,
    sourceLabel: message.sourceLabel,
    channel: message.channel,
    displayName: message.displayName,
    text: message.text,
    createdAt: message.createdAt,
    intent: message.intent,
    priority: message.priority,
    matchedTerms: message.matchedTerms || [],
    signalScore: message.signalScore || 0,
    operator: message.operator || null,
    segment,
    topicSegment,
    queuedAt: new Date().toISOString(),
    done: false,
  };
  if (existingIndex >= 0) state.producerQueue.splice(existingIndex, 1);
  state.producerQueue.unshift(queueItem);
  if (state.producerQueue.length > 80) state.producerQueue.splice(80);
  return queueItem;
}

function metrics() {
  const openQueue = state.producerQueue.filter((item) => !item.done).length;
  return {
    counts: state.counts,
    total: state.history.length,
    queued: state.producerQueue.length,
    openQueued: openQueue,
    doneQueued: state.producerQueue.length - openQueue,
    clients: state.clients.size,
    bootedAt: state.bootedAt,
    lastMessageAt: state.history.length ? state.history[state.history.length - 1].receivedAt : null,
  };
}

function publicState() {
  return {
    config: appConfig,
    showState: state.showState,
    sources: state.sources,
    producerQueue: state.producerQueue,
    metrics: metrics(),
  };
}

const latestShowRehearsalMessages = [
  {
    source: "x",
    channel: "MarketBubble episode",
    user: "MarketBubble",
    displayName: "Market Bubble",
    text: "Latest public episode flow: Bitcoin caution first, Hyperliquid conviction second, then keep one clean clip from the close.",
    segment: "The Price Is Wrong",
    queueKind: "signal",
    switchSegment: "The Price Is Wrong",
  },
  {
    source: "kick",
    channel: "market-bubble",
    user: "riskdesk",
    text: "Ask Ansem what would make him stop being cautious on Bitcoin in the short term.",
    segment: "The Price Is Wrong",
    queueKind: "question",
  },
  {
    source: "twitch",
    channel: "live-show",
    user: "chartwatcher",
    text: "Turn the Hyperliquid bullishness into a host prompt: product strength, valuation, or trader reflexivity?",
    segment: "The Price Is Wrong",
  },
  {
    source: "x",
    channel: "HYPE tape",
    user: "perpdesk",
    text: "HYPE mention needs the operator tag: thesis, time horizon, invalidation, and whether it is clip-worthy.",
    segment: "The Price Is Wrong",
    queueKind: "signal",
  },
  {
    source: "kick",
    channel: "market-bubble",
    user: "clipstack",
    text: "Clip candidate: cautious on Bitcoin, bullish on products people actually use.",
    segment: "The Price Is Wrong",
    queueKind: "clip",
  },
  {
    source: "x",
    channel: "Venice AI",
    user: "private_compute",
    text: "Venice AI topic fits Future-Proof: private AI, compute scarcity, and what users actually pay for.",
    segment: "Future-Proof",
    queueKind: "question",
    switchSegment: "Future-Proof",
  },
  {
    source: "twitch",
    channel: "live-show",
    user: "agenticflow",
    text: "Ask Erik Voorhees where private AI is already a product and where it is still just a belief.",
    segment: "Future-Proof",
    queueKind: "signal",
  },
  {
    source: "kick",
    channel: "market-bubble",
    user: "infraonly",
    text: "Future-Proof queue should split AI wrappers from real AI infrastructure before the hosts move on.",
    segment: "Future-Proof",
  },
  {
    source: "x",
    channel: "Guest room",
    user: "studioenergy",
    text: "Mike Majlak brought culture energy; queue only the parts that become a clip or a real host handoff.",
    segment: "Culture Shock",
    queueKind: "signal",
    switchSegment: "Culture Shock",
  },
  {
    source: "twitch",
    channel: "live-show",
    user: "clipper",
    text: "Culture Shock should not swallow the show; save the funniest guest moment and get back to the market thesis.",
    segment: "Culture Shock",
    queueKind: "question",
  },
  {
    source: "kick",
    channel: "market-bubble",
    user: "producerchat",
    text: "Good operator move: if Banks riffs for 30 seconds, mark the line as clip; if he asks for numbers, mark signal.",
    segment: "Culture Shock",
  },
  {
    source: "x",
    channel: "Compounding",
    user: "powerlaw",
    text: "Flood's power-law point needs a follow-up: what does the desk actually buy and hold through noise?",
    segment: "Future-Proof",
    queueKind: "signal",
    switchSegment: "Future-Proof",
  },
  {
    source: "kick",
    channel: "market-bubble",
    user: "compounding",
    text: "Ask Flood for one compounding mistake people make when they are constantly chasing the next ticker.",
    segment: "Future-Proof",
    queueKind: "question",
  },
  {
    source: "twitch",
    channel: "live-show",
    user: "deskproducer",
    text: "Best rundown order from the latest public episode: Bitcoin caution, Hyperliquid, Venice AI, guest clip, compounding close.",
    segment: "Future-Proof",
    queueKind: "clip",
  },
];

let latestRehearsalRun = 0;

function updateCurrentSegment(currentSegment) {
  const normalized = normalizeSegmentName(currentSegment, state.showState.currentSegment);
  state.showState = {
    currentSegment: normalized,
    updatedAt: new Date().toISOString(),
  };
  broadcast("show-state", publicState());
  schedulePersist();
}

async function runLatestShowRehearsal() {
  const runId = ++latestRehearsalRun;
  const queued = [];
  for (const [index, item] of latestShowRehearsalMessages.entries()) {
    if (index > 0) await wait(Number(process.env.REHEARSAL_INTERVAL_MS || 650));
    if (runId !== latestRehearsalRun) return { count: index, queued };
    if (item.switchSegment) updateCurrentSegment(item.switchSegment);
    const message = pushMessage({
      ...item,
      id: hashId(["latest-show-rehearsal", runId, index, item.source, Date.now()]),
      displayName: item.displayName || item.user,
      createdAt: new Date().toISOString(),
      meta: {
        allowRepeat: true,
        rehearsal: "latest-show",
        airDate: appConfig.latestEpisode.airDate,
      },
    });
    if (message && item.queueKind) {
      const queueItem = queueProducerItem(message, item.queueKind, item.segment);
      queued.push(queueItem.id);
      broadcast("queue", { producerQueue: state.producerQueue, metrics: metrics() });
      schedulePersist();
    }
  }
  return { count: latestShowRehearsalMessages.length, queued };
}

function jsonResponse(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": body.length,
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function serveStatic(req, res, pathname) {
  const target = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(STATIC_DIR, target));
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, body) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Length": body.length,
    });
    res.end(body);
  });
}

function handleEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  state.clients.add(res);
  sendSse(res, "snapshot", { history: state.history, ...publicState() });
  const heartbeat = setInterval(() => sendSse(res, "heartbeat", { now: new Date().toISOString() }), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    state.clients.delete(res);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/state") {
    jsonResponse(res, 200, { ok: true, history: state.history, ...publicState() });
    return;
  }
  if (req.method === "POST" && pathname === "/api/rehearsal/latest-show") {
    runLatestShowRehearsal().catch((error) => {
      console.error("Latest show rehearsal failed:", error);
    });
    jsonResponse(res, 202, {
      ok: true,
      episode: appConfig.latestEpisode,
      count: latestShowRehearsalMessages.length,
    });
    return;
  }
  if (req.method === "POST" && pathname === "/api/clear") {
    state.history = [];
    state.seen.clear();
    state.recentText.clear();
    recomputeCounts();
    broadcast("snapshot", { history: state.history, ...publicState() });
    jsonResponse(res, 200, { ok: true });
    schedulePersist();
    return;
  }
  if (req.method === "POST" && pathname === "/api/queue/add") {
    const body = await readRequestBody(req);
    const snapshot = body.message && typeof body.message === "object" ? body.message : null;
    const message = state.history.find((item) => item.id === body.messageId) || (snapshot?.text ? {
      id: snapshot.id || body.messageId || hashId(["snapshot", snapshot.source, snapshot.channel, snapshot.user, snapshot.text]),
      source: snapshot.source || "system",
      sourceLabel: snapshot.sourceLabel || SOURCE_LABELS[snapshot.source] || snapshot.source || "System",
      channel: snapshot.channel || "",
      displayName: snapshot.displayName || snapshot.user || "unknown",
      text: snapshot.text,
      createdAt: snapshot.createdAt || snapshot.receivedAt || new Date().toISOString(),
      intent: snapshot.intent || classifyMessage(snapshot.text),
      priority: snapshot.priority || "normal",
      matchedTerms: Array.isArray(snapshot.matchedTerms) ? snapshot.matchedTerms.slice(0, 6) : [],
      signalScore: Number(snapshot.signalScore || 0),
      operator: snapshot.operator || null,
      segment: snapshot.segment || segmentForText(snapshot.text, snapshot.matchedTerms || []),
      topicSegment: snapshot.topicSegment || snapshot.segment || segmentForText(snapshot.text, snapshot.matchedTerms || []),
    } : null);
    if (!message) {
      jsonResponse(res, 404, { ok: false, error: "Message not found." });
      return;
    }
    const queueItem = queueProducerItem(message, body.kind, body.segment);
    broadcast("queue", { producerQueue: state.producerQueue, metrics: metrics() });
    jsonResponse(res, 200, { ok: true, item: queueItem });
    schedulePersist();
    return;
  }
  if (req.method === "POST" && pathname === "/api/show-state/update") {
    const body = await readRequestBody(req);
    const currentSegment = normalizeSegmentName(body.currentSegment || body.segment, "");
    if (!currentSegment) {
      jsonResponse(res, 400, { ok: false, error: "Unknown segment." });
      return;
    }
    state.showState = {
      currentSegment,
      updatedAt: new Date().toISOString(),
    };
    broadcast("show-state", publicState());
    jsonResponse(res, 200, { ok: true, showState: state.showState });
    schedulePersist();
    return;
  }
  if (req.method === "POST" && pathname === "/api/segments/update") {
    const body = await readRequestBody(req);
    const nextSegments = sanitizeSegments(body.segments);
    applySegments(nextSegments);
    broadcast("show-state", publicState());
    jsonResponse(res, 200, { ok: true, config: appConfig, showState: state.showState, producerQueue: state.producerQueue });
    schedulePersist();
    return;
  }
  if (req.method === "POST" && pathname === "/api/segments/reset") {
    applySegments(DEFAULT_SEGMENTS);
    broadcast("show-state", publicState());
    jsonResponse(res, 200, { ok: true, config: appConfig, showState: state.showState, producerQueue: state.producerQueue });
    schedulePersist();
    return;
  }
  if (req.method === "POST" && pathname === "/api/queue/update") {
    const body = await readRequestBody(req);
    const item = state.producerQueue.find((queueItem) => queueItem.id === body.queueId);
    if (!item) {
      jsonResponse(res, 404, { ok: false, error: "Queued item not found." });
      return;
    }
    if (typeof body.done === "boolean") item.done = body.done;
    if (typeof body.segment === "string") {
      item.segment = normalizeSegmentName(body.segment, item.segment || state.showState.currentSegment);
    }
    if (typeof body.topicSegment === "string") {
      item.topicSegment = normalizeSegmentName(body.topicSegment, item.topicSegment || item.segment);
    }
    item.updatedAt = new Date().toISOString();
    broadcast("queue", { producerQueue: state.producerQueue, metrics: metrics() });
    jsonResponse(res, 200, { ok: true, item });
    schedulePersist();
    return;
  }
  if (req.method === "POST" && pathname === "/api/queue/remove") {
    const body = await readRequestBody(req);
    state.producerQueue = state.producerQueue.filter((item) => item.id !== body.queueId);
    broadcast("queue", { producerQueue: state.producerQueue, metrics: metrics() });
    jsonResponse(res, 200, { ok: true });
    schedulePersist();
    return;
  }
  if (req.method === "POST" && pathname === "/api/queue/clear-done") {
    state.producerQueue = state.producerQueue.filter((item) => !item.done);
    broadcast("queue", { producerQueue: state.producerQueue, metrics: metrics() });
    jsonResponse(res, 200, { ok: true });
    schedulePersist();
    return;
  }
  if (req.method === "POST" && pathname === "/api/queue/clear") {
    state.producerQueue = [];
    broadcast("queue", { producerQueue: state.producerQueue, metrics: metrics() });
    jsonResponse(res, 200, { ok: true });
    schedulePersist();
    return;
  }
  if (req.method === "POST" && pathname === "/api/demo-message") {
    const body = await readRequestBody(req);
    pushMessage({
      source: ["twitch", "kick", "x"].includes(body.source) ? body.source : "system",
      channel: String(body.channel || "demo"),
      user: String(body.user || "operator"),
      displayName: String(body.displayName || body.user || "operator"),
      text: String(body.text || "Test message"),
    });
    jsonResponse(res, 200, { ok: true });
    return;
  }
  jsonResponse(res, 404, { ok: false, error: "Unknown API route." });
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (parsed.pathname === "/healthz") {
    jsonResponse(res, 200, {
      ok: true,
      service: appConfig.workspaceName,
      bootedAt: state.bootedAt,
      history: state.history.length,
      sources: Object.fromEntries(Object.entries(state.sources).map(([source, item]) => [source, item.status])),
    });
    return;
  }
  if (parsed.pathname === "/events") {
    handleEvents(req, res);
    return;
  }
  if (parsed.pathname.startsWith("/api/")) {
    handleApi(req, res, parsed.pathname).catch((error) => {
      jsonResponse(res, 500, { ok: false, error: error.message });
    });
    return;
  }
  serveStatic(req, res, parsed.pathname);
});

function decodeIrcTag(value) {
  return String(value || "")
    .replaceAll("\\s", " ")
    .replaceAll("\\:", ";")
    .replaceAll("\\r", "\r")
    .replaceAll("\\n", "\n")
    .replaceAll("\\\\", "\\");
}

function parseIrcTags(segment) {
  const tags = {};
  for (const pair of segment.split(";")) {
    const [key, ...rest] = pair.split("=");
    tags[key] = decodeIrcTag(rest.join("="));
  }
  return tags;
}

function parseTwitchLine(line) {
  let rest = line;
  let tags = {};
  if (rest.startsWith("@")) {
    const firstSpace = rest.indexOf(" ");
    tags = parseIrcTags(rest.slice(1, firstSpace));
    rest = rest.slice(firstSpace + 1);
  }
  const match = rest.match(/^:([^!]+)![^ ]+ PRIVMSG #([^ ]+) :([\s\S]*)$/);
  if (!match) return null;
  return {
    id: tags.id,
    user: match[1],
    displayName: tags["display-name"] || match[1],
    channel: match[2],
    text: match[3],
    color: tags.color || "",
    badges: (tags.badges || "").split(",").filter(Boolean),
    createdAt: tags["tmi-sent-ts"] ? new Date(Number(tags["tmi-sent-ts"])).toISOString() : undefined,
  };
}

function startTwitch() {
  const channels = envList("TWITCH_CHANNELS").map((channel) => channel.replace(/^#/, "").toLowerCase());
  const token = normalizeToken(process.env.TWITCH_TOKEN || process.env.TWITCH_OAUTH_TOKEN || "");
  const configuredName = String(process.env.TWITCH_USERNAME || "").trim().toLowerCase();
  if (!channels.length) return;

  const username = configuredName || `justinfan${Math.floor(Math.random() * 900000 + 100000)}`;
  state.sources.twitch.enabled = true;
  state.sources.twitch.channels = channels;

  let attempt = 0;
  const connect = () => {
    publishStatus("twitch", "connecting", `Joining ${channels.map((c) => `#${c}`).join(", ")}.`, { channels });
    const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    let closedCleanly = false;

    ws.on("open", () => {
      attempt = 0;
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send(`PASS ${token || "SCHMOOPIIE"}`);
      ws.send(`NICK ${username}`);
      ws.send(`JOIN ${channels.map((channel) => `#${channel}`).join(",")}`);
      publishStatus("twitch", "connected", `Connected as ${username}.`, { channels });
    });

    ws.on("message", (raw) => {
      const lines = String(raw).split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (line.startsWith("PING")) {
          ws.send(line.replace("PING", "PONG"));
          continue;
        }
        if (line.includes("RECONNECT")) {
          closedCleanly = true;
          ws.close();
          return;
        }
        if (line.includes("Login authentication failed")) {
          publishStatus("twitch", "error", "Authentication failed. Check TWITCH_USERNAME and TWITCH_TOKEN.");
        }
        const msg = parseTwitchLine(line);
        if (!msg) continue;
        pushMessage({ source: "twitch", ...msg });
      }
    });

    ws.on("error", (error) => {
      publishStatus("twitch", "error", error.message, { channels });
    });

    ws.on("close", () => {
      const delay = clampReconnect(attempt++);
      publishStatus("twitch", "reconnecting", `Disconnected. Reconnecting in ${Math.round(delay / 1000)}s.`, { channels });
      setTimeout(connect, closedCleanly ? 500 : delay);
    });
  };

  connect();
}

async function resolveKickChatroom(slug) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "unified-chat-aggregator/0.1",
  };
  const urls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/chatroom`,
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
  ];
  let lastError = "";
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`;
        continue;
      }
      const data = await response.json();
      const id = data.id || data.chatroom_id || data.chatroom?.id || data.livestream?.chatroom_id;
      if (id) return { id: String(id), data };
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(lastError || `Unable to resolve Kick chatroom for ${slug}.`);
}

function parseJsonMaybe(value) {
  if (typeof value !== "string") return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeKickPayload(event, rawPayload, slug) {
  const payload = parseJsonMaybe(rawPayload);
  const lowerEvent = String(event || "").toLowerCase();
  const candidate = payload.message && typeof payload.message === "object" ? payload.message : payload;
  const sender = candidate.sender || payload.sender || candidate.user || payload.user || {};
  const text =
    candidate.content ||
    candidate.text ||
    candidate.message ||
    candidate.body ||
    payload.content ||
    payload.text ||
    payload.message?.text ||
    "";

  const looksLikeChat =
    lowerEvent.includes("chatmessage") ||
    lowerEvent.includes("message.sent") ||
    lowerEvent.includes("chat.message") ||
    Boolean(text && (sender.username || sender.slug || sender.login || sender.name));

  if (!looksLikeChat || !text) return null;

  const identity = sender.identity || {};
  const badges = Array.isArray(identity.badges)
    ? identity.badges.map((badge) => badge.text || badge.name || badge.type).filter(Boolean)
    : [];
  const username = sender.username || sender.slug || sender.login || sender.name || "kick-user";
  const createdAt = candidate.created_at || payload.created_at || undefined;
  return {
    id: String(candidate.id || payload.id || hashId(["kick", slug, username, text, createdAt])),
    source: "kick",
    channel: slug,
    user: username,
    displayName: sender.name || sender.username || username,
    text: String(text),
    color: identity.color || sender.color || "",
    badges,
    createdAt: createdAt ? new Date(createdAt).toISOString() : undefined,
    meta: { event },
  };
}

function startKick() {
  const channels = envList("KICK_CHANNELS");
  if (!channels.length) return;

  state.sources.kick.enabled = true;
  state.sources.kick.channels = channels;
  const key = String(process.env.KICK_PUSHER_KEY || "32cbd69e4b950bf97679").trim();
  const cluster = String(process.env.KICK_PUSHER_CLUSTER || "us2").trim();

  for (const slug of channels) {
    let attempt = 0;
    const connect = async () => {
      try {
        publishStatus("kick", "connecting", `Resolving Kick chatroom for ${slug}.`, { channels });
        const room = await resolveKickChatroom(slug);
        const url = `wss://ws-${cluster}.pusher.com/app/${key}?protocol=7&client=js&version=8.4.0&flash=false`;
        const ws = new WebSocket(url);
        const subscriptions = [`chatrooms.${room.id}.v2`, `chatrooms.${room.id}`];

        ws.on("open", () => {
          attempt = 0;
          for (const channel of subscriptions) {
            ws.send(JSON.stringify({ event: "pusher:subscribe", data: { auth: "", channel } }));
          }
          publishStatus("kick", "connected", `Connected to ${slug} chatroom ${room.id}.`, { channels });
        });

        ws.on("message", (raw) => {
          const frame = parseJsonMaybe(String(raw));
          if (frame.event === "pusher:ping") {
            ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
            return;
          }
          const msg = normalizeKickPayload(frame.event, frame.data, slug);
          if (msg) pushMessage(msg);
        });

        ws.on("error", (error) => {
          publishStatus("kick", "error", `${slug}: ${error.message}`, { channels });
        });

        ws.on("close", () => {
          const delay = clampReconnect(attempt++);
          publishStatus("kick", "reconnecting", `${slug} disconnected. Reconnecting in ${Math.round(delay / 1000)}s.`, { channels });
          setTimeout(connect, delay);
        });
      } catch (error) {
        const delay = clampReconnect(attempt++);
        publishStatus("kick", "error", `${slug}: ${error.message}. Retrying in ${Math.round(delay / 1000)}s.`, { channels });
        setTimeout(connect, delay);
      }
    };
    connect();
  }
}

function parseXRules() {
  return envList("X_RULES").map((rule, index) => {
    const match = rule.match(/^([^=]{1,64})=(.+)$/);
    if (match) return { tag: `chat-agg:${match[1].trim()}`, value: match[2].trim() };
    return { tag: `chat-agg:rule-${index + 1}`, value: rule };
  }).filter((rule) => rule.value);
}

async function xApi(pathname, options = {}) {
  const bearer = String(process.env.X_BEARER_TOKEN || "").trim();
  const response = await fetch(`https://api.x.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`X API ${response.status}: ${body || response.statusText}`);
  }
  return response;
}

async function syncXRules(rules) {
  if (!rules.length) return;
  const current = await xApi("/2/tweets/search/stream/rules").then((response) => response.json());
  const existingValues = new Set((current.data || []).map((rule) => rule.value));
  const add = rules.filter((rule) => !existingValues.has(rule.value));
  if (!add.length) return;
  await xApi("/2/tweets/search/stream/rules", {
    method: "POST",
    body: JSON.stringify({ add }),
  });
}

function normalizeXPost(payload) {
  const post = payload.data;
  if (!post || !post.text) return null;
  const users = new Map((payload.includes?.users || []).map((user) => [user.id, user]));
  const author = users.get(post.author_id) || {};
  const matching = payload.matching_rules || [];
  const tag = matching.map((rule) => rule.tag).filter(Boolean).join(", ");
  return {
    id: post.id,
    source: "x",
    channel: tag || "filtered stream",
    user: author.username || post.author_id || "x-user",
    displayName: author.name || author.username || post.author_id || "X user",
    text: post.text,
    createdAt: post.created_at || undefined,
    link: author.username && post.id ? `https://x.com/${author.username}/status/${post.id}` : "",
    meta: { matching_rules: matching },
  };
}

function startX() {
  const bearer = String(process.env.X_BEARER_TOKEN || "").trim();
  if (!bearer) return;

  const rules = parseXRules();
  state.sources.x.enabled = true;
  state.sources.x.rules = rules.map((rule) => rule.value);
  let attempt = 0;

  const connect = async () => {
    try {
      publishStatus("x", "connecting", rules.length ? "Syncing filtered stream rules." : "Connecting to existing filtered stream rules.", {
        rules: rules.map((rule) => rule.value),
      });
      await syncXRules(rules);
      const params = new URLSearchParams({
        "tweet.fields": "created_at,author_id",
        expansions: "author_id",
        "user.fields": "username,name,profile_image_url",
      });
      const response = await xApi(`/2/tweets/search/stream?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      publishStatus("x", "connected", "Connected to X filtered stream.", { rules: rules.map((rule) => rule.value) });
      attempt = 0;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const payload = JSON.parse(trimmed);
          const msg = normalizeXPost(payload);
          if (msg) pushMessage(msg);
        }
      }
      throw new Error("X stream ended.");
    } catch (error) {
      const delay = clampReconnect(attempt++);
      publishStatus("x", "reconnecting", `${error.message}. Reconnecting in ${Math.round(delay / 1000)}s.`, {
        rules: rules.map((rule) => rule.value),
      });
      setTimeout(connect, delay);
    }
  };

  connect();
}

function startDemo() {
  const samples = [
    { source: "x", channel: "The Dollar Is Going to Zero", user: "ct_riskdesk", text: "BTC caution is the headline, but HYPE and HyperLiquid strength is the actual split-screen market signal.", segment: "The Price Is Wrong" },
    { source: "kick", channel: "market-bubble", user: "macro_guest", text: "Ask Ansem if Bitcoin is weak because liquidity is leaving crypto or because AI is taking the whole risk budget.", segment: "The Price Is Wrong" },
    { source: "twitch", channel: "live-show", user: "clipwatch", text: "Clip the moment where Banks asks whether the dollar-zero thesis is real or just crypto cope.", segment: "The Price Is Wrong" },
    { source: "x", channel: "Venice AI", user: "agenticflow", text: "Venice AI topic fits Future-Proof: private AI, compute scarcity, and what users actually pay for.", segment: "Future-Proof" },
    { source: "kick", channel: "market-bubble", user: "compounding", text: "Flood's power-law point needs a follow-up: what does the desk actually buy and hold through noise?", segment: "The Price Is Wrong" },
    { source: "x", channel: "ETH debate", user: "ethbear", text: "Why Ansem thinks Ethereum is done is a clean Price Is Wrong segment if someone brings actual odds or flows.", segment: "The Price Is Wrong" },
    { source: "twitch", channel: "live-show", user: "validatorwatch", text: "Ask whether ETH weakness is structural, narrative rotation, or just a crowded short-term trade.", segment: "The Price Is Wrong" },
    { source: "kick", channel: "market-bubble", user: "akash_builder", text: "Akash compute belongs in Future-Proof: if compute is money, who captures margin?", segment: "Future-Proof" },
    { source: "x", channel: "Crypto Twitter", user: "top25watch", text: "TraderMayne ranking CT figures is Culture Shock unless it turns into tradeable attention or Polymarket odds.", segment: "Culture Shock" },
    { source: "kick", channel: "Bullpen baseball", user: "line_reader", text: "Bullpen baseball spread moved before the hosts got there; queue the line, price, and why it moved.", segment: "Pick n' Roll" },
    { source: "twitch", channel: "live-show", user: "sportsbookish", text: "Pick n' Roll should show the entry number and whether Polymarket agrees with the baseball book.", segment: "Pick n' Roll" },
    { source: "x", channel: "GTA 6 markets", user: "culturearb", text: "GTA 6 is not just culture; the attention market around release timing and creator economics is the trade.", segment: "Culture Shock" },
    { source: "kick", channel: "market-bubble", user: "attentiondesk", text: "Ask Banks to explain 'attention is the new EBITDA' in one sentence for the clipping team.", segment: "Culture Shock" },
    { source: "twitch", channel: "live-show", user: "watchcollector", text: "Watches, streaming, and sports investing all fit if the desk frames them as status markets.", segment: "Culture Shock" },
    { source: "x", channel: "HyperLiquid", user: "perpsdesk", text: "HyperLiquid and HYPE keep surviving BTC weakness; ask if that is product-market fit or late-cycle leverage.", segment: "Future-Proof" },
    { source: "kick", channel: "market-bubble", user: "spacex_odds", text: "SpaceX should be a Future-Proof beat only if someone can tie it to a Polymarket or capital-markets angle.", segment: "Future-Proof" },
    { source: "twitch", channel: "live-show", user: "nuclear_bull", text: "Nuclear energy chat is heating up; queue it if AI compute demand is the reason, not just a random tangent.", segment: "Future-Proof" },
    { source: "x", channel: "AI beats crypto", user: "aicapex", text: "Why AI is beating crypto right now: capital formation, visible customers, and fewer circular narratives.", segment: "Future-Proof" },
    { source: "kick", channel: "market-bubble", user: "smallstack", text: "Ask NotSoEasyMoney for one practical setup for viewers with limited time and limited bankroll.", segment: "The Price Is Wrong" },
    { source: "twitch", channel: "live-show", user: "clippingmeta", text: "Mizkif saying clipping meta hurts livestreaming is a Culture Shock clip, not a market signal.", segment: "Culture Shock" },
    { source: "x", channel: "ticker watch", user: "tickertape", text: "Ansem's ticker mentions need a queue tag: thesis, time horizon, invalidation, then clip if he gives a clean line.", segment: "The Price Is Wrong" },
    { source: "kick", channel: "market-bubble", user: "solana_user", text: "Solana question: is the market punishing majors or just rotating to AI-adjacent infrastructure?", segment: "The Price Is Wrong" },
    { source: "twitch", channel: "live-show", user: "deadweb", text: "Dead Internet Theory belongs in Culture Shock unless it turns into a Polymarket on bot traffic.", segment: "Culture Shock" },
    { source: "x", channel: "For You feed", user: "feedtheory", text: "For You content and misinformation are the show workflow test: culture chatter becomes marketable only with a measurable outcome.", segment: "Culture Shock" },
    { source: "kick", channel: "market-bubble", user: "faze_next", text: "Next evolution of FaZe is a culture segment; queue only if Banks gives a specific operating lesson.", segment: "Culture Shock" },
    { source: "twitch", channel: "live-show", user: "producer_note", text: "Operator note: current beat needs one host question, one market signal, and one clip before moving segments.", segment: "The Price Is Wrong" },
    { source: "x", channel: "Polymarket US", user: "marketstructure", text: "Polymarket US callout should become a short host prompt: what changes when prediction markets go mainstream?", segment: "The Price Is Wrong" },
    { source: "kick", channel: "market-bubble", user: "guest_tracker", text: "Guest moment: when the guest gives a number, queue it as a signal; when they give a phrase, queue it as a clip.", segment: "The Price Is Wrong" },
    { source: "twitch", channel: "live-show", user: "questionstack", text: "Ask what would make Ansem change his mind on BTC, ETH, or HYPE in the next two weeks.", segment: "The Price Is Wrong" },
    { source: "x", channel: "rundown desk", user: "showrunner", text: "Best rundown order today: market mispricing first, Future-Proof second, Culture Shock third, Pick n' Roll when a real line moves.", segment: "The Price Is Wrong" },
  ];
  let index = 0;
  publishStatus("twitch", "demo", "Show-aware demo pulse is enabled.", { enabled: true, channels: ["live-show"] });
  publishStatus("kick", "demo", "Show-aware demo pulse is enabled.", { enabled: true, channels: ["market-bubble"] });
  publishStatus("x", "demo", "Show-aware demo pulse is enabled.", { enabled: true, rules: ["Market Bubble", "Polymarket", "Bullpen", "Ansem", "Banks"] });

  setInterval(() => {
    const sample = samples[index % samples.length];
    index += 1;
    pushMessage({
      ...sample,
      id: hashId(["demo", index, sample.source, Date.now()]),
      displayName: sample.user,
      createdAt: new Date().toISOString(),
      meta: {
        ...(sample.meta || {}),
        demoPulse: true,
        episodeAware: true,
      },
    });
  }, Number(process.env.DEMO_INTERVAL_MS || 3200));
}

loadRuntimeState();

server.listen(PORT, HOST, () => {
  const localUrl = HOST === "0.0.0.0" || HOST === "::" ? `http://127.0.0.1:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Unified chat aggregator running at ${localUrl}`);
  console.log("Configure TWITCH_CHANNELS, KICK_CHANNELS, and X_BEARER_TOKEN for live sources.");
  startTwitch();
  startKick();
  startX();

  const hasLiveSource = envList("TWITCH_CHANNELS").length || envList("KICK_CHANNELS").length || String(process.env.X_BEARER_TOKEN || "").trim();
  if (truthy(process.env.DEMO_MODE) || !hasLiveSource) {
    startDemo();
  }
});
