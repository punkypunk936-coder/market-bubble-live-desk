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
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 500);
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const PERSIST_DEBOUNCE_MS = 250;

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

const appConfig = {
  workspaceName: process.env.WORKSPACE_NAME || "Market Bubble Live Desk",
  eyebrow: process.env.WORKSPACE_EYEBROW || "Internal producer console",
  brandMark: process.env.WORKSPACE_MARK || "MB",
  buildLabel: process.env.BUILD_LABEL || "Market Bubble desk:",
  buildCopy: process.env.BUILD_COPY || "Twitch + X + Kick into one source-labeled live feed for the room.",
  context: envList("WORKSPACE_CONTEXT").length
    ? envList("WORKSPACE_CONTEXT")
    : ["Banks + Ansem", "Prediction markets", "Crypto + AI", "Sports + culture", "Thursdays 1PM PST"],
  segments: [
    {
      name: "Future-Proof",
      brief: "AI, compute, frontier tech, and post-AGI money rails.",
    },
    {
      name: "Culture Shock",
      brief: "Internet-native moments, creator drama, viral clips, and attention.",
    },
    {
      name: "Pick n' Roll",
      brief: "Sports storylines, matchups, lines, and momentum.",
    },
    {
      name: "The Price Is Wrong",
      brief: "Mispricings, sentiment gaps, and market probabilities.",
    },
  ],
  watchlist: envList("WORKSPACE_WATCHLIST").length
    ? envList("WORKSPACE_WATCHLIST")
    : ["Polymarket", "Bullpen", "HYPE", "HyperLiquid", "Ethereum", "Solana", "GTA 6", "AI compute"],
};

const state = {
  bootedAt: new Date().toISOString(),
  history: [],
  producerQueue: [],
  clients: new Set(),
  seen: new Map(),
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
        version: 1,
        savedAt: new Date().toISOString(),
        history: state.history.slice(-HISTORY_LIMIT),
        producerQueue: state.producerQueue.slice(0, 80),
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
    state.history = Array.isArray(payload.history) ? payload.history.slice(-HISTORY_LIMIT) : [];
    state.producerQueue = Array.isArray(payload.producerQueue) ? payload.producerQueue.slice(0, 80) : [];
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
  if (/\b(poly|polymarket|bullpen|odds|market|spread|line|mispriced|arb|probability|price|short|long|ticker|hype|eth|btc|sol|hyperliquid)\b/.test(value)) return "market";
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

function scoreMessage({ source, text, intent }) {
  const matchedTerms = matchedWatchTerms(text);
  let score = 0;
  if (intent === "question") score += 3;
  if (intent === "market") score += 3;
  if (intent === "clip") score += 2;
  if (intent === "culture") score += 1;
  if (source === "x") score += 1;
  score += Math.min(matchedTerms.length * 2, 6);
  if (/\b(banks|ansem|polymarket|bullpen)\b/i.test(text || "")) score += 2;
  const priority = score >= 6 ? "high" : score >= 3 ? "medium" : "normal";
  return { score, priority, matchedTerms };
}

function pushMessage(input) {
  const receivedAt = new Date().toISOString();
  const source = input.source || "system";
  const id = input.id || hashId([source, input.channel, input.user, input.text, input.createdAt || receivedAt]);
  const dedupeKey = `${source}:${id}`;
  if (state.seen.has(dedupeKey)) return;
  state.seen.set(dedupeKey, Date.now());
  compactSeen();

  const intent = input.intent || classifyMessage(input.text);
  const signal = scoreMessage({ source, text: input.text, intent });
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
    meta: input.meta || {},
  };

  state.history.push(message);
  if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT);
  state.counts[source] = (state.counts[source] || 0) + 1;
  if (state.sources[source]) state.sources[source].lastMessageAt = receivedAt;
  broadcast("message", message);
  broadcast("metrics", metrics());
  schedulePersist();
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
    sources: state.sources,
    producerQueue: state.producerQueue,
    metrics: metrics(),
  };
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
  if (req.method === "POST" && pathname === "/api/clear") {
    state.history = [];
    state.seen.clear();
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
    } : null);
    if (!message) {
      jsonResponse(res, 404, { ok: false, error: "Message not found." });
      return;
    }
    const kind = ["question", "signal", "clip"].includes(body.kind) ? body.kind : "signal";
    const queueId = hashId(["queue", kind, message.id]);
    const existingIndex = state.producerQueue.findIndex((item) => item.id === queueId);
    const queueItem = {
      id: queueId,
      kind,
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
      queuedAt: new Date().toISOString(),
      done: false,
    };
    if (existingIndex >= 0) state.producerQueue.splice(existingIndex, 1);
    state.producerQueue.unshift(queueItem);
    if (state.producerQueue.length > 80) state.producerQueue.splice(80);
    broadcast("queue", { producerQueue: state.producerQueue, metrics: metrics() });
    jsonResponse(res, 200, { ok: true, item: queueItem });
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
    { source: "kick", channel: "market-bubble", user: "user91", text: "HYPE just different, is this The Price Is Wrong?" },
    { source: "x", channel: "Polymarket OR Bullpen", user: "ct_user1337", text: "Bullpen spreads on baseball are starting to move before the desk mentions it" },
    { source: "twitch", channel: "live-show", user: "user67", text: "Ask Ansem why ETH is lagging if compute is the trade" },
    { source: "kick", channel: "market-bubble", user: "mod_alpha", text: "Culture Shock segment should hit the GTA 6 market next" },
    { source: "twitch", channel: "live-show", user: "chartwatcher", text: "clip that Banks quote, attention is still the new EBITDA" },
    { source: "x", channel: "Market Bubble watchlist", user: "timeline_pro", text: "Polymarket odds moved 6 points during the Future-Proof block" },
  ];
  let index = 0;
  publishStatus("twitch", "demo", "Demo messages are enabled.", { enabled: true, channels: ["stream"] });
  publishStatus("kick", "demo", "Demo messages are enabled.", { enabled: true, channels: ["market-bubble"] });
  publishStatus("x", "demo", "Demo messages are enabled.", { enabled: true, rules: ["HYPE OR polymarket"] });

  setInterval(() => {
    const sample = samples[index % samples.length];
    index += 1;
    pushMessage({
      ...sample,
      id: hashId(["demo", index, sample.source, Date.now()]),
      displayName: sample.user,
      createdAt: new Date().toISOString(),
    });
  }, Number(process.env.DEMO_INTERVAL_MS || 1800));
}

loadRuntimeState();

server.listen(PORT, () => {
  console.log(`Unified chat aggregator running at http://127.0.0.1:${PORT}`);
  console.log("Configure TWITCH_CHANNELS, KICK_CHANNELS, and X_BEARER_TOKEN for live sources.");
  startTwitch();
  startKick();
  startX();

  const hasLiveSource = envList("TWITCH_CHANNELS").length || envList("KICK_CHANNELS").length || String(process.env.X_BEARER_TOKEN || "").trim();
  if (truthy(process.env.DEMO_MODE) || !hasLiveSource) {
    startDemo();
  }
});
