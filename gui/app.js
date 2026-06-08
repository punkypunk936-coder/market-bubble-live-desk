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
  segmentLens: false,
  metrics: { counts: {}, total: 0, clients: 0 },
  sources: {},
  producerQueue: [],
  config: {},
  showState: { currentSegment: "" },
  visibleCount: 0,
  focusTerm: "",
  radar: [],
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

function passesFilters(message) {
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

function operatorCueForMessage(message) {
  const segment = segmentForMessage(message);
  const terms = (message.matchedTerms || []).slice(0, 3).join(", ");
  if (message.intent === "question") return `${segment} ask${terms ? ` · ${terms}` : ""}`;
  if (message.intent === "clip") return `${segment} clip candidate${terms ? ` · ${terms}` : ""}`;
  if (message.intent === "culture") return `${segment} context${terms ? ` · ${terms}` : ""}`;
  if (message.intent === "market") return `${segment} market signal${terms ? ` · ${terms}` : ""}`;
  return `${segment} watch item${terms ? ` · ${terms}` : ""}`;
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
  const segment = template.querySelector(".segmentPill");
  const matchTerms = template.querySelector(".matchTerms");
  const text = template.querySelector(".messageText");
  const cue = template.querySelector(".messageCue");
  const time = template.querySelector(".messageTime");
  const actions = template.querySelectorAll(".messageAction");

  row.classList.add(message.source);
  row.classList.add(`priority-${message.priority || "normal"}`);
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
  segment.textContent = segmentForMessage(message);
  matchTerms.textContent = (message.matchedTerms || []).join(", ");
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
      const lastAge = relativeAge(item.lastMessageAt);
      const isStale = item.lastMessageAt && Date.now() - new Date(item.lastMessageAt).getTime() > 120000;
      return `
        <div class="statusItem ${source}${isStale ? " stale" : ""}">
          <div class="statusTop">
            <span class="statusName">${sourceNames[source]}</span>
            <span class="statusPill">${status}</span>
          </div>
          <div class="statusDetail">${detail}</div>
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
  $("contextRail").innerHTML = `${segmentControls}<div class="contextChips">${contextChips}</div>`;
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
  renderEpisodeBrief();
  renderWorkflowFit();
  renderPreviousEpisodes();
}

function segmentForTerm(term, sample) {
  const value = `${term || ""} ${sample?.text || ""}`.toLowerCase();
  if (/\b(nba|nfl|mlb|ufc|sports|spread|line|game|match|baseball|bullpen)\b/.test(value)) return "Pick n' Roll";
  if (/\b(60k|liquidation|liquidations|funding|open interest|oi|support|resistance|wick|breakdown|breakout|mispriced|probability|odds|polymarket|zcash|zec|bitcoin|btc)\b/.test(value)) return "The Price Is Wrong";
  if (/\b(ai|agents|compute|near|eth|solana|sol|hyperliquid|hype|crypto|ethereum|frontier)\b/.test(value)) return "Future-Proof";
  if (/\b(gta|culture|viral|creator|banks|stream|twitter|x|timeline|attention)\b/.test(value)) return "Culture Shock";
  return "The Price Is Wrong";
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
  if (segment === "Culture Shock") return `Ask whether ${term} is a real attention market or just timeline noise.`;
  if (segment === "Pick n' Roll") return `Ask what number would make ${term} mispriced enough to take seriously.`;
  if (segment === "Future-Proof") return `Ask how ${term} changes the long-term market structure or trade setup.`;
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
        radarScore: high * 5 + hits.length * 3 + Math.min(allHits.length, 8) + (inCurrentSegment ? 6 : 0),
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
    `Recent heat: ${item.count} mentions in the last 10 minutes, ${item.high} high-signal.`,
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

function sourceSummary() {
  return ["kick", "x", "twitch"]
    .map((source) => {
      const item = state.sources?.[source] || {};
      const status = item.status || "idle";
      return `${sourceNames[source]} ${status}${item.lastMessageAt ? `, last ${relativeAge(item.lastMessageAt)}` : ""}`;
    })
    .join("; ");
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
    return {
      label: "Ask this next",
      body: `${topQuestion.displayName || "unknown"}: ${topQuestion.text}`,
      detail: `${activeSegment} question already queued.`,
    };
  }
  if (topSignal) {
    return {
      label: "Bring this market beat up",
      body: `${topSignal.displayName || "unknown"}: ${topSignal.text}`,
      detail: `${activeSegment} signal is ready for host handoff.`,
    };
  }
  if (topClip) {
    return {
      label: "Mark this for clipping",
      body: `${topClip.displayName || "unknown"}: ${topClip.text}`,
      detail: `${activeSegment} clip candidate is waiting.`,
    };
  }
  if (radar && radar.inCurrentSegment) {
    return {
      label: `Watch ${radar.term}`,
      body: suggestedPrompt(radar.term, radar),
      detail: `${radar.count} recent mentions across ${formatSources(radar.sourceCounts)}.`,
    };
  }
  if (radar) {
    return {
      label: `Park ${radar.term}`,
      body: suggestedPrompt(radar.term, radar),
      detail: `Topic fits ${radar.segment}; current segment is ${activeSegment}.`,
    };
  }
  return {
    label: "Keep monitoring",
    body: "No clear segment signal yet. Stay in all-feed mode until radar or queue pressure builds.",
    detail: "Sources are connected when the status cards show live or demo.",
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

  $("assistSubhead").textContent = `${activeSegment} · ${openItems.length} open`;
  $("assistNowCount").textContent = nowItems.length;
  $("assistParkedCount").textContent = parkedTopicFit.length;
  $("assistHeatCount").textContent = heatCount;
  $("nextMove").innerHTML = `
    <div class="nextMoveLabel">${escapeHtml(move.label)}</div>
    <p>${escapeHtml(move.body)}</p>
    <div class="nextMoveMeta">${escapeHtml(move.detail)}${nowItems.length ? ` · ${counts.question || 0} ask / ${counts.signal || 0} signal / ${counts.clip || 0} clip` : ""}</div>
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
    return;
  }
  list.innerHTML = rows
    .map(
      (item) => `
        <button class="radarItem${item.term === state.focusTerm ? " active" : ""}${item.inCurrentSegment ? " segmentFit" : ""}" type="button" data-term="${escapeHtml(item.term)}">
          <span>
            <strong>${escapeHtml(item.term)}</strong>
            <small>${item.inCurrentSegment ? `<em class="segmentFitBadge">Now</em> ` : ""}${escapeHtml(item.segment)} · ${escapeHtml(formatSources(item.sourceCounts))}</small>
          </span>
          <span class="radarCounts">
            <b>${item.count}</b>
            <em>${item.high} high</em>
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
      <div class="focusMeta">${escapeHtml(briefItem.count)} recent · ${escapeHtml(briefItem.high)} high-signal · ${escapeHtml(formatSources(briefItem.sourceCounts))}</div>
      ${briefItem.sample ? `<blockquote>${escapeHtml(briefItem.sample.displayName || "unknown")}: ${escapeHtml(briefItem.sample.text)}</blockquote>` : ""}
    `
    : `<div class="emptyState compact">Select a radar item when signals appear.</div>`;
  $("copyFocusBtn").disabled = !briefItem;
  renderProducerAssist();
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
  const type = state.intentFilter === "all" ? "All message types" : state.intentFilter === "high" ? "High signal" : intentLabel(state.intentFilter);
  const scopedMessages = state.messages.filter((message) =>
    state.filters.has(message.source) &&
    (!state.segmentLens || segmentForMessage(message) === currentSegmentName())
  );
  const highCount = scopedMessages.filter((message) => message.priority === "high").length;
  const query = state.query.trim() ? `Search: "${state.query.trim()}"` : "No search";
  const focus = state.focusTerm ? `Focus: ${state.focusTerm}` : "No radar focus";
  const lens = state.segmentLens ? "Segment lens on" : "Segment lens off";
  $("activeFilterBar").textContent = `${activeSources || "No sources"} · ${type} · Segment: ${currentSegmentName()} · ${lens} · ${query} · ${focus} · ${highCount} high-signal items`;
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
  const counts = queueKindCounts(nowItems);
  const queueLines = nowItems.slice(0, 5).map((item, index) => `${index + 1}. ${formatQueueItem(item)}`);
  const parkedLines = parkedTopicFit.slice(0, 3).map((item, index) => `${index + 1}. ${formatQueueItem(item)}`);

  return [
    "Market Bubble segment brief",
    `Current segment: ${activeSegment}`,
    `Next move: ${move.label} — ${move.body}`,
    `Why: ${move.detail}`,
    radar
      ? `Radar: ${radar.term} · ${radar.count} recent · ${radar.high} high-signal · ${radar.segment}`
      : "Radar: no active watchlist heat",
    `Queue now: ${nowItems.length} open · ${counts.question || 0} questions · ${counts.signal || 0} signals · ${counts.clip || 0} clips`,
    `Source health: ${sourceSummary()}`,
    "",
    nowItems.length ? `Queued for ${activeSegment}\n${queueLines.join("\n")}` : `Queued for ${activeSegment}\nNone yet.`,
    parkedLines.length ? `\nParked but topic-fit for ${activeSegment}\n${parkedLines.join("\n")}` : "",
  ].filter((line) => line !== "").join("\n");
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
    state.intentFilter = "high";
    state.segmentLens = true;
    state.focusTerm = "";
    state.query = "";
    $("searchInput").value = "";
    $("segmentLensBtn").classList.add("active");
    document.querySelectorAll(".viewToggle").forEach((item) => {
      item.classList.toggle("active", item.dataset.intent === "high");
    });
    renderRadar();
    renderFeed();
    renderProducerQueue();
    updateMetrics();
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
setInterval(() => {
  renderRadar();
  renderSources();
  updateMetrics();
}, 30000);
