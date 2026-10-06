import {
  h,
  icon,
  logo,
  badge,
  header,
  linkButton,
  loading,
  resetCharts,
  hydrateCharts,
  actionInfo,
  policyName,
  pad,
} from "./ui.js";
import { arenaPage } from "./arena.js";
import { comparePage } from "./compare.js";
import { environmentPage } from "./environment.js";
import { trainingPage } from "./training.js";
import { guidePage } from "./guide.js";
import { connectionsPage } from "./integrations.js";
import { liveArenaPage, activeRun } from "./live.js";
import {
  syncArenaGraph,
  destroyArenaGraph,
  graphCommand,
} from "./arena-graph.js";
import {
  syncTerminals,
  focusTerminal,
  destroyTerminals,
} from "./arena-terminals.js";
import { syncArenaKanban, openTrainingSync } from "./arena-kanban.js";

const app = document.getElementById("app");
const mobileQuery = window.matchMedia("(max-width:700px)");
const state = {
  seed: 42,
  policy: "baseline",
  trainingRuns: [],
  runs: [],
  trainingId: "recorded",
  connections: null,
  episode: null,
  comparison: null,
  environment: null,
  training: null,
  liveRun: null,
  liveTarget: "local",
  liveAgent: "scripted",
  livePolicy: "guarded",
  liveSelected: 0,
  connected: false,
  config: {
    max_seed: 2147483647,
    presets: [{ seed: 42, label: "Balanced attack mix" }],
  },
  pending: {
    arena: false,
    compare: false,
    environment: false,
    training: false,
    connections: false,
    live: false,
  },
  errors: {},
  replay: { mode: "all", agent: "all", page: 0, selected: 0 },
  playback: { playing: false, speed: 1 },
  terminalsOpen: true,
  arenaPanel: null,
  compareStart: 4,
  menu: false,
  filters: Object.fromEntries(
    ["all", "customers", "invoices", "tickets", "tasks"].map((k) => [
      k,
      { search: "", filter: "", page: 0 },
    ]),
  ),
};
const navigation = [
  ["Arena", "arena", "/arena/replay", "arena"],
  ["Environment", "database", "/environment/customers", "environment", true],
  ["Compare", "compare", "/compare/replays", "compare"],
  ["Training", "training", "/training/reward", "training"],
  ["Connections", "settings", "/connections", "connections"],
  ["Guide", "book", "/guide", "guide"],
];
const defaults = {
  arena: "replay",
  compare: "replays",
  environment: "customers",
  sandbox: "replay",
  training: "reward",
};
const allowed = {
  arena: ["replay", "analytics", "rewards"],
  compare: ["replays", "analytics"],
  environment: ["customers", "invoices", "tickets"],
  sandbox: ["replay"],
  training: ["reward", "components", "kl", "length", "loss"],
  guide: [],
  connections: [],
};

function route() {
  const bits = location.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const section = bits[0] || "arena",
    view = bits[1] || defaults[section] || "";
  const valid =
    Object.hasOwn(allowed, section) &&
    bits.length <= 2 &&
    (["guide", "connections"].includes(section)
      ? !bits[1]
      : allowed[section].includes(view));
  return { section, view, valid };
}
function shell(content, current) {
  if (
    current.valid &&
    current.section === "arena" &&
    current.view === "replay"
  ) {
    return `<div class="app-shell immersive-shell"><main class="main-workspace arena-immersive" id="main-content" tabindex="-1" aria-labelledby="page-title"><h1 class="sr-only" id="page-title">Sentry Loop</h1>${content}</main></div>`;
  }
  return `<div class="app-shell"><button class="menu-backdrop ${state.menu ? "open" : ""}" data-action="close-menu" aria-label="Close navigation" tabindex="-1"></button><aside class="sidebar ${state.menu ? "open" : ""}" id="sidebar"><a class="brand" data-route href="/arena/replay" aria-label="Sentry Loop home">${logo()}<span>sentry loop</span></a><div class="workspace"><span class="workspace-icon">E</span><div><strong>Enterprise</strong><small>Sandbox workspace</small></div></div><nav aria-label="Main navigation"><div class="nav-label">WORKSPACE</div><div class="nav-links">${navigation.map(([label, glyph, path, section, nested]) => `<a data-route href="${path}" class="nav-link ${nested ? "nested" : ""} ${current.section === section ? "active" : ""}" ${current.section === section ? 'aria-current="page"' : ""}>${icon(glyph, 18)}<span>${label}</span></a>`).join("")}</div></nav><div class="sidebar-bottom"><div class="workspace-context"><div class="workspace-status"><span class="status-dot" ${!state.connected ? 'style="background:#B65364"' : ""}></span>${state.connected ? "Workspace connected" : "Connecting to workspace"}</div><p>3 agents. 3 systems.<br>One continuous learning loop.</p></div><div class="profile"><span class="avatar">SL</span><div><strong>Personal workspace</strong><small>${state.connections?.public ? "Hosted session" : "Local session"}</small></div></div></div></aside><div class="main-workspace"><div class="topbar"><div class="breadcrumb"><button class="mobile-menu" data-action="toggle-menu" aria-label="Open navigation" aria-expanded="${state.menu}" aria-controls="sidebar">${icon("menu", 19)}</button><span class="crumb-icon muted">${icon("database", 15)}</span><span class="crumb-label muted">Workspace</span><span class="crumb-icon muted">${icon("chevron", 12)}</span><span class="workspace-crumb">Enterprise sandbox</span></div><div class="topbar-meta">${badge(state.connections?.public ? "Demo workspace" : "Local workspace", "success", true)}<span class="mono muted">OpenEnv</span></div></div><main class="page" id="main-content" tabindex="-1" aria-labelledby="page-title">${content}</main></div></div>`;
}
function render({ restoreFocus = true } = {}) {
  const current = route(),
    active = document.activeElement;
  const focus =
    restoreFocus && active && app.contains(active)
      ? {
          id: active.id,
          data: { ...active.dataset },
          start: active.selectionStart,
          end: active.selectionEnd,
        }
      : null;
  resetCharts();
  let content;
  if (!current.valid)
    content =
      header("Page not found", "This view isn’t part of the workspace.") +
      `<section class="empty"><h2>Let’s get you back to the Arena.</h2>${linkButton("Open Arena", "/arena/replay", "primary", "arrow")}</section>`;
  else if (current.section === "arena")
    content = arenaPage(state, current.view);
  else if (current.section === "compare")
    content = comparePage(state, current.view);
  else if (current.section === "environment")
    content = environmentPage(state, current.view);
  else if (current.section === "sandbox")
    content = liveArenaPage(state, current.view);
  else if (current.section === "training")
    content = trainingPage(state, current.view);
  else if (current.section === "connections") content = connectionsPage(state);
  else content = guidePage(state);
  // Keep WebGL and xterm instances, camera, scroll position, and buffers alive.
  // The surrounding Paper shell can rerender without recreating their canvases.
  const showArena =
    current.valid && current.section === "arena" && current.view === "replay";
  const retainedGraph =
    showArena && document.getElementById("arena-graph-host");
  const retainedTerminals =
    showArena && document.getElementById("arena-terminals-host");
  const retainedKanban =
    showArena && document.getElementById("arena-kanban-host");
  if (showArena) {
    retainedGraph?.remove();
    retainedTerminals?.remove();
    retainedKanban?.remove();
  } else {
    destroyArenaGraph();
    destroyTerminals();
  }
  app.innerHTML = shell(content, current);
  if (retainedGraph)
    document.getElementById("arena-graph-host")?.replaceWith(retainedGraph);
  if (retainedTerminals)
    document
      .getElementById("arena-terminals-host")
      ?.replaceWith(retainedTerminals);
  if (retainedKanban)
    document
      .getElementById("arena-kanban-host")
      ?.replaceWith(retainedKanban);
  if (showArena) {
    syncArenaGraph(document.getElementById("arena-graph-host"), state, {
      onInteraction: pauseForGraphInteraction,
      onAgent: openAgentTerminal,
    });
    syncTerminals(document.getElementById("arena-terminals-host"), state);
    syncArenaKanban(document.getElementById("arena-kanban-host"), state);
  }
  const sidebar = app.querySelector(".sidebar"),
    main = app.querySelector(".main-workspace");
  if (sidebar) {
    sidebar.inert = mobileQuery.matches && !state.menu;
    if (sidebar.inert) sidebar.setAttribute("aria-hidden", "true");
  }
  main.inert = !showArena && mobileQuery.matches && state.menu;
  document.title = `${current.valid ? current.section[0].toUpperCase() + current.section.slice(1) : "Page not found"} · Sentry Loop`;
  hydrateCharts(app);
  // Keep bookmarked tabs visible on narrow screens without scrolling the page.
  const tabList = app.querySelector(".tab-list"),
    activeTab = tabList?.querySelector(".active");
  if (activeTab && tabList.scrollWidth > tabList.clientWidth) {
    const tab = activeTab.getBoundingClientRect(),
      list = tabList.getBoundingClientRect();
    if (tab.right > list.right) tabList.scrollLeft += tab.right - list.right;
    if (tab.left < list.left) tabList.scrollLeft -= list.left - tab.left;
  }
  if (focus) {
    const element = focus.id
      ? document.getElementById(focus.id)
      : focus.data.action
        ? [...app.querySelectorAll("[data-action]")].find((el) =>
            Object.entries(focus.data).every(
              ([key, value]) => el.dataset[key] === value,
            ),
          )
        : null;
    if (element) {
      element.focus({ preventScroll: true });
      try {
        element.setSelectionRange(focus.start, focus.end);
      } catch {
        /* Number inputs do not expose a selection range. */
      }
    }
  }
}
function announce(message) {
  document.getElementById("announcer").textContent = message;
}
async function api(path, body) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(path, {
      signal: controller.signal,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(sessionStorage.getItem("sentry-control-token")
          ? { "X-Sentry-Token": sessionStorage.getItem("sentry-control-token") }
          : {}),
      },
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        typeof result.detail === "string"
          ? result.detail
          : "The request could not be completed. Check the seed and try again.",
      );
    state.connected = true;
    return result;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error("The request took too long. Please retry.");
    if (error instanceof TypeError) {
      state.connected = false;
      throw new Error(
        "The app server is unavailable. Start the app and try again.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function readSeed() {
  const input = document.getElementById("seed-input");
  const raw = input ? input.value : String(state.seed),
    seed = Number(raw);
  const valid =
    raw.trim() !== "" &&
    Number.isSafeInteger(seed) &&
    seed >= 0 &&
    seed <= state.config.max_seed;
  if (input) {
    input.setCustomValidity(
      valid
        ? ""
        : `Choose a whole-number seed from 0 to ${state.config.max_seed}.`,
    );
    if (!input.reportValidity()) return null;
  }
  if (!valid) {
    announce(`Choose a whole-number seed from 0 to ${state.config.max_seed}.`);
    return null;
  }
  state.seed = seed;
  return seed;
}
async function runEpisode() {
  if (state.pending.arena) return;
  const seed = readSeed();
  if (seed === null) return;
  const policy = state.policy;
  let completed = false;
  pausePlayback();
  state.arenaPanel = null;
  state.pending.arena = true;
  delete state.errors.arena;
  render();
  try {
    const [episode, environment] = await Promise.all([
      api("/api/episodes", { seed, policy }),
      state.environment?.seed === seed
        ? Promise.resolve(state.environment)
        : api(`/api/environment?seed=${seed}`),
    ]);
    state.episode = episode;
    state.environment = environment;
    state.replay = {
      mode: "all",
      agent: "all",
      page: 0,
      selected: 0,
    };
    completed = true;
    announce(
      `Episode complete. Seed ${seed}, ${policyName(policy)} policy, worker reward ${state.episode.scores.worker}.`,
    );
  } catch (error) {
    state.errors.arena = error.message;
    announce(error.message);
  } finally {
    state.pending.arena = false;
    render();
    if (
      completed &&
      route().section === "arena" &&
      route().view === "replay" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      togglePlayback();
  }
}

// Playback only reads the completed engine log. It never generates actions.
let replayTimer;
function pausePlayback() {
  clearTimeout(replayTimer);
  state.playback.playing = false;
}
function pauseForGraphInteraction() {
  pausePlayback();
  graphCommand("graph-pause");
  syncTerminals(document.getElementById("arena-terminals-host"), state);
  // Avoid replacing a canvas in the middle of a pointer drag.
  const stage = document.getElementById("arena-stage");
  stage?.classList.remove("is-playing");
  const control = stage?.querySelector('[data-action="arena-play"]');
  if (control)
    control.innerHTML = `${icon("play", 15)}<span>Play replay</span>`;
  const status = stage?.querySelector(".arena-stage-status");
  if (status && state.episode) status.innerHTML = "<i></i>Episode replay";
}
function openAgentTerminal(role) {
  pausePlayback();
  state.terminalsOpen = true;
  render();
  focusTerminal(role);
  if (document.querySelector(".arena-immersive")) return;
  document.getElementById("arena-terminals")?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "nearest",
  });
}

function seekReplay(index) {
  const log = state.episode?.log;
  if (!log?.length) return;
  state.replay.selected = Math.max(0, Math.min(log.length - 1, index));
  state.replay.mode = "all";
  state.replay.agent = "all";
  state.replay.page = Math.floor(state.replay.selected / 12);
}
function advanceReplay() {
  if (!state.playback.playing) return;
  replayTimer = setTimeout(() => {
    if (!state.playback.playing) return;
    seekReplay(state.replay.selected + 1);
    if (state.replay.selected === state.episode.log.length - 1) {
      pausePlayback();
      announce(
        "Replay finished. All 90 original agent actions are available in the action log.",
      );
    }
    render();
    advanceReplay();
  }, 800 / state.playback.speed);
}
function togglePlayback() {
  if (!state.episode) return;
  if (state.playback.playing) pausePlayback();
  else {
    if (state.replay.selected === state.episode.log.length - 1) seekReplay(0);
    else seekReplay(state.replay.selected);
    state.playback.playing = true;
    advanceReplay();
  }
  render();
}
async function runComparison() {
  if (state.pending.compare) return;
  const seed = readSeed();
  if (seed === null) return;
  state.pending.compare = true;
  delete state.errors.compare;
  render();
  try {
    state.comparison = await api("/api/comparisons", { seed });
    state.compareStart = 4;
    announce(`Comparison complete for seed ${seed}.`);
  } catch (error) {
    state.errors.compare = error.message;
    announce(error.message);
  } finally {
    state.pending.compare = false;
    render();
  }
}
async function inspectSeed() {
  if (state.pending.environment) return;
  const seed = readSeed();
  if (seed === null) return;
  state.pending.environment = true;
  delete state.errors.environment;
  render();
  try {
    state.environment = await api(`/api/environment?seed=${seed}`);
    for (const f of Object.values(state.filters)) {
      f.page = 0;
    }
    announce(
      `Loaded the ${state.environment.scope === "after_run" ? "resulting" : "starting"} environment for seed ${state.environment.seed}.`,
    );
  } catch (error) {
    state.errors.environment = error.message;
    announce(error.message);
  } finally {
    state.pending.environment = false;
    render();
  }
}
async function loadTraining() {
  if (state.pending.training) return;
  state.pending.training = true;
  delete state.errors.training;
  render();
  try {
    state.training = await api(
      state.trainingId === "recorded"
        ? "/api/training"
        : `/api/training/runs/${state.trainingId}`,
    );
  } catch (error) {
    state.errors.training = error.message;
    announce(error.message);
  } finally {
    state.pending.training = false;
    render();
  }
}
function ensureData() {
  const current = route();
  if (!current.valid) return;
  if (
    current.section === "arena" &&
    current.view === "replay" &&
    !state.environment &&
    !state.pending.environment &&
    !state.errors.environment
  )
    void inspectSeed();
  if (
    current.section === "compare" &&
    !state.comparison &&
    !state.pending.compare &&
    !state.errors.compare
  )
    void runComparison();
  if (
    current.section === "environment" &&
    !state.environment &&
    !state.pending.environment &&
    !state.errors.environment
  )
    void inspectSeed();
  if (
    current.section === "environment" &&
    !state.episode &&
    !state.pending.arena &&
    !state.errors.arena
  )
    void runEpisode();
  if (
    current.section === "training" &&
    !state.training &&
    !state.pending.training &&
    !state.errors.training
  )
    void loadTraining();
}

async function refreshRuns({ restore = false } = {}) {
  const [training, connections, saved] = await Promise.all([
    api("/api/training/runs"),
    api("/api/connections"),
    api("/api/runs"),
  ]);
  state.trainingRuns = training.runs.filter((run) => run.kind === "grpo");
  state.connections = connections;
  state.runs = saved.runs;
  if (restore && state.trainingRuns.length)
    state.trainingId = state.trainingRuns[0].id;
  if (restore && !state.liveRun) {
    const latest = state.runs.find((run) => run.kind === "evaluation");
    if (latest) state.liveRun = await api(`/api/runs/${latest.id}`);
  }
}

async function checkConnections() {
  if (state.pending.connections) return;
  state.pending.connections = true;
  delete state.errors.connections;
  render();
  try {
    state.connections = await api("/api/connections/check", {});
    announce("Account checks complete.");
  } catch (error) {
    state.errors.connections = error.message;
  } finally {
    state.pending.connections = false;
    render();
  }
}

async function runWasmerLab() {
  if (state.pending.live || activeRun(state.liveRun)) return;
  const seed = readSeed();
  if (seed === null) return;
  state.pending.live = true;
  delete state.errors.live;
  render();
  try {
    state.liveRun = await api("/api/runs", {
      seed,
      target: state.liveTarget,
      agent: state.liveAgent,
      policy: state.livePolicy,
      comparison: false,
      checkpoint_id: null,
    });
    state.liveSelected = 0;
    state.runs.unshift(state.liveRun);
    announce("Wasmer containment run started.");
  } catch (error) {
    state.errors.live = error.message;
    announce(error.message);
  } finally {
    state.pending.live = false;
    render();
  }
}

async function pollWasmer() {
  try {
    const run = state.liveRun;
    if (run?.id && (route().section === "sandbox" || activeRun(run))) {
      const updated = await api(`/api/runs/${run.id}`);
      if (updated.updated_at !== run.updated_at) {
        state.liveRun = updated;
        render();
      }
    }
  } catch (error) {
    state.errors.live = error.message;
  } finally {
    setTimeout(pollWasmer, document.hidden ? 4000 : 850);
  }
}

async function loadWasmerRun(id) {
  if (!id) return;
  try {
    state.liveRun = await api(`/api/runs/${id}`);
    state.liveSelected = 0;
    render();
  } catch (error) {
    state.errors.live = error.message;
    render();
  }
}

async function cancelWasmerRun(id) {
  try {
    state.liveRun = await api(`/api/runs/${id}/cancel`, {});
    announce("Cancelling the Wasmer run and releasing resources.");
    render();
  } catch (error) {
    state.errors.live = error.message;
    render();
  }
}

async function pollTraining() {
  try {
    if (route().section === "training") {
      const catalog = await api("/api/training/runs");
      const runs = catalog.runs.filter((run) => run.kind === "grpo");
      let changed = JSON.stringify(runs) !== JSON.stringify(state.trainingRuns);
      state.trainingRuns = runs;
      if (state.trainingId !== "recorded") {
        const id = state.trainingId;
        const data = await api(`/api/training/runs/${id}`);
        if (
          id === state.trainingId &&
          data.metadata.kind === "grpo" &&
          (!state.training ||
            data.metadata.updated_at !== state.training.metadata.updated_at)
        ) {
          state.training = data;
          changed = true;
        }
      }
      if (changed) render();
    }
  } catch (error) {
    state.errors.training = error.message;
  } finally {
    setTimeout(pollTraining, document.hidden ? 5000 : 1500);
  }
}
function scrollToRoute() {
  if (location.hash) {
    requestAnimationFrame(() =>
      document
        .getElementById(decodeURIComponent(location.hash.slice(1)))
        ?.scrollIntoView(),
    );
  } else window.scrollTo({ top: 0, behavior: "instant" });
}
function navigate(path) {
  state.arenaPanel = null;
  pausePlayback();
  history.pushState(null, "", path);
  state.menu = false;
  render({ restoreFocus: false });
  ensureData();
  scrollToRoute();
  document.getElementById("main-content").focus({ preventScroll: true });
}

let dialogTrigger = null;
function showDialog(title, body) {
  dialogTrigger = document.activeElement;
  const dialog = document.getElementById("record-dialog");
  dialog.innerHTML = `<div class="dialog-header"><h2 id="dialog-title">${h(title)}</h2><button class="button icon-only" data-action="close-dialog" aria-label="Close details">${icon("cross", 16)}</button></div><div class="dialog-body">${body}</div>`;
  dialog.showModal();
}
function closeDialog() {
  document.getElementById("record-dialog").close();
  dialogTrigger?.focus({ preventScroll: true });
}
function compareDetail(policy, tick) {
  const episode = state.comparison[policy],
    entry = episode.log.find((r) => r.agent === "worker" && r.tick === tick),
    info = actionInfo(entry),
    auditor = episode.log.find(
      (r) => r.agent === "oversight" && r.tick === tick,
    );
  showDialog(
    `${policyName(policy)} · Tick ${pad(tick)} · ${info.name}`,
    `${badge(info.status, info.tone)}<p>${h(info.description)}</p>${entry.task ? `<section><h3>Customer request</h3><p>${h(entry.task.message)}</p></section>` : ""}<section><h3>Action parameters</h3><pre>${h(JSON.stringify(entry.parameters, null, 2))}</pre></section><section><h3>Tool result</h3><pre>${h(JSON.stringify(entry.result, null, 2))}</pre></section>${auditor ? `<section><h3>Auditor explanation</h3><p>${h(auditor.explanation)}</p></section>` : ""}`,
  );
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-route]");
  if (
    link &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    event.button === 0
  ) {
    event.preventDefault();
    navigate(link.getAttribute("href"));
    return;
  }
  const element = event.target.closest("[data-action]");
  if (!element || element.disabled) return;
  const action = element.dataset.action,
    current = route();
  if (action === "arena-panel" || action === "arena-close-panel") {
    pausePlayback();
    const previous = state.arenaPanel;
    state.arenaPanel =
      action === "arena-panel" && element.dataset.panel !== previous
        ? element.dataset.panel
        : null;
    render();
    if (state.arenaPanel) {
      document
        .querySelector(
          `#arena-${state.arenaPanel}-panel button, #arena-${state.arenaPanel}-panel a`,
        )
        ?.focus({ preventScroll: true });
    } else {
      document
        .querySelector(`[data-action="arena-panel"][data-panel="${previous}"]`)
        ?.focus({ preventScroll: true });
    }
    return;
  }
  if (["graph-fit", "graph-orbit", "graph-clear-selection"].includes(action)) {
    graphCommand(action);
    return;
  }
  if (action === "focus-terminal" || action === "open-agent-terminal") {
    openAgentTerminal(element.dataset.role);
    return;
  }
  if (action === "toggle-terminals") {
    state.terminalsOpen = !state.terminalsOpen;
    render();
    return;
  }
  if (action === "graph-jump") {
    pausePlayback();
    seekReplay(Number(element.dataset.index));
    render();
    return;
  }
  if (action === "check-connections") {
    void checkConnections();
    return;
  }
  if (action === "run-live") {
    void runWasmerLab();
    return;
  }
  if (action === "refresh-runs") {
    void refreshRuns();
    return;
  }
  if (action === "cancel-run") {
    void cancelWasmerRun(element.dataset.id);
    return;
  }
  if (action === "live-case") {
    state.liveSelected = Number(element.dataset.index);
    render();
    return;
  }
  if (action === "unlock-controls") {
    sessionStorage.setItem(
      "sentry-control-token",
      document.getElementById("control-token").value,
    );
    void checkConnections();
    return;
  }
  if (action === "lock-controls") {
    sessionStorage.removeItem("sentry-control-token");
    announce("Run controls locked.");
    return;
  }
  if (action === "run-episode") {
    void runEpisode();
    return;
  }
  if (action === "arena-play") {
    togglePlayback();
    return;
  }
  if (action === "arena-step" || action === "arena-restart") {
    pausePlayback();
    seekReplay(
      action === "arena-restart"
        ? 0
        : state.replay.selected + Number(element.dataset.step),
    );
  }
  if (action === "arena-role" && state.episode) {
    pausePlayback();
    const tick = state.episode.log[state.replay.selected].tick;
    seekReplay(
      state.episode.log.findIndex(
        (row) => row.tick === tick && row.agent === element.dataset.role,
      ),
    );
  }
  if (action === "run-comparison") {
    void runComparison();
    return;
  }
  if (action === "inspect-seed") {
    state.episode = null;
    void inspectSeed();
    void runEpisode();
    return;
  }
  if (action === "reload-training") {
    void loadTraining();
    return;
  }
  if (action === "close-dialog") {
    closeDialog();
    return;
  }
  if (action === "compare-detail") {
    compareDetail(element.dataset.policy, Number(element.dataset.tick));
    return;
  }
  if (action === "open-hf-live") {
    event.preventDefault();
    const opened = openTrainingSync(state);
    announce(
      opened
        ? "Opened synchronized Worker metrics."
        : "Your browser blocked the synchronized metrics window.",
    );
    return;
  }
  if (action === "record-detail") {
    const record =
      state.environment[element.dataset.kind][Number(element.dataset.index)];
    const id =
      record.task_id ||
      record.invoice_id ||
      record.ticket_id ||
      record.customer_id;
    showDialog(
      `${id}${record.name ? ` · ${record.name}` : ""}`,
      `${record.message ? `<section><h3>Complete request</h3><p>${h(record.message)}</p></section>` : ""}<section><h3>Record ${state.environment.scope === "after_run" ? "after execution" : "at the start"} · seed ${state.environment.seed}</h3><pre>${h(JSON.stringify(record, null, 2))}</pre></section>`,
    );
    return;
  }
  if (action === "policy") state.policy = element.dataset.value;
  if (action === "select-action") {
    pausePlayback();
    state.replay.selected = Number(element.dataset.index);
    announce(`Selected ${element.getAttribute("aria-label")}.`);
  }
  if (action === "replay-mode") {
    state.replay.mode = state.replay.mode === "notable" ? "all" : "notable";
    state.replay.page = 0;
  }
  if (action === "replay-prev")
    state.replay.page = Math.max(0, state.replay.page - 1);
  if (action === "replay-next") state.replay.page++;
  if (action === "compare-prev")
    state.compareStart = Math.max(0, state.compareStart - 6);
  if (action === "compare-next")
    state.compareStart = Math.min(24, state.compareStart + 6);
  if (action === "records-prev")
    state.filters[current.view].page = Math.max(
      0,
      state.filters[current.view].page - 1,
    );
  if (action === "records-next") state.filters[current.view].page++;
  if (action === "clear-filters")
    state.filters[current.view] = { search: "", filter: "", page: 0 };
  if (action === "toggle-menu") state.menu = !state.menu;
  if (action === "toggle-menu" && state.menu) pausePlayback();
  if (action === "close-menu") state.menu = false;
  render();
  if (action === "toggle-menu" && state.menu)
    app.querySelector(".sidebar .brand").focus();
});
document.addEventListener("change", (event) => {
  const input = event.target,
    current = route();
  if (input.id === "arena-position") {
    pausePlayback();
    seekReplay(Number(input.value));
    render();
    return;
  }
  if (input.id === "arena-speed") {
    state.playback.speed = Number(input.value);
    clearTimeout(replayTimer);
    advanceReplay();
    return;
  }
  if (input.id === "training-run-select") {
    state.trainingId = input.value;
    state.training = null;
    void loadTraining();
    return;
  }
  if (input.id === "live-target") state.liveTarget = input.value;
  if (input.id === "live-agent") state.liveAgent = input.value;
  if (input.id === "live-policy") state.livePolicy = input.value;
  if (input.id === "episode-history") {
    void loadWasmerRun(input.value);
    return;
  }
  if (input.id === "scenario-select") {
    if (input.value === "custom") {
      const seed = document.getElementById("seed-input");
      seed.focus();
      seed.select();
      return;
    }
    state.seed = Number(input.value);
    render();
  }
  if (input.id === "seed-input") {
    state.seed = input.value;
    const select = document.getElementById("scenario-select");
    if (select)
      select.value = state.config.presets.some(
        (p) => p.seed === Number(input.value),
      )
        ? String(Number(input.value))
        : "custom";
  }
  if (input.id === "agent-filter") {
    state.replay.agent = input.value;
    state.replay.page = 0;
    render();
  }
  if (input.id === "record-filter") {
    state.filters.all.filter = input.value;
    state.filters.all.page = 0;
    render();
  }
});
document.addEventListener("input", (event) => {
  const input = event.target;
  if (input.id === "seed-input") {
    input.setCustomValidity("");
    state.seed = input.value;
  }
  if (input.id === "record-search") {
    const filter = state.filters.all;
    filter.search = input.value;
    filter.page = 0;
    render();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (event.target.id === "arena-position") pausePlayback();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.arenaPanel) {
    const panel = state.arenaPanel;
    state.arenaPanel = null;
    render();
    document
      .querySelector(`[data-action="arena-panel"][data-panel="${panel}"]`)
      ?.focus({ preventScroll: true });
    return;
  }
  if (
    event.key === "Escape" &&
    event.target.closest?.("#arena-graph-inspector")
  ) {
    graphCommand("graph-clear-selection");
    return;
  }
  if (event.key === "Tab" && state.menu && mobileQuery.matches) {
    const links = [...app.querySelectorAll(".sidebar a")],
      first = links[0],
      last = links.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (event.key === "Enter" && event.target.id === "seed-input") {
    event.preventDefault();
    const section = route().section;
    if (section === "arena") void runEpisode();
    else if (section === "compare") void runComparison();
    else if (section === "environment") {
      state.episode = null;
      void inspectSeed();
      void runEpisode();
    }
  }
  if (event.key === "Escape" && state.menu) {
    state.menu = false;
    render();
    app.querySelector(".mobile-menu")?.focus();
  }
});
document.getElementById("record-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDialog();
});
document
  .getElementById("record-dialog")
  .addEventListener("close", () =>
    dialogTrigger?.focus({ preventScroll: true }),
  );
window.addEventListener("popstate", () => {
  pausePlayback();
  state.menu = false;
  render({ restoreFocus: false });
  ensureData();
  scrollToRoute();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.playback.playing) {
    pausePlayback();
    render();
  }
});
mobileQuery.addEventListener("change", () => {
  state.menu = false;
  render({ restoreFocus: false });
});

render();
try {
  state.config = await api("/api/config");
  state.connections = state.config.connections;
  await refreshRuns({ restore: true });
} catch (error) {
  state.errors.arena = error.message;
}
render();
ensureData();
scrollToRoute();
void pollTraining();
void pollWasmer();
