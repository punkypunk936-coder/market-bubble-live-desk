const state = {
  messages: [],
  paused: false,
  queue: [],
  filters: new Set(["kick", "x", "twitch"]),
  intentFilter: "all",
  decisionFilter: "all",
  queueFilter: "open",
  query: "",
  autoScroll: true,
  dense: false,
  segmentLens: false,
  metrics: { counts: {}, total: 0, clients: 0 },
  sources: {},
  producerQueue: [],
  config: {},
  showState: { currentSegment: "" },
  visibleCount: 0,
  focusTerm: "",
  radar: [],
  segmentEditorOpen: false,
  segmentDraft: null,
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

function relativeAge(value) {
  if (!value) return "no messages yet";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
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

function priorityLabel(priority) {
  return {
    high: "High signal",
    medium: "Signal",
    normal: "",
  }[priority || "normal"] || "";
}

function isDemoMessage(message) {
  const meta = message?.meta || {};
  return Boolean(meta.demoPulse || meta.episodeAware || message?.channel === "demo");
}

function sourceModeLabel(status) {
  if (status === "connected") return "Live";
  if (status === "demo") return "Demo";
  if (status === "reconnecting") return "Retrying";
  if (status === "error") return "Error";
  return "Idle";
}

function messageTimeMs(message) {
  const value = new Date(message.receivedAt || message.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function messageMatchesTerm(message, term) {
  const value = `${message.text || ""} ${(message.matchedTerms || []).join(" ")}`.toLowerCase();
  return value.includes(String(term || "").toLowerCase());
}

function segmentNames() {
  return (state.config.segments || []).map((segment) => segment.name).filter(Boolean);
}

function segmentKeywords(segment) {
  return Array.isArray(segment?.keywords)
    ? segment.keywords.map((item) => String(item || "").trim()).filter(Boolean)
    : String(segment?.keywords || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function cloneSegmentConfig(segments = state.config.segments || []) {
  return segments.map((segment) => ({
    name: String(segment.name || "").trim(),
    brief: String(segment.brief || "").trim(),
    keywords: segmentKeywords(segment),
  }));
}

function segmentConfigByName(name) {
  const requested = String(name || "").trim().toLowerCase();
  return (state.config.segments || []).find((segment) => String(segment.name || "").toLowerCase() === requested) || null;
}

function normalizeSegment(value, fallback = "") {
  const requested = String(value || "").trim().toLowerCase();
  const match = segmentNames().find((name) => name.toLowerCase() === requested);
  return match || fallback;
}

function currentSegmentName() {
  const names = segmentNames();
  return normalizeSegment(state.showState?.currentSegment, names[0] || "");
}

function queueTimeMs(item) {
  const value = new Date(item.queuedAt || item.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function smartKindForMessage(message) {
  if (["question", "signal", "clip"].includes(message?.operator?.kind)) return message.operator.kind;
  if (message.intent === "question") return "question";
  if (message.intent === "clip" || message.intent === "culture") return "clip";
  return "signal";
}

function queuedKindsForMessage(messageId) {
  return new Set(
    (state.producerQueue || [])
      .filter((item) => !item.done && item.messageId === messageId)
      .map((item) => item.kind)
  );
}

function baseOperatorDecision(message) {
  const decision = message?.operator?.decision;
  if (["queue", "watch", "ignore"].includes(decision)) return decision;
  if (message?.priority === "high") return "queue";
  if (message?.priority === "medium") return "watch";
  return "ignore";
}

function operatorReason(message) {
  return message?.operator?.reason || operatorCueForMessage(message);
}

function decisionForMessage(message) {
  const base = baseOperatorDecision(message);
  const segment = segmentForMessage(message);
  const current = currentSegmentName();
  if (base === "queue" && segment === current) {
    return { status: "use", label: "Use Now", reason: operatorReason(message), kind: message?.operator?.kind || smartKindForMessage(message) };
  }
  if (base === "queue") {
    return { status: "park", label: "Rest", reason: `For ${segment}`, kind: message?.operator?.kind || smartKindForMessage(message) };
  }
  if (base === "watch") {
    return { status: "watch", label: "Rest", reason: operatorReason(message), kind: message?.operator?.kind || smartKindForMessage(message) };
  }
  return { status: "noise", label: "Rest", reason: message?.operator?.reason || "Low actionability", kind: message?.operator?.kind || smartKindForMessage(message) };
}

function passesBaseFilters(message) {
  if (!state.filters.has(message.source)) return false;
  if (state.intentFilter === "high") {
    if (message.priority !== "high") return false;
  } else if (state.intentFilter !== "all" && message.intent !== state.intentFilter) {
    return false;
  }
  const query = state.query.trim().toLowerCase();
  const focus = state.focusTerm.trim().toLowerCase();
  if (focus && !messageMatchesTerm(message, focus)) return false;
  if (state.segmentLens && segmentForMessage(message) !== currentSegmentName()) return false;
  if (!query) return true;
  return [message.text, message.displayName, message.user, message.channel, message.sourceLabel, message.intent, ...(message.matchedTerms || [])]
    .filter(Boolean)
    .some((part) => String(part).toLowerCase().includes(query));
}

function passesFilters(message) {
  if (!passesBaseFilters(message)) return false;
  if (state.decisionFilter === "rest") return decisionForMessage(message).status !== "use";
  if (state.decisionFilter !== "all" && decisionForMessage(message).status !== state.decisionFilter) return false;
  return true;
}

function operatorCueForMessage(message) {
  const segment = segmentForMessage(message);
  const terms = (message.matchedTerms || []).slice(0, 3).join(", ");
  if (message.intent === "question") return `${segment} ask${terms ? ` · ${terms}` : ""}`;
  if (message.intent === "clip") return `${segment} clip candidate${terms ? ` · ${terms}` : ""}`;
  if (message.intent === "culture") return `${segment} context${terms ? ` · ${terms}` : ""}`;
  if (message.intent === "market") return `${segment} market signal${terms ? ` · ${terms}` : ""}`;
  return `${segment} watch item${terms ? ` · ${terms}` : ""}`;
}

function operatorOutcomeForMessage(message, decision = decisionForMessage(message)) {
  const kind = decision.kind || smartKindForMessage(message);
  const segment = segmentForMessage(message);
  const current = currentSegmentName();
  const text = String(message?.text || "");
  const terms = Array.isArray(message?.matchedTerms) ? message.matchedTerms.filter(Boolean) : [];
  const leadTerm = terms[0] || "";
  const isSegue = segment !== current || /\b(segway|segue|transition|next segment|bring up|talk about|move into)\b/i.test(text);

  if (decision.status === "park") {
    return {
      label: "Bring back later",
      detail: `Fits ${segment}; keep it parked while ${current} is live.`,
    };
  }
  if (decision.status === "watch") {
    return {
      label: "Watch for heat",
      detail: "Let it build; act only if the topic repeats or gains a stronger source.",
    };
  }
  if (decision.status === "noise") {
    return {
      label: "Low priority",
      detail: "Let it pass unless the same topic starts repeating.",
    };
  }
  if (kind === "question") {
    if (isSegue) {
      return {
        label: "Segment segue",
        detail: `Use it as a clean handoff into ${segment}.`,
      };
    }
    return {
      label: "On-air question",
      detail: `Put it to the hosts in ${segment}.`,
    };
  }
  if (kind === "clip") {
    if (message.intent === "culture") {
      return {
        label: "Culture beat",
        detail: "Use it as a timeline read, then mark the moment for social.",
      };
    }
    return {
      label: "Clip candidate",
      detail: "Save the exchange for X, TikTok, or Shorts after the segment.",
    };
  }
  if (kind === "signal") {
    return {
      label: "Market beat",
      detail: leadTerm
        ? `Turn ${leadTerm} into a quick host read or debate.`
        : "Turn it into a quick host read or debate.",
    };
  }
  return {
    label: "Producer prompt",
    detail: `Use it to steer ${segment} without derailing the segment.`,
  };
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
  const priority = template.querySelector(".priorityPill");
  const mode = template.querySelector(".modePill");
  const segment = template.querySelector(".segmentPill");
  const matchTerms = template.querySelector(".matchTerms");
  const decisionBadge = template.querySelector(".decisionBadge");
  const decisionReason = template.querySelector(".decisionReason");
  const text = template.querySelector(".messageText");
  const cue = template.querySelector(".messageCue");
  const time = template.querySelector(".messageTime");
  const actions = template.querySelectorAll(".messageAction");

  row.classList.add(message.source);
  row.classList.add(`priority-${message.priority || "normal"}`);
  const decision = decisionForMessage(message);
  row.classList.add(`decision-${decision.status}`);
  if (decision.status === "use") row.classList.add("use-now");
  row.dataset.decision = decision.status;
  row.dataset.messageId = message.id;
  const queuedKinds = queuedKindsForMessage(message.id);
  if (queuedKinds.size) row.classList.add("queued");
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
  priority.textContent = priorityLabel(message.priority);
  if (message.priority) priority.classList.add(message.priority);
  if (isDemoMessage(message)) {
    mode.textContent = "Demo";
    mode.title = "Sample/rehearsal item, not a real audience message.";
    mode.classList.add("demo");
  } else {
    mode.textContent = "Live";
    mode.title = "Live or manually injected operator item.";
    mode.classList.add("live");
  }
  segment.textContent = segmentForMessage(message);
  matchTerms.textContent = (message.matchedTerms || []).join(", ");
  decisionBadge.textContent = decision.label;
  decisionBadge.classList.add(decision.status);
  decisionReason.classList.add(decision.status);
  const outcome = operatorOutcomeForMessage(message, decision);
  row.dataset.potential = outcome.label;
  decisionReason.innerHTML = `
    <strong class="messagePotential">${decision.status === "use" ? `Potential: ${escapeHtml(outcome.label)}` : escapeHtml(outcome.label)}</strong>
    <span class="messageReason">${escapeHtml(outcome.detail)}${decision.reason ? ` · ${escapeHtml(decision.reason)}` : ""}</span>
  `;
  text.textContent = escapeText(message.text);
  cue.textContent = operatorCueForMessage(message);
  time.textContent = formatTime(message.createdAt || message.receivedAt);
  time.dateTime = message.createdAt || message.receivedAt || "";
  actions.forEach((button) => {
    button.dataset.id = message.id;
    const action = button.dataset.action;
    const kind = action === "smart" ? smartKindForMessage(message) : action;
    if (["question", "signal", "clip"].includes(kind) && queuedKinds.has(kind)) {
      button.textContent = action === "smart" ? "Queued" : "Added";
      button.classList.add("queuedAction");
    }
  });

  return row;
}

function renderFeed() {
  const feed = $("feed");
  const visible = state.messages.filter(passesFilters).slice(-250);
  state.visibleCount = visible.length;
  renderDecisionBar();
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
  renderRadar();
  renderDecisionBar();
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

function renderDecisionBar() {
  const node = $("decisionBar");
  if (!node) return;
  const scoped = state.messages.filter(passesBaseFilters);
  const counts = scoped.reduce((acc, message) => {
    const status = decisionForMessage(message).status;
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { use: 0, watch: 0, park: 0, noise: 0 });
  const restCount = counts.watch + counts.park + counts.noise;
  const items = [
    ["use", "Use Now", counts.use, "Ask, clip, segue, or host read"],
    ["rest", "Rest", restCount, "Watch, park, or ignore"],
    ["all", "All", scoped.length, "Everything visible"],
  ];
  node.innerHTML = `
    <span class="decisionBarLabel"><strong>Operator read</strong><small>Use Now first. Rest can wait.</small></span>
    ${items.map(([status, label, count, description]) => `
      <button class="decisionFilter${state.decisionFilter === status ? " active" : ""} ${status}" type="button" data-decision="${status}">
        <span>${label}</span>
        <small>${description}</small>
        <strong>${count}</strong>
      </button>
    `).join("")}
  `;
}

function renderSources() {
  const list = $("sourceStatus");
  const sources = state.sources || {};
  list.innerHTML = ["kick", "x", "twitch"]
    .map((source) => {
      const item = sources[source] || {};
      const status = item.status || "idle";
      const modeLabel = sourceModeLabel(status);
      const detail = status === "demo"
        ? "Sample/rehearsal feed. Configure credentials/channels to ingest real audience messages."
        : item.detail || "Not configured.";
      const lastAge = relativeAge(item.lastMessageAt);
      const isStale = item.lastMessageAt && Date.now() - new Date(item.lastMessageAt).getTime() > 120000;
      return `
        <div class="statusItem ${source} status-${status}${isStale ? " stale" : ""}">
          <div class="statusTop">
            <span class="statusName">${sourceNames[source]}</span>
            <span class="statusPill">${modeLabel}</span>
          </div>
          <div class="statusDetail">${escapeHtml(detail)}</div>
          <div class="statusMeta">Last item: ${escapeHtml(lastAge)}</div>
        </div>
      `;
    })
    .join("");
}

function renderEpisodeBrief() {
  const node = $("episodeBrief");
  if (!node) return;
  const episode = state.config.latestEpisode || {};
  if (!episode.title) {
    node.innerHTML = `<div class="emptyState compact">No latest-show rehearsal configured.</div>`;
    return;
  }
  const beats = (episode.segments || [])
    .map((item) => `
      <div class="episodeBeat">
        <strong>${escapeHtml(item.segment || "Segment")}</strong>
        <span>${escapeHtml(item.beat || "")}</span>
      </div>
    `)
    .join("");
  const terms = (episode.watchTerms || [])
    .slice(0, 12)
    .map((term) => `<span>${escapeHtml(term)}</span>`)
    .join("");
  node.innerHTML = `
    <div class="episodeKicker">${escapeHtml(episode.airDate || "Latest show")}</div>
    <p>${escapeHtml(episode.thesis || "")}</p>
    <div class="episodeBeats">${beats}</div>
    <div class="episodeTerms">${terms}</div>
  `;
}

function renderWorkflowFit() {
  const node = $("workflowFit");
  if (!node) return;
  const items = state.config.workflowFit || [];
  if (!items.length) {
    node.innerHTML = `<div class="emptyState compact">No workflow fit notes configured.</div>`;
    return;
  }
  node.innerHTML = items
    .map((item) => `
      <div class="workflowItem">
        <strong>${escapeHtml(item.label || "Workflow")}</strong>
        <span>${escapeHtml(item.body || "")}</span>
      </div>
    `)
    .join("");
}

function renderPreviousEpisodes() {
  const node = $("previousEpisodes");
  if (!node) return;
  const episodes = state.config.previousEpisodes || [];
  if (!episodes.length) {
    node.innerHTML = `<div class="emptyState compact">No previous-show context configured.</div>`;
    return;
  }
  node.innerHTML = episodes
    .map((episode) => `
      <article class="previousEpisode">
        <div>
          <strong>${escapeHtml(episode.title || "Market Bubble episode")}</strong>
          <span>${escapeHtml(episode.airDate || "")}</span>
        </div>
        <p>${escapeHtml(episode.deskFit || "")}</p>
        <div class="episodeTerms">${(episode.themes || []).slice(0, 6).map((theme) => `<span>${escapeHtml(theme)}</span>`).join("")}</div>
      </article>
    `)
    .join("");
}

function syncSegmentDraftFromForm() {
  const rows = [...document.querySelectorAll(".segmentEditRow")];
  if (!rows.length) return;
  state.segmentDraft = rows.map((row) => ({
    name: row.querySelector("[data-segment-field='name']")?.value.trim() || "",
    brief: row.querySelector("[data-segment-field='brief']")?.value.trim() || "",
    keywords: (row.querySelector("[data-segment-field='keywords']")?.value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  }));
}

function sanitizedSegmentDraft() {
  const seen = new Set();
  return (state.segmentDraft || [])
    .map((segment) => ({
      name: String(segment.name || "").trim().replace(/\s+/g, " "),
      brief: String(segment.brief || "").trim().replace(/\s+/g, " "),
      keywords: segmentKeywords(segment),
    }))
    .filter((segment) => {
      if (!segment.name) return false;
      const key = segment.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function renderSegmentEditorRows() {
  const rows = $("segmentEditorRows");
  if (!rows) return;
  const draft = state.segmentDraft || cloneSegmentConfig();
  rows.innerHTML = draft
    .map((segment, index) => `
      <div class="segmentEditRow" data-index="${index}">
        <label>
          <span>Name</span>
          <input data-segment-field="name" type="text" maxlength="40" value="${escapeHtml(segment.name)}" placeholder="Segment name" />
        </label>
        <label>
          <span>Brief</span>
          <input data-segment-field="brief" type="text" maxlength="140" value="${escapeHtml(segment.brief)}" placeholder="What belongs here?" />
        </label>
        <label>
          <span>Keywords</span>
          <input data-segment-field="keywords" type="text" value="${escapeHtml(segmentKeywords(segment).join(", "))}" placeholder="BTC, AI, sports, culture" />
        </label>
        <button class="queueRemove" type="button" data-segment-action="remove" aria-label="Remove segment"></button>
      </div>
    `)
    .join("");
  $("addSegmentBtn").disabled = draft.length >= 8;
}

function renderSegmentSetup() {
  const list = $("todaySegmentsList");
  const editor = $("segmentEditor");
  if (!list || !editor) return;
  const editButton = $("editSegmentsBtn");
  const activeSegment = currentSegmentName();
  const segments = state.config.segments || [];
  if (editButton) editButton.textContent = state.segmentEditorOpen ? "Close Editor" : "Edit Today's Segments";
  list.hidden = state.segmentEditorOpen;
  list.innerHTML = segments.length
    ? segments.map((segment, index) => `
      <div class="todaySegment${segment.name === activeSegment ? " active" : ""}">
        <span>${index + 1}</span>
        <div>
          <strong>${escapeHtml(segment.name)}</strong>
          <small>${escapeHtml(segment.brief || "No brief yet")}</small>
          ${segmentKeywords(segment).length ? `<em>${segmentKeywords(segment).slice(0, 6).map(escapeHtml).join(" · ")}</em>` : ""}
        </div>
      </div>
    `).join("")
    : `<div class="emptyState compact">No segments configured.</div>`;
  editor.hidden = !state.segmentEditorOpen;
  if (state.segmentEditorOpen) {
    if (!state.segmentDraft) state.segmentDraft = cloneSegmentConfig();
    renderSegmentEditorRows();
  }
}

function openSegmentEditor() {
  state.segmentEditorOpen = true;
  state.segmentDraft = cloneSegmentConfig();
  renderSegmentSetup();
  requestAnimationFrame(() => {
    const firstInput = document.querySelector("#segmentEditorRows [data-segment-field='name']");
    $("segmentEditor")?.scrollIntoView({ block: "start", behavior: "smooth" });
    firstInput?.focus({ preventScroll: true });
  });
}

function closeSegmentEditor() {
  state.segmentEditorOpen = false;
  state.segmentDraft = null;
  renderSegmentSetup();
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

  const activeSegment = currentSegmentName();
  const segments = config.segments || [];
  const segmentControls = segments.length
    ? `
      <div class="segmentMode" aria-label="Segment mode">
        <span class="toolbarLabel">Segment Mode</span>
        <div class="segmentButtons" role="group" aria-label="Current show segment">
          ${segments
            .map((segment) => `
              <button
                class="segmentButton${segment.name === activeSegment ? " active" : ""}"
                type="button"
                data-segment="${escapeHtml(segment.name)}"
                title="${escapeHtml(segment.brief || segment.name)}"
              >
                ${escapeHtml(segment.name)}
              </button>
            `)
            .join("")}
        </div>
      </div>
    `
    : "";
  const contextChips = (config.context || [])
    .map((item) => `<span class="contextChip">${escapeHtml(item)}</span>`)
    .join("");
  $("contextRail").innerHTML = `${segmentControls}<div class="contextChips" hidden>${contextChips}</div>`;
  $("runOfShow").innerHTML = (config.segments || [])
    .map(
      (segment) => `
        <div class="segmentItem${segment.name === activeSegment ? " active" : ""}">
          <strong>${escapeHtml(segment.name)}</strong>
          <span>${escapeHtml(segment.brief)}</span>
        </div>
      `
    )
    .join("");
  $("watchlist").innerHTML = (config.watchlist || [])
    .map((item) => `<span class="watchChip">${escapeHtml(item)}</span>`)
    .join("");
  renderSegmentSetup();
  renderEpisodeBrief();
  renderWorkflowFit();
  renderPreviousEpisodes();
}

function segmentForTerm(term, sample) {
  const value = `${term || ""} ${sample?.text || ""}`.toLowerCase();
  const scored = (state.config.segments || [])
    .map((segment) => {
      const score = segmentKeywords(segment).reduce((total, keyword) => {
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
  return normalizeSegment("The Price Is Wrong", segmentNames()[0] || "");
}

function segmentForMessage(message) {
  const matchedTerms = Array.isArray(message?.matchedTerms) ? message.matchedTerms : [];
  return normalizeSegment(
    message?.segment,
    segmentForTerm(matchedTerms[0] || "", message)
  );
}

function topicSegmentForMessage(message) {
  const matchedTerms = Array.isArray(message?.matchedTerms) ? message.matchedTerms : [];
  return normalizeSegment(
    message?.topicSegment || message?.segment,
    segmentForTerm(matchedTerms[0] || "", message)
  );
}

function suggestedPrompt(term, item) {
  const segment = item?.segment || segmentForTerm(term, item?.sample);
  const segmentConfig = segmentConfigByName(segment);
  if (segment === "Culture Shock") return `Ask whether ${term} is a real attention market or just timeline noise.`;
  if (segment === "Pick n' Roll") return `Ask what number would make ${term} mispriced enough to take seriously.`;
  if (segment === "Future-Proof") return `Ask how ${term} changes the long-term market structure or trade setup.`;
  if (segmentConfig) return `Ask how ${term} fits ${segment}, and what the operator should do with it now.`;
  return `Ask where the market is wrong on ${term}, and what would move the odds.`;
}

function computeRadar() {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const recent = state.messages.filter((message) => now - messageTimeMs(message) <= windowMs);
  const watchlist = state.config.watchlist || [];
  const activeSegment = currentSegmentName();
  const rows = watchlist
    .map((term) => {
      const hits = recent.filter((message) => messageMatchesTerm(message, term));
      const allHits = state.messages.filter((message) => messageMatchesTerm(message, term));
      const sourceCounts = hits.reduce((acc, message) => {
        acc[message.source] = (acc[message.source] || 0) + 1;
        return acc;
      }, {});
      const high = hits.filter((message) => message.priority === "high").length;
      const usable = hits.filter((message) => baseOperatorDecision(message) === "queue").length;
      const sample = hits.find((message) => message.priority === "high") || hits[0] || allHits[allHits.length - 1] || null;
      const segment = normalizeSegment(sample?.segment, segmentForTerm(term, sample));
      const inCurrentSegment = segment === activeSegment;
      return {
        term,
        count: hits.length,
        allCount: allHits.length,
        high,
        sourceCounts,
        sample,
        segment,
        inCurrentSegment,
        usable,
        radarScore: usable * 8 + high * 3 + hits.length * 2 + Math.min(allHits.length, 8) + (inCurrentSegment ? 6 : 0),
      };
    })
    .filter((item) => item.count > 0 || item.allCount > 0)
    .sort((a, b) => (b.radarScore - a.radarScore) || (b.high - a.high) || (b.count - a.count) || (b.allCount - a.allCount))
    .slice(0, 8);
  state.radar = rows;
  return rows;
}

function formatSources(sourceCounts) {
  const parts = Object.entries(sourceCounts || {})
    .filter(([, count]) => count > 0)
    .map(([source, count]) => `${sourceNames[source] || source} ${count}`);
  return parts.length ? parts.join(" · ") : "No recent source hits";
}

function formatFocusBrief(item) {
  if (!item) return "No focused signal selected.";
  const sample = item.sample ? formatForClipboard(item.sample) : "No sample message captured yet.";
  const activeSegment = currentSegmentName();
  const timing = item.segment === activeSegment
    ? `Use now in ${activeSegment}.`
    : `Park for ${item.segment}; current segment is ${activeSegment}.`;
  return [
    `Market Bubble focus: ${item.term}`,
    `Current segment: ${activeSegment}`,
    `Topic segment: ${item.segment}`,
    `Timing note: ${timing}`,
    `Recent heat: ${item.count} mentions in the last 10 minutes, ${item.usable || 0} usable, ${item.high} high-signal.`,
    `Sources: ${formatSources(item.sourceCounts)}`,
    `Suggested on-air move: ${suggestedPrompt(item.term, item)}`,
    `Sample: ${sample}`,
  ].join("\n");
}

function openQueueItems() {
  return (state.producerQueue || []).filter((item) => !item.done);
}

function topRadarForSegment() {
  const rows = state.radar || [];
  return rows.find((item) => item.inCurrentSegment) || rows[0] || null;
}

function queueKindCounts(items) {
  return items.reduce((acc, item) => {
    acc[item.kind] = (acc[item.kind] || 0) + 1;
    return acc;
  }, {});
}

function assistActionType(label = "") {
  const value = String(label || "").toLowerCase();
  if (value.includes("ask")) return "question";
  if (value.includes("market") || value.includes("signal")) return "signal";
  if (value.includes("clip")) return "clip";
  if (value.includes("queue")) return "queue";
  if (value.includes("park")) return "park";
  return "watch";
}

function assistMixSummary(counts) {
  const parts = [
    [counts.question || 0, "ask"],
    [counts.signal || 0, "signal"],
    [counts.clip || 0, "clip"],
  ].filter(([count]) => count > 0);
  return parts.length ? parts.map(([count, label]) => `${count} ${label}`).join(" / ") : "No queued asks, signals, or clips yet";
}

function moveFromMessage(label, body, detail, message, status = "use") {
  const kind = message?.kind || message?.operator?.kind || smartKindForMessage(message);
  const outcome = operatorOutcomeForMessage(message, { status, label: status === "use" ? "Use Now" : "Rest", reason: detail, kind });
  return {
    label,
    body,
    detail,
    actionType: kind,
    outcomeLabel: outcome.label,
    outcomeDetail: outcome.detail,
  };
}

function assistOutcomeForMove(move) {
  if (move.outcomeLabel) {
    return {
      label: move.outcomeLabel,
      detail: move.outcomeDetail || move.detail,
    };
  }
  const actionType = move.actionType || assistActionType(move.label);
  return {
    question: { label: "On-air question", detail: "Put it directly to the hosts or guest." },
    signal: { label: "Market beat", detail: "Turn it into a quick host read or debate." },
    clip: { label: "Clip candidate", detail: "Save it for X, TikTok, or Shorts after the segment." },
    queue: { label: "Producer prompt", detail: "Queue it so the hosts can use it cleanly." },
    park: { label: "Bring back later", detail: "Hold it until the right segment is live." },
    watch: { label: "Watch item", detail: "Let it build before taking it on air." },
  }[actionType] || { label: "Producer prompt", detail: "Use it only if it helps the current segment." };
}

function sourceSummary() {
  return ["kick", "x", "twitch"]
    .map((source) => {
      const item = state.sources?.[source] || {};
      const status = item.status || "idle";
      return `${sourceNames[source]} ${status}${item.lastMessageAt ? `, last ${relativeAge(item.lastMessageAt)}` : ""}`;
    })
    .join("; ");
}

function topActionableFeedMessage() {
  const activeSegment = currentSegmentName();
  return state.messages
    .filter((message) =>
      decisionForMessage(message).status === "use" &&
      segmentForMessage(message) === activeSegment &&
      !queuedKindsForMessage(message.id).size
    )
    .sort((a, b) =>
      ((b.operator?.actionability || 0) - (a.operator?.actionability || 0)) ||
      ((b.signalScore || 0) - (a.signalScore || 0)) ||
      (messageTimeMs(b) - messageTimeMs(a))
    )[0] || null;
}

function producerNextMove() {
  const activeSegment = currentSegmentName();
  const openItems = openQueueItems();
  const nowItems = openItems.filter((item) => segmentForMessage(item) === activeSegment);
  const topQuestion = nowItems.find((item) => item.kind === "question");
  const topClip = nowItems.find((item) => item.kind === "clip");
  const topSignal = nowItems.find((item) => item.kind === "signal");
  const radar = topRadarForSegment();

  if (topQuestion) {
    return moveFromMessage(
      "Ask this next",
      `${topQuestion.displayName || "unknown"}: ${topQuestion.text}`,
      `${activeSegment} question already queued.`,
      topQuestion
    );
  }
  if (topSignal) {
    return moveFromMessage(
      "Bring this market beat up",
      `${topSignal.displayName || "unknown"}: ${topSignal.text}`,
      `${activeSegment} signal is ready for host handoff.`,
      topSignal
    );
  }
  if (topClip) {
    return moveFromMessage(
      "Mark this for clipping",
      `${topClip.displayName || "unknown"}: ${topClip.text}`,
      `${activeSegment} clip candidate is waiting.`,
      topClip
    );
  }
  const feedCandidate = topActionableFeedMessage();
  if (feedCandidate) {
    const decision = decisionForMessage(feedCandidate);
    return moveFromMessage(
      "Queue this from the feed",
      `${feedCandidate.displayName || "unknown"}: ${feedCandidate.text}`,
      `${decision.reason}. Suggested route: ${queueKindLabel(decision.kind)}.`,
      feedCandidate
    );
  }
  if (radar && radar.inCurrentSegment) {
    return {
      label: `Use ${radar.term} as a prompt`,
      body: suggestedPrompt(radar.term, radar),
      detail: `${radar.count} recent mentions across ${formatSources(radar.sourceCounts)}.`,
      actionType: "signal",
      outcomeLabel: "Segment prompt",
      outcomeDetail: `Use ${radar.term} to open a short host read in ${activeSegment}.`,
    };
  }
  if (radar) {
    return {
      label: `Park ${radar.term}`,
      body: suggestedPrompt(radar.term, radar),
      detail: `Topic fits ${radar.segment}; current segment is ${activeSegment}.`,
      actionType: "park",
      outcomeLabel: "Bring back later",
      outcomeDetail: `Hold ${radar.term} for ${radar.segment}.`,
    };
  }
  return {
    label: "Keep monitoring",
    body: "No clear segment signal yet. Stay in all-feed mode until radar or queue pressure builds.",
    detail: "Sources are connected when the status cards show live or demo.",
    actionType: "watch",
    outcomeLabel: "Monitor only",
    outcomeDetail: "Nothing deserves airtime yet; keep the room focused.",
  };
}

function renderProducerAssist() {
  if (!$("nextMove")) return;
  const activeSegment = currentSegmentName();
  const openItems = openQueueItems();
  const nowItems = openItems.filter((item) => segmentForMessage(item) === activeSegment);
  const parkedTopicFit = openItems.filter((item) => segmentForMessage(item) !== activeSegment && topicSegmentForMessage(item) === activeSegment);
  const heatCount = (state.radar || [])
    .filter((item) => item.inCurrentSegment)
    .reduce((total, item) => total + item.count, 0);
  const counts = queueKindCounts(nowItems);
  const move = producerNextMove();
  const actionType = move.actionType || assistActionType(move.label);
  const outcome = assistOutcomeForMove(move);
  const mixSummary = assistMixSummary(counts);
  const topRadar = topRadarForSegment();

  $("assistSubhead").innerHTML = `
    <span>Current segment</span>
    <strong>${escapeHtml(activeSegment)}</strong>
    <em>${openItems.length} open across the desk</em>
  `;
  $("assistNowCount").textContent = nowItems.length;
  $("assistParkedCount").textContent = parkedTopicFit.length;
  $("assistHeatCount").textContent = heatCount;
  $("nextMove").innerHTML = `
    <div class="nextMoveTop">
      <span class="nextMoveLabel">Use Now</span>
      <span class="assistType ${actionType}">${escapeHtml(outcome.label)}</span>
    </div>
    <h3>${escapeHtml(move.label)}</h3>
    <p>${escapeHtml(move.body)}</p>
    <div class="assistReadGrid">
      <div class="assistWhy">
        <span>Can become</span>
        <strong>${escapeHtml(outcome.detail)}</strong>
      </div>
      <div class="assistWhy">
        <span>Why now</span>
        <strong>${escapeHtml(move.detail)}</strong>
      </div>
    </div>
    <div class="assistQueueRead">
      <span>${escapeHtml(mixSummary)}</span>
      ${topRadar ? `<em>Radar: ${escapeHtml(topRadar.term)} · ${topRadar.count} hits</em>` : "<em>Radar: quiet</em>"}
    </div>
  `;
}

function renderOperatorBrief() {
  const node = $("operatorBrief");
  if (!node) return;
  const activeSegment = currentSegmentName();
  const segment = segmentConfigByName(activeSegment);
  const openItems = openQueueItems();
  const nowItems = openItems.filter((item) => segmentForMessage(item) === activeSegment);
  const counts = queueKindCounts(nowItems);
  const feedUseNowCount = state.messages.filter((message) =>
    state.filters.has(message.source) &&
    segmentForMessage(message) === activeSegment &&
    decisionForMessage(message).status === "use"
  ).length;
  const useNowCount = Math.max(feedUseNowCount, nowItems.length);
  const move = producerNextMove();
  const outcome = assistOutcomeForMove(move);
  const radar = topRadarForSegment();
  const radarMode = radar?.usable > 0 ? "Use or queue" : "Monitor";
  const radarBody = radar
    ? `${radarMode} · ${radar.count} recent · ${formatSources(radar.sourceCounts)}`
    : "No watchlist heat yet";
  const queueMix = assistMixSummary(counts);
  node.innerHTML = `
    <button class="briefCard segment" type="button" data-brief-action="segment">
      <span>Live Segment</span>
      <strong>${escapeHtml(activeSegment || "No segment")}</strong>
      <small>${escapeHtml(segment?.brief || "Set today's rundown in Show Notes.")}</small>
    </button>
    <button class="briefCard use" type="button" data-brief-action="use" data-feed-ready="${feedUseNowCount}" data-queue-ready="${nowItems.length}">
      <span>Use Now</span>
      <strong>${escapeHtml(String(useNowCount))} ready</strong>
      <small>${escapeHtml(move.label)} · ${escapeHtml(outcome.label)}</small>
    </button>
    <button class="briefCard heat" type="button" data-brief-action="radar"${radar ? ` data-term="${escapeHtml(radar.term)}"` : ""}>
      <span>Heat</span>
      <strong>${escapeHtml(radar?.term || "Quiet")}</strong>
      <small>${escapeHtml(radarBody)}</small>
    </button>
    <button class="briefCard queue" type="button" data-brief-action="queue">
      <span>Handoff</span>
      <strong>${openItems.length} open</strong>
      <small>For hosts: ${escapeHtml(queueMix)}</small>
    </button>
  `;
}

function renderRadar() {
  const rows = computeRadar();
  const list = $("radarList");
  const active = rows.find((item) => item.term === state.focusTerm) || rows[0] || null;
  const activeSegment = currentSegmentName();
  const segmentHits = rows.filter((item) => item.inCurrentSegment).length;
  $("radarSummary").textContent = rows.length ? `${activeSegment} lens · ${segmentHits}/${rows.length} segment-fit terms` : "No watchlist heat yet";
  if (!rows.length) {
    list.innerHTML = `<div class="emptyState compact">No watchlist terms are active in the recent feed.</div>`;
    $("focusBrief").innerHTML = `<div class="emptyState compact">Select a radar item when signals appear.</div>`;
    $("copyFocusBtn").disabled = true;
    renderProducerAssist();
    renderOperatorBrief();
    return;
  }
  list.innerHTML = rows
    .map(
      (item) => `
        <button class="radarItem${item.term === state.focusTerm ? " active" : ""}${item.inCurrentSegment ? " segmentFit" : ""}" type="button" data-term="${escapeHtml(item.term)}">
          <span>
            <strong>${escapeHtml(item.term)}</strong>
            <small>${item.inCurrentSegment ? `<em class="segmentFitBadge">Now</em> ` : ""}${escapeHtml(item.segment)} · ${item.usable} usable · ${escapeHtml(formatSources(item.sourceCounts))}</small>
          </span>
          <span class="radarCounts">
            <b>${item.count}</b>
            <em>${item.usable} use</em>
          </span>
        </button>
      `
    )
    .join("");
  const briefItem = state.focusTerm ? rows.find((item) => item.term === state.focusTerm) : active;
  $("focusBrief").innerHTML = briefItem
    ? `
      <div class="focusTitle">${escapeHtml(briefItem.term)} · ${escapeHtml(briefItem.segment)}${briefItem.inCurrentSegment ? " · Now" : ""}</div>
      <p>${escapeHtml(suggestedPrompt(briefItem.term, briefItem))}</p>
      <div class="focusMeta">${escapeHtml(briefItem.count)} recent · ${escapeHtml(briefItem.usable)} usable · ${escapeHtml(briefItem.high)} high-signal · ${escapeHtml(formatSources(briefItem.sourceCounts))}</div>
      ${briefItem.sample ? `<blockquote>${escapeHtml(briefItem.sample.displayName || "unknown")}: ${escapeHtml(briefItem.sample.text)}</blockquote>` : ""}
    `
    : `<div class="emptyState compact">Select a radar item when signals appear.</div>`;
  $("copyFocusBtn").disabled = !briefItem;
  renderProducerAssist();
  renderOperatorBrief();
}

function queueKindLabel(kind) {
  return {
    question: "On-air question",
    signal: "Market beat",
    clip: "Clip candidate",
  }[kind] || "Queued";
}

function filteredQueueItems() {
  const items = state.producerQueue || [];
  const filtered = state.queueFilter === "open"
    ? items.filter((item) => !item.done)
    : state.queueFilter === "done"
      ? items.filter((item) => item.done)
      : items.filter((item) => !item.done && item.kind === state.queueFilter);
  const activeSegment = currentSegmentName();
  return [...filtered].sort((a, b) => {
    const aCurrent = segmentForMessage(a) === activeSegment ? 2 : topicSegmentForMessage(a) === activeSegment ? 1 : 0;
    const bCurrent = segmentForMessage(b) === activeSegment ? 2 : topicSegmentForMessage(b) === activeSegment ? 1 : 0;
    return (bCurrent - aCurrent) || (queueTimeMs(b) - queueTimeMs(a));
  });
}

function renderProducerQueue() {
  const node = $("producerQueue");
  const items = filteredQueueItems();
  const open = (state.producerQueue || []).filter((item) => !item.done).length;
  const done = (state.producerQueue || []).filter((item) => item.done).length;
  const activeSegment = currentSegmentName();
  const segmentOpen = (state.producerQueue || []).filter((item) => !item.done && segmentForMessage(item) === activeSegment).length;
  const topicFitOpen = (state.producerQueue || []).filter((item) => !item.done && segmentForMessage(item) !== activeSegment && topicSegmentForMessage(item) === activeSegment).length;
  $("queueSummary").textContent = `${open} open · ${segmentOpen} queued for ${activeSegment}${topicFitOpen ? ` · ${topicFitOpen} topic-fit parked` : ""} · ${done} done`;
  if (!items.length) {
    node.innerHTML = `<div class="emptyState compact">No ${state.queueFilter === "open" ? "open" : state.queueFilter} items.</div>`;
    renderProducerAssist();
    renderOperatorBrief();
    return;
  }
  node.innerHTML = items
    .slice(0, 18)
    .map(
      (item) => {
        const segment = segmentForMessage(item);
        const topicSegment = topicSegmentForMessage(item);
        const topicMismatch = topicSegment && topicSegment !== segment;
        return `
        <article class="queueItem ${item.source}${item.done ? " done" : ""}${segment === activeSegment ? " segmentCurrent" : ""}${topicSegment === activeSegment && segment !== activeSegment ? " topicCurrent" : ""}">
          <div class="queueTop">
            <span class="queueKind">${escapeHtml(queueKindLabel(item.kind))}${item.priority === "high" ? " · High signal" : ""}</span>
            <div class="queueActions">
              ${!item.done && segment !== activeSegment ? `<button class="queueButton" type="button" data-queue-action="use-now" data-queue-id="${item.id}">Use Now</button>` : ""}
              ${!item.done && topicMismatch ? `<button class="queueButton" type="button" data-queue-action="park-topic" data-queue-id="${item.id}">Park Topic</button>` : ""}
              <button class="queueButton" type="button" data-queue-action="done" data-queue-id="${item.id}">${item.done ? "Reopen" : "Done"}</button>
              <button class="queueButton" type="button" data-queue-action="copy" data-queue-id="${item.id}">Copy</button>
              <button class="queueRemove" type="button" data-queue-action="remove" data-queue-id="${item.id}" aria-label="Remove queued item"></button>
            </div>
          </div>
          <strong>${escapeHtml(item.displayName || "unknown")}</strong>
          <p>${escapeHtml(item.text)}</p>
          <div class="queueSegment">${segment === activeSegment ? "Now" : "Park"} · ${escapeHtml(segment)}</div>
          ${topicMismatch ? `<div class="queueTopic">Topic · ${escapeHtml(topicSegment)}</div>` : ""}
          ${(item.matchedTerms || []).length ? `<div class="queueTerms">${item.matchedTerms.map((term) => `<span>${escapeHtml(term)}</span>`).join("")}</div>` : ""}
          <div class="queueMeta">${escapeHtml(item.sourceLabel || item.source)}${item.channel ? ` · #${escapeHtml(item.channel)}` : ""} · ${escapeHtml(formatTime(item.createdAt))}</div>
        </article>
      `;
      }
    )
    .join("");
  renderProducerAssist();
  renderOperatorBrief();
}

function updateMetrics(payload) {
  if (payload) state.metrics = payload;
  const open = (state.producerQueue || []).filter((item) => !item.done).length;
  const done = (state.producerQueue || []).filter((item) => item.done).length;
  $("visibleCount").textContent = Number.isFinite(state.visibleCount) ? state.visibleCount : state.messages.filter(passesFilters).length;
  $("queuedCount").textContent = open;
  $("doneCount").textContent = done;
  $("clientCount").textContent = `${state.metrics.clients || 0} viewer${state.metrics.clients === 1 ? "" : "s"}`;
  renderActiveFilterBar();
  updateConnectionLight();
}

function updateConnectionLight() {
  const light = $("connectionLight");
  const pending = state.queue.length;
  const sourceValues = Object.values(state.sources || {});
  const connectedSources = sourceValues.filter((source) => source.status === "connected").length;
  const demoSources = sourceValues.filter((source) => source.status === "demo").length;
  const activeSources = connectedSources + demoSources;
  light.classList.toggle("live", connectedSources > 0);
  light.classList.toggle("demo", connectedSources === 0 && demoSources > 0);
  if (state.paused) {
    light.textContent = pending ? `Paused · ${pending} queued` : "Paused";
  } else if (connectedSources > 0) {
    light.textContent = "Live";
  } else if (demoSources > 0) {
    light.textContent = "Demo";
  } else if (activeSources > 0) {
    light.textContent = "Connected";
  } else {
    light.textContent = "Connecting";
  }
}

function renderActiveFilterBar() {
  const type = state.intentFilter === "all" ? "All message types" : state.intentFilter === "high" ? "High signal" : intentLabel(state.intentFilter);
  const scopedMessages = state.messages.filter((message) =>
    state.filters.has(message.source) &&
    (!state.segmentLens || segmentForMessage(message) === currentSegmentName())
  );
  const highCount = scopedMessages.filter((message) => message.priority === "high").length;
  const useNow = scopedMessages.filter((message) => decisionForMessage(message).status === "use").length;
  const parts = [
    currentSegmentName(),
    `${state.visibleCount || scopedMessages.length} visible`,
    `${useNow} use now`,
    `${highCount} high`,
  ];
  if (state.decisionFilter !== "all") parts.push(state.decisionFilter);
  if (state.intentFilter !== "all") parts.push(type);
  if (state.segmentLens) parts.push("lens on");
  if (state.query.trim()) parts.push(`search: ${state.query.trim()}`);
  if (state.focusTerm) parts.push(`focus: ${state.focusTerm}`);
  $("activeFilterBar").textContent = parts.join(" · ");
}

function applySnapshot(payload) {
  state.messages = Array.isArray(payload.history) ? payload.history : [];
  state.sources = payload.sources || {};
  state.config = payload.config || {};
  state.showState = payload.showState || state.showState;
  state.producerQueue = payload.producerQueue || [];
  state.metrics = payload.metrics || state.metrics;
  renderConfig();
  renderRadar();
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
    state.showState = payload.showState || state.showState;
    state.producerQueue = payload.producerQueue || state.producerQueue;
    state.metrics = payload.metrics || state.metrics;
    renderConfig();
    renderRadar();
    renderProducerQueue();
    renderSources();
    updateMetrics(state.metrics);
  });
  events.addEventListener("queue", (event) => {
    const payload = JSON.parse(event.data);
    state.producerQueue = payload.producerQueue || [];
    state.metrics = payload.metrics || state.metrics;
    renderProducerQueue();
    renderFeed();
    updateMetrics(state.metrics);
  });
  events.addEventListener("show-state", (event) => {
    const payload = JSON.parse(event.data);
    state.showState = payload.showState || state.showState;
    state.config = payload.config || state.config;
    state.producerQueue = payload.producerQueue || state.producerQueue;
    state.metrics = payload.metrics || state.metrics;
    renderConfig();
    renderRadar();
    renderProducerQueue();
    renderFeed();
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
  const message = getMessageById(messageId);
  return postJson("/api/queue/add", {
    messageId,
    kind,
    segment: currentSegmentName(),
    message: message ? {
      id: message.id,
      source: message.source,
      sourceLabel: message.sourceLabel,
      channel: message.channel,
      user: message.user,
      displayName: message.displayName,
      text: message.text,
      createdAt: message.createdAt,
      receivedAt: message.receivedAt,
      intent: message.intent,
      priority: message.priority,
      matchedTerms: message.matchedTerms || [],
      signalScore: message.signalScore || 0,
      operator: message.operator || null,
      segment: message.segment,
      topicSegment: topicSegmentForMessage(message),
    } : null,
  });
}

function kindForMessage(message) {
  return smartKindForMessage(message);
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

function formatEpisodeBrief() {
  const episode = state.config.latestEpisode || {};
  if (!episode.title) return "No latest-show rehearsal configured.";
  const segments = (episode.segments || [])
    .map((item, index) => `${index + 1}. ${item.segment}: ${item.beat}\n   Producer goal: ${item.producerGoal}`)
    .join("\n");
  return [
    `Market Bubble latest-show rehearsal: ${episode.title}`,
    `Air date: ${episode.airDate || "Latest Thursday show"}`,
    `Source note: ${episode.sourceNote || "Public show context."}`,
    "",
    `Desk thesis: ${episode.thesis || "Use the desk to route live audience flow into the right segment."}`,
    "",
    "Segment beats",
    segments || "No segment beats configured.",
    "",
    `Watch terms: ${(episode.watchTerms || []).join(", ") || "None configured."}`,
    "",
    "Operator flow: Run Rehearsal, watch Signal Radar, queue the best ask/signal/clip, then Copy Rundown for host handoff.",
  ].join("\n");
}

function formatQueueItem(item) {
  const segment = segmentForMessage(item);
  const topicSegment = topicSegmentForMessage(item);
  const topicNote = topicSegment && topicSegment !== segment ? ` · Topic ${topicSegment}` : "";
  return `[${segment} · ${queueKindLabel(item.kind)}${topicNote} · ${item.sourceLabel || item.source}${item.channel ? ` #${item.channel}` : ""}] ${item.displayName || "unknown"}: ${item.text}`;
}

function formatRundown() {
  const openItems = (state.producerQueue || []).filter((item) => !item.done);
  if (!openItems.length) return "Market Bubble Live Desk rundown: no open queued items.";
  const kinds = [
    ["question", "On-air Questions"],
    ["signal", "Market Signals"],
    ["clip", "Clip Candidates"],
  ];
  const activeSegment = currentSegmentName();
  const configured = segmentNames();
  const present = [...new Set(openItems.map(segmentForMessage))];
  const orderedSegments = [
    activeSegment,
    ...configured.filter((segment) => segment !== activeSegment),
    ...present.filter((segment) => !configured.includes(segment)),
  ].filter((segment, index, list) => present.includes(segment) && list.indexOf(segment) === index);
  const sections = orderedSegments
    .map((segment) => {
      const segmentItems = openItems.filter((item) => segmentForMessage(item) === segment);
      const blocks = kinds
        .map(([kind, label]) => {
          const items = segmentItems.filter((item) => item.kind === kind);
          if (!items.length) return "";
          return `${label}\n${items.map((item, index) => `${index + 1}. ${formatQueueItem(item)}`).join("\n")}`;
        })
        .filter(Boolean)
        .join("\n\n");
      return blocks ? `${segment}${segment === activeSegment ? " (now)" : ""}\n${blocks}` : "";
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
  return [`Market Bubble Live Desk rundown`, `Current segment: ${activeSegment}`, "", sections].join("\n");
}

function formatSegmentBrief() {
  const activeSegment = currentSegmentName();
  const openItems = openQueueItems();
  const nowItems = openItems.filter((item) => segmentForMessage(item) === activeSegment);
  const parkedTopicFit = openItems.filter((item) => segmentForMessage(item) !== activeSegment && topicSegmentForMessage(item) === activeSegment);
  const radar = topRadarForSegment();
  const move = producerNextMove();
  const outcome = assistOutcomeForMove(move);
  const counts = queueKindCounts(nowItems);
  const queueLines = nowItems.slice(0, 5).map((item, index) => `${index + 1}. ${formatQueueItem(item)}`);
  const parkedLines = parkedTopicFit.slice(0, 3).map((item, index) => `${index + 1}. ${formatQueueItem(item)}`);

  return [
    "Market Bubble segment brief",
    `Current segment: ${activeSegment}`,
    `Next move: ${move.label} - ${move.body}`,
    `Can become: ${outcome.label} - ${outcome.detail}`,
    `Why: ${move.detail}`,
    radar
      ? `Radar: ${radar.term} · ${radar.count} recent · ${radar.usable || 0} usable · ${radar.high} high-signal · ${radar.segment}`
      : "Radar: no active watchlist heat",
    `Queue now: ${nowItems.length} open · ${counts.question || 0} questions · ${counts.signal || 0} signals · ${counts.clip || 0} clips`,
    `Source health: ${sourceSummary()}`,
    "",
    nowItems.length ? `Queued for ${activeSegment}\n${queueLines.join("\n")}` : `Queued for ${activeSegment}\nNone yet.`,
    parkedLines.length ? `\nParked but topic-fit for ${activeSegment}\n${parkedLines.join("\n")}` : "",
  ].filter((line) => line !== "").join("\n");
}

function activateUseNowView() {
  state.intentFilter = "all";
  state.decisionFilter = "use";
  state.segmentLens = true;
  state.focusTerm = "";
  state.query = "";
  $("searchInput").value = "";
  $("segmentLensBtn").classList.add("active");
  document.querySelectorAll(".viewToggle").forEach((item) => {
    item.classList.toggle("active", item.dataset.intent === "all");
  });
  renderRadar();
  renderFeed();
  renderProducerQueue();
  updateMetrics();
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

  $("segmentLensBtn").addEventListener("click", () => {
    state.segmentLens = !state.segmentLens;
    $("segmentLensBtn").classList.toggle("active", state.segmentLens);
    renderRadar();
    renderFeed();
    renderProducerQueue();
    updateMetrics();
  });

  $("triageModeBtn").addEventListener("click", () => {
    activateUseNowView();
  });

  $("copySegmentBriefBtn").addEventListener("click", async () => {
    await copyText(formatSegmentBrief());
    $("copySegmentBriefBtn").textContent = "Copied";
    setTimeout(() => {
      $("copySegmentBriefBtn").textContent = "Copy Segment Brief";
    }, 900);
  });

  $("runRehearsalBtn").addEventListener("click", async () => {
    const button = $("runRehearsalBtn");
    button.disabled = true;
    button.textContent = "Running";
    state.autoScroll = true;
    state.segmentLens = false;
    state.intentFilter = "all";
    state.decisionFilter = "all";
    state.focusTerm = "";
    state.query = "";
    state.filters = new Set(["kick", "x", "twitch"]);
    $("searchInput").value = "";
    $("autoScrollBtn").classList.add("active");
    $("segmentLensBtn").classList.remove("active");
    document.querySelectorAll(".sourceToggle").forEach((item) => {
      item.classList.add("active");
    });
    document.querySelectorAll(".viewToggle").forEach((item) => {
      item.classList.toggle("active", item.dataset.intent === "all");
    });
    renderRadar();
    renderFeed();
    updateMetrics();
    try {
      await postJson("/api/rehearsal/latest-show");
      button.textContent = "Live";
    } catch (error) {
      button.textContent = "Failed";
    }
    setTimeout(() => {
      button.disabled = false;
      button.textContent = "Run Rehearsal";
    }, 1600);
  });

  $("copyEpisodeBriefBtn").addEventListener("click", async () => {
    await copyText(formatEpisodeBrief());
    $("copyEpisodeBriefBtn").textContent = "Copied";
    setTimeout(() => {
      $("copyEpisodeBriefBtn").textContent = "Copy Episode Brief";
    }, 900);
  });

  $("editSegmentsBtn").addEventListener("click", () => {
    if (state.segmentEditorOpen) closeSegmentEditor();
    else openSegmentEditor();
  });

  $("cancelSegmentsBtn").addEventListener("click", () => {
    closeSegmentEditor();
  });

  $("addSegmentBtn").addEventListener("click", () => {
    syncSegmentDraftFromForm();
    const draft = state.segmentDraft || [];
    if (draft.length >= 8) return;
    draft.push({
      name: `Segment ${draft.length + 1}`,
      brief: "What this segment is for.",
      keywords: [],
    });
    state.segmentDraft = draft;
    renderSegmentEditorRows();
  });

  $("resetSegmentsBtn").addEventListener("click", async () => {
    const button = $("resetSegmentsBtn");
    button.disabled = true;
    button.textContent = "Resetting";
    try {
      const payload = await postJson("/api/segments/reset");
      state.config = payload.config || state.config;
      state.showState = payload.showState || state.showState;
      state.producerQueue = payload.producerQueue || state.producerQueue;
      state.segmentEditorOpen = false;
      state.segmentDraft = null;
      renderConfig();
      renderRadar();
      renderFeed();
      renderProducerQueue();
      updateMetrics();
    } catch (error) {
      button.textContent = "Failed";
    }
    setTimeout(() => {
      button.disabled = false;
      button.textContent = "Reset Defaults";
    }, 900);
  });

  $("segmentEditorRows").addEventListener("input", syncSegmentDraftFromForm);

  $("segmentEditorRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-segment-action='remove']");
    if (!button) return;
    syncSegmentDraftFromForm();
    const index = Number(button.closest(".segmentEditRow")?.dataset.index || -1);
    const draft = state.segmentDraft || [];
    if (draft.length <= 1 || index < 0) return;
    draft.splice(index, 1);
    state.segmentDraft = draft;
    renderSegmentEditorRows();
  });

  $("segmentEditor").addEventListener("submit", async (event) => {
    event.preventDefault();
    syncSegmentDraftFromForm();
    const segments = sanitizedSegmentDraft();
    const button = $("saveSegmentsBtn");
    if (!segments.length) {
      button.textContent = "Need 1+";
      setTimeout(() => {
        button.textContent = "Save Segments";
      }, 900);
      return;
    }
    button.disabled = true;
    button.textContent = "Saving";
    try {
      const payload = await postJson("/api/segments/update", { segments });
      state.config = payload.config || state.config;
      state.showState = payload.showState || state.showState;
      state.producerQueue = payload.producerQueue || state.producerQueue;
      state.segmentEditorOpen = false;
      state.segmentDraft = null;
      renderConfig();
      renderRadar();
      renderFeed();
      renderProducerQueue();
      updateMetrics();
      button.textContent = "Saved";
    } catch (error) {
      button.textContent = "Failed";
    }
    setTimeout(() => {
      button.disabled = false;
      button.textContent = "Save Segments";
    }, 900);
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

  $("contextRail").addEventListener("click", async (event) => {
    const button = event.target.closest(".segmentButton");
    if (!button) return;
    const currentSegment = button.dataset.segment || "";
    state.showState = { ...state.showState, currentSegment };
    renderConfig();
    renderRadar();
    renderProducerQueue();
    renderFeed();
    updateMetrics();
    try {
      await postJson("/api/show-state/update", { currentSegment });
    } catch (error) {
      button.textContent = "Failed";
      setTimeout(renderConfig, 900);
    }
  });

  $("radarList").addEventListener("click", (event) => {
    const item = event.target.closest(".radarItem");
    if (!item) return;
    state.focusTerm = item.dataset.term || "";
    state.query = "";
    $("searchInput").value = "";
    renderRadar();
    renderFeed();
  });

  $("resetFocusBtn").addEventListener("click", () => {
    state.focusTerm = "";
    state.query = "";
    $("searchInput").value = "";
    renderRadar();
    renderFeed();
  });

  $("copyFocusBtn").addEventListener("click", async () => {
    const item = state.radar.find((row) => row.term === state.focusTerm) || state.radar[0];
    await copyText(formatFocusBrief(item));
    $("copyFocusBtn").textContent = "Copied";
    setTimeout(() => {
      $("copyFocusBtn").textContent = "Copy Focus Brief";
    }, 900);
  });

  $("copyRundownBtn").addEventListener("click", async () => {
    await copyText(formatRundown());
    $("copyRundownBtn").textContent = "Copied";
    setTimeout(() => {
      $("copyRundownBtn").textContent = "Copy Rundown";
    }, 900);
  });

  $("decisionBar").addEventListener("click", (event) => {
    const button = event.target.closest(".decisionFilter");
    if (!button) return;
    state.decisionFilter = button.dataset.decision || "all";
    renderFeed();
    updateMetrics();
  });

  $("operatorBrief").addEventListener("click", (event) => {
    const card = event.target.closest(".briefCard");
    if (!card) return;
    const action = card.dataset.briefAction;
    if (action === "use") {
      activateUseNowView();
      const feedReady = Number(card.dataset.feedReady || 0);
      const queueReady = Number(card.dataset.queueReady || 0);
      const target = feedReady > 0 || queueReady === 0 ? $("feed") : document.querySelector(".queueBlock");
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    if (action === "radar") {
      const term = card.dataset.term || topRadarForSegment()?.term || "";
      if (term) {
        state.focusTerm = term;
        state.decisionFilter = "all";
        state.segmentLens = false;
        state.query = "";
        $("searchInput").value = "";
        $("segmentLensBtn").classList.remove("active");
        renderRadar();
        renderFeed();
      }
      document.querySelector(".radarBlock")?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    if (action === "queue") {
      document.querySelector(".queueBlock")?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    if (action === "segment") {
      $("contextRail")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  });

  $("feed").addEventListener("click", async (event) => {
    const button = event.target.closest(".messageAction");
    if (!button) return;
    const message = getMessageById(button.dataset.id);
    if (!message) return;
    const action = button.dataset.action;
    if (action === "smart") {
      try {
        await queueMessage(message.id, kindForMessage(message));
        button.textContent = "Queued";
      } catch (error) {
        button.textContent = "Failed";
      }
      setTimeout(() => {
        button.textContent = "Queue";
      }, 900);
      return;
    }
    if (["question", "signal", "clip"].includes(action)) {
      try {
        await queueMessage(message.id, action);
        button.textContent = "Queued";
      } catch (error) {
        button.textContent = "Failed";
      }
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
    if (button.dataset.queueAction === "use-now") {
      item.segment = currentSegmentName();
      renderProducerQueue();
      updateMetrics();
      await postJson("/api/queue/update", { queueId, segment: item.segment });
      return;
    }
    if (button.dataset.queueAction === "park-topic") {
      item.segment = topicSegmentForMessage(item);
      renderProducerQueue();
      updateMetrics();
      await postJson("/api/queue/update", { queueId, segment: item.segment });
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
    if (state.query.trim()) state.focusTerm = "";
    renderRadar();
    renderFeed();
  });

  if ($("testForm")) {
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
}

bindControls();
connectEvents();
setInterval(() => {
  renderRadar();
  renderSources();
  updateMetrics();
}, 30000);
