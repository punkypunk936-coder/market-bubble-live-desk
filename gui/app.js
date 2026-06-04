const state = {
  messages: [],
  paused: false,
  queue: [],
  filters: new Set(["kick", "x", "twitch"]),
  intentFilter: "all",
  queueFilter: "open",
  query: "",
  autoScroll: true,
  dense: false,
  metrics: { counts: {}, total: 0, clients: 0 },
  sources: {},
  producerQueue: [],
  config: {},
  visibleCount: 0,
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
  if (state.intentFilter !== "all" && message.intent !== state.intentFilter) return false;
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
  state.visibleCount = visible.length;
  feed.innerHTML = "";
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = "No messages match the current filters.";
    feed.appendChild(empty);
    updateMetrics();
    return;
  }
  for (const message of visible) feed.appendChild(renderMessage(message));
  if (state.autoScroll) feed.scrollTop = feed.scrollHeight;
  updateMetrics();
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
  state.visibleCount = rows.length;
  if (state.autoScroll) feed.scrollTop = feed.scrollHeight;
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

function filteredQueueItems() {
  const items = state.producerQueue || [];
  if (state.queueFilter === "open") return items.filter((item) => !item.done);
  if (state.queueFilter === "done") return items.filter((item) => item.done);
  return items.filter((item) => !item.done && item.kind === state.queueFilter);
}

function renderProducerQueue() {
  const node = $("producerQueue");
  const items = filteredQueueItems();
  const open = (state.producerQueue || []).filter((item) => !item.done).length;
  const done = (state.producerQueue || []).filter((item) => item.done).length;
  $("queueSummary").textContent = `${open} open · ${done} done`;
  if (!items.length) {
    node.innerHTML = `<div class="emptyState compact">No ${state.queueFilter === "open" ? "open" : state.queueFilter} items.</div>`;
    return;
  }
  node.innerHTML = items
    .slice(0, 18)
    .map(
      (item) => `
        <article class="queueItem ${item.source}${item.done ? " done" : ""}">
          <div class="queueTop">
            <span class="queueKind">${escapeHtml(queueKindLabel(item.kind))}</span>
            <div class="queueActions">
              <button class="queueButton" type="button" data-queue-action="done" data-queue-id="${item.id}">${item.done ? "Reopen" : "Done"}</button>
              <button class="queueButton" type="button" data-queue-action="copy" data-queue-id="${item.id}">Copy</button>
              <button class="queueRemove" type="button" data-queue-action="remove" data-queue-id="${item.id}" aria-label="Remove queued item"></button>
            </div>
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
  const open = (state.producerQueue || []).filter((item) => !item.done).length;
  const done = (state.producerQueue || []).filter((item) => item.done).length;
  $("visibleCount").textContent = state.visibleCount || state.messages.filter(passesFilters).length;
  $("queuedCount").textContent = open;
  $("doneCount").textContent = done;
  $("clientCount").textContent = `${state.metrics.clients || 0} viewer${state.metrics.clients === 1 ? "" : "s"}`;
  renderActiveFilterBar();
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

function renderActiveFilterBar() {
  const activeSources = [...state.filters].map((source) => sourceNames[source] || source).join(" + ");
  const type = state.intentFilter === "all" ? "All message types" : intentLabel(state.intentFilter);
  const query = state.query.trim() ? `Search: "${state.query.trim()}"` : "No search";
  $("activeFilterBar").textContent = `${activeSources || "No sources"} · ${type} · ${query}`;
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

function kindForMessage(message) {
  if (message.intent === "question") return "question";
  if (message.intent === "clip" || message.intent === "culture") return "clip";
  return "signal";
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // Fall through to the textarea fallback when clipboard permissions are blocked.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

function formatForClipboard(message) {
  return `[${message.sourceLabel || message.source}${message.channel ? ` #${message.channel}` : ""}] ${message.displayName || message.user}: ${message.text}`;
}

function formatQueueItem(item) {
  return `[${queueKindLabel(item.kind)} · ${item.sourceLabel || item.source}${item.channel ? ` #${item.channel}` : ""}] ${item.displayName || "unknown"}: ${item.text}`;
}

function formatRundown() {
  const openItems = (state.producerQueue || []).filter((item) => !item.done);
  if (!openItems.length) return "Market Bubble Live Desk rundown: no open queued items.";
  const groups = [
    ["question", "On-air Questions"],
    ["signal", "Market Signals"],
    ["clip", "Clip Candidates"],
  ];
  return groups
    .map(([kind, label]) => {
      const items = openItems.filter((item) => item.kind === kind);
      if (!items.length) return "";
      return `${label}\n${items.map((item, index) => `${index + 1}. ${formatQueueItem(item)}`).join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function bindControls() {
  $("pauseBtn").addEventListener("click", () => {
    state.paused = !state.paused;
    $("pauseBtn").classList.toggle("isPaused", state.paused);
    $("pauseBtn").title = state.paused ? "Resume feed" : "Pause feed";
    $("pauseLabel").textContent = state.paused ? "Resume" : "Pause";
    if (!state.paused && state.queue.length) {
      const queued = [...state.queue];
      state.queue = [];
      queued.forEach((message) => appendMessage(message));
      renderFeed();
    }
    updateConnectionLight();
  });

  $("autoScrollBtn").addEventListener("click", () => {
    state.autoScroll = !state.autoScroll;
    $("autoScrollBtn").classList.toggle("active", state.autoScroll);
    if (state.autoScroll) {
      const feed = $("feed");
      feed.scrollTop = feed.scrollHeight;
    }
  });

  $("densityBtn").addEventListener("click", () => {
    state.dense = !state.dense;
    document.body.classList.toggle("denseMode", state.dense);
    $("densityBtn").classList.toggle("active", state.dense);
  });

  $("clearBtn").addEventListener("click", async () => {
    state.messages = [];
    state.queue = [];
    renderFeed();
    updateMetrics();
    await postJson("/api/clear");
  });

  $("clearDoneBtn").addEventListener("click", async () => {
    state.producerQueue = state.producerQueue.filter((item) => !item.done);
    renderProducerQueue();
    updateMetrics();
    await postJson("/api/queue/clear-done");
  });

  $("copyRundownBtn").addEventListener("click", async () => {
    await copyText(formatRundown());
    $("copyRundownBtn").textContent = "Copied";
    setTimeout(() => {
      $("copyRundownBtn").textContent = "Copy Rundown";
    }, 900);
  });

  $("feed").addEventListener("click", async (event) => {
    const button = event.target.closest(".messageAction");
    if (!button) return;
    const message = getMessageById(button.dataset.id);
    if (!message) return;
    const action = button.dataset.action;
    if (action === "smart") {
      await queueMessage(message.id, kindForMessage(message));
      button.textContent = "Queued";
      setTimeout(() => {
        button.textContent = "Queue";
      }, 900);
      return;
    }
    if (["question", "signal", "clip"].includes(action)) {
      await queueMessage(message.id, action);
      button.textContent = "Queued";
      setTimeout(() => {
        button.textContent = action === "question" ? "Ask" : action.charAt(0).toUpperCase() + action.slice(1);
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
    const button = event.target.closest("[data-queue-action]");
    if (!button) return;
    const queueId = button.dataset.queueId;
    const item = state.producerQueue.find((queueItem) => queueItem.id === queueId);
    if (!item) return;
    if (button.dataset.queueAction === "done") {
      item.done = !item.done;
      renderProducerQueue();
      updateMetrics();
      await postJson("/api/queue/update", { queueId, done: item.done });
      return;
    }
    if (button.dataset.queueAction === "copy") {
      await copyText(formatQueueItem(item));
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 900);
      return;
    }
    if (button.dataset.queueAction === "remove") {
      state.producerQueue = state.producerQueue.filter((queueItem) => queueItem.id !== queueId);
      renderProducerQueue();
      updateMetrics();
      await postJson("/api/queue/remove", { queueId });
    }
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

  document.querySelectorAll(".viewToggle").forEach((button) => {
    button.addEventListener("click", () => {
      state.intentFilter = button.dataset.intent || "all";
      document.querySelectorAll(".viewToggle").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      renderFeed();
    });
  });

  document.querySelectorAll(".queueTab").forEach((button) => {
    button.addEventListener("click", () => {
      state.queueFilter = button.dataset.queueFilter || "open";
      document.querySelectorAll(".queueTab").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      renderProducerQueue();
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
