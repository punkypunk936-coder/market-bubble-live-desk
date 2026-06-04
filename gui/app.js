const state = {
  messages: [],
  paused: false,
  queue: [],
  filters: new Set(["kick", "x", "twitch"]),
  query: "",
  metrics: { counts: {}, total: 0, clients: 0 },
  sources: {},
  producerQueue: [],
  config: {},
};

const sourceNames = {
  kick: "Kick",
  x: "X",
  twitch: "Twitch",
  system: "System",
};

function $(id) {
  return document.getElementById(id);
}

function escapeText(value) {
  return String(value || "");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function sourceGlyph(source) {
  if (source === "kick") return "K";
  if (source === "x") return "X";
  if (source === "twitch") return "";
  return "U";
}

function intentLabel(intent) {
  return {
    question: "Question",
    market: "Market",
    clip: "Clip",
    culture: "Culture",
    chat: "Chat",
  }[intent || "chat"] || "Chat";
}

function passesFilters(message) {
  if (!state.filters.has(message.source)) return false;
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return [message.text, message.displayName, message.user, message.channel, message.sourceLabel, message.intent]
    .filter(Boolean)
    .some((part) => String(part).toLowerCase().includes(query));
}

function renderMessage(message, flash = false) {
  const template = $("messageTemplate").content.cloneNode(true);
  const row = template.querySelector(".messageRow");
  const badge = template.querySelector(".sourceBadge");
  const glyph = template.querySelector(".sourceGlyph");
  const sourceName = template.querySelector(".sourceName");
  const user = template.querySelector(".messageUser");
  const channel = template.querySelector(".messageChannel");
  const intent = template.querySelector(".intentPill");
  const text = template.querySelector(".messageText");
  const time = template.querySelector(".messageTime");
  const actions = template.querySelectorAll(".messageAction");

  row.classList.add(message.source);
  row.dataset.messageId = message.id;
  if (flash) row.classList.add("flash");
  badge.classList.add(message.source);
  glyph.textContent = sourceGlyph(message.source);
  if (message.source === "twitch") glyph.classList.add("twitchGlyph");
  sourceName.textContent = message.sourceLabel || sourceNames[message.source] || message.source;
  user.textContent = message.displayName || message.user || "unknown";
  user.title = message.displayName || message.user || "";
  channel.textContent = message.channel ? `#${message.channel}` : "";
  intent.textContent = intentLabel(message.intent);
  intent.classList.add(message.intent || "chat");
  text.textContent = escapeText(message.text);
  time.textContent = formatTime(message.createdAt || message.receivedAt);
  time.dateTime = message.createdAt || message.receivedAt || "";
  actions.forEach((button) => {
    button.dataset.id = message.id;
  });

  return row;
}

function renderFeed() {
  const feed = $("feed");
  const visible = state.messages.filter(passesFilters).slice(-250);
  feed.innerHTML = "";
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = "No messages match the current filters.";
    feed.appendChild(empty);
    return;
  }
  for (const message of visible) feed.appendChild(renderMessage(message));
  feed.scrollTop = feed.scrollHeight;
}

function appendMessage(message) {
  state.messages.push(message);
  if (state.messages.length > 500) state.messages.splice(0, state.messages.length - 500);
  if (state.paused) {
    state.queue.push(message);
    updateConnectionLight();
    return;
  }
  if (!passesFilters(message)) {
    updateMetrics();
    return;
  }
  const feed = $("feed");
  const hadEmpty = feed.querySelector(".emptyState");
  if (hadEmpty) feed.innerHTML = "";
  feed.appendChild(renderMessage(message, true));
  const rows = feed.querySelectorAll(".messageRow");
  if (rows.length > 250) rows[0].remove();
  feed.scrollTop = feed.scrollHeight;
  updateMetrics();
}

function renderSources() {
  const list = $("sourceStatus");
  const sources = state.sources || {};
  list.innerHTML = ["kick", "x", "twitch"]
    .map((source) => {
      const item = sources[source] || {};
      const status = item.status || "idle";
      const detail = item.detail || "Not configured.";
      return `
        <div class="statusItem ${source}">
          <div class="statusTop">
            <span class="statusName">${sourceNames[source]}</span>
            <span class="statusPill">${status}</span>
          </div>
          <div class="statusDetail">${detail}</div>
        </div>
      `;
    })
    .join("");
}

function renderConfig() {
  const config = state.config || {};
  const name = config.workspaceName || "Market Bubble Live Desk";
  document.title = name;
  $("workspaceName").textContent = name;
  $("workspaceEyebrow").textContent = config.eyebrow || "Internal producer console";
  $("brandMark").textContent = config.brandMark || "MB";
  $("buildLabel").textContent = config.buildLabel || "Market Bubble desk:";
  $("buildCopy").textContent = config.buildCopy || "Twitch + X + Kick into one source-labeled live feed for the room.";

  $("contextRail").innerHTML = (config.context || [])
    .map((item) => `<span class="contextChip">${escapeHtml(item)}</span>`)
    .join("");
  $("runOfShow").innerHTML = (config.segments || [])
    .map(
      (segment) => `
        <div class="segmentItem">
          <strong>${escapeHtml(segment.name)}</strong>
          <span>${escapeHtml(segment.brief)}</span>
        </div>
      `
    )
    .join("");
  $("watchlist").innerHTML = (config.watchlist || [])
    .map((item) => `<span class="watchChip">${escapeHtml(item)}</span>`)
    .join("");
}

function queueKindLabel(kind) {
  return {
    question: "On-air question",
    signal: "Market signal",
    clip: "Clip candidate",
  }[kind] || "Queued";
}

function renderProducerQueue() {
  const node = $("producerQueue");
  const items = state.producerQueue || [];
  if (!items.length) {
    node.innerHTML = `<div class="emptyState compact">No queued items.</div>`;
    return;
  }
  node.innerHTML = items
    .slice(0, 18)
    .map(
      (item) => `
        <article class="queueItem ${item.source}">
          <div class="queueTop">
            <span class="queueKind">${escapeHtml(queueKindLabel(item.kind))}</span>
            <button class="queueRemove" type="button" data-queue-id="${item.id}" aria-label="Remove queued item"></button>
          </div>
          <strong>${escapeHtml(item.displayName || "unknown")}</strong>
          <p>${escapeHtml(item.text)}</p>
          <div class="queueMeta">${escapeHtml(item.sourceLabel || item.source)}${item.channel ? ` · #${escapeHtml(item.channel)}` : ""} · ${escapeHtml(formatTime(item.createdAt))}</div>
        </article>
      `
    )
    .join("");
}

function updateMetrics(payload) {
  if (payload) state.metrics = payload;
  const counts = state.metrics.counts || {};
  $("kickCount").textContent = counts.kick || 0;
  $("xCount").textContent = counts.x || 0;
  $("twitchCount").textContent = counts.twitch || 0;
  $("totalCount").textContent = state.messages.length;
  $("clientCount").textContent = `${state.metrics.clients || 0} viewer${state.metrics.clients === 1 ? "" : "s"} · ${state.producerQueue.length} queued`;
  updateConnectionLight();
}

function updateConnectionLight() {
  const light = $("connectionLight");
  const pending = state.queue.length;
  const liveSources = Object.values(state.sources || {}).filter((source) =>
    ["connected", "demo"].includes(source.status)
  ).length;
  light.classList.toggle("live", liveSources > 0);
  if (state.paused) {
    light.textContent = pending ? `Paused · ${pending} queued` : "Paused";
  } else if (liveSources > 0) {
    light.textContent = "Live";
  } else {
    light.textContent = "Connecting";
  }
}

function applySnapshot(payload) {
  state.messages = Array.isArray(payload.history) ? payload.history : [];
  state.sources = payload.sources || {};
  state.config = payload.config || {};
  state.producerQueue = payload.producerQueue || [];
  state.metrics = payload.metrics || state.metrics;
  renderConfig();
  renderFeed();
  renderProducerQueue();
  renderSources();
  updateMetrics(state.metrics);
}

function connectEvents() {
  const events = new EventSource("/events");
  events.addEventListener("snapshot", (event) => applySnapshot(JSON.parse(event.data)));
  events.addEventListener("message", (event) => appendMessage(JSON.parse(event.data)));
  events.addEventListener("status", (event) => {
    const payload = JSON.parse(event.data);
    state.sources = payload.sources || {};
    state.config = payload.config || state.config;
    state.producerQueue = payload.producerQueue || state.producerQueue;
    state.metrics = payload.metrics || state.metrics;
    renderConfig();
    renderProducerQueue();
    renderSources();
    updateMetrics(state.metrics);
  });
  events.addEventListener("queue", (event) => {
    const payload = JSON.parse(event.data);
    state.producerQueue = payload.producerQueue || [];
    state.metrics = payload.metrics || state.metrics;
    renderProducerQueue();
    updateMetrics(state.metrics);
  });
  events.addEventListener("metrics", (event) => updateMetrics(JSON.parse(event.data)));
  events.onerror = () => {
    $("connectionLight").textContent = "Reconnecting";
    $("connectionLight").classList.remove("live");
  };
}

async function postJson(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function getMessageById(id) {
  return state.messages.find((message) => message.id === id);
}

function queueMessage(messageId, kind) {
  return postJson("/api/queue/add", { messageId, kind });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function formatForClipboard(message) {
  return `[${message.sourceLabel || message.source}${message.channel ? ` #${message.channel}` : ""}] ${message.displayName || message.user}: ${message.text}`;
}

function bindControls() {
  $("pauseBtn").addEventListener("click", () => {
    state.paused = !state.paused;
    $("pauseBtn").classList.toggle("isPaused", state.paused);
    $("pauseBtn").title = state.paused ? "Resume feed" : "Pause feed";
    if (!state.paused && state.queue.length) {
      const queued = [...state.queue];
      state.queue = [];
      queued.forEach((message) => appendMessage(message));
      renderFeed();
    }
    updateConnectionLight();
  });

  $("clearBtn").addEventListener("click", async () => {
    state.messages = [];
    state.queue = [];
    renderFeed();
    updateMetrics();
    await postJson("/api/clear");
  });

  $("clearQueueBtn").addEventListener("click", async () => {
    state.producerQueue = [];
    renderProducerQueue();
    updateMetrics();
    await postJson("/api/queue/clear");
  });

  $("feed").addEventListener("click", async (event) => {
    const button = event.target.closest(".messageAction");
    if (!button) return;
    const message = getMessageById(button.dataset.id);
    if (!message) return;
    const action = button.dataset.action;
    if (["question", "signal", "clip"].includes(action)) {
      await queueMessage(message.id, action);
      button.textContent = "Queued";
      setTimeout(() => {
        button.textContent = action.charAt(0).toUpperCase() + action.slice(1);
      }, 900);
      return;
    }
    if (action === "copy") {
      await copyText(formatForClipboard(message));
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 900);
    }
  });

  $("producerQueue").addEventListener("click", async (event) => {
    const button = event.target.closest(".queueRemove");
    if (!button) return;
    const queueId = button.dataset.queueId;
    state.producerQueue = state.producerQueue.filter((item) => item.id !== queueId);
    renderProducerQueue();
    updateMetrics();
    await postJson("/api/queue/remove", { queueId });
  });

  document.querySelectorAll(".sourceToggle").forEach((button) => {
    button.addEventListener("click", () => {
      const source = button.dataset.source;
      if (state.filters.has(source)) state.filters.delete(source);
      else state.filters.add(source);
      button.classList.toggle("active", state.filters.has(source));
      renderFeed();
    });
  });

  $("searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderFeed();
  });

  $("testForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await postJson("/api/demo-message", {
      source: $("testSource").value,
      channel: "manual",
      user: $("testUser").value,
      text: $("testText").value,
    });
  });
}

bindControls();
connectEvents();
