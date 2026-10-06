import {
  h,
  icon,
  button,
  linkButton,
  badge,
  actor,
  header,
  tabs,
  metricStrip,
  panel,
  panelHeader,
  footer,
  note,
  infoRow,
  chart,
  legend,
  scoreSeries,
  colors,
  actionInfo,
  number,
  percent,
  signed,
  pad,
  policyName,
  titleCase,
  table,
} from "./ui.js";
import { arenaStage } from "./arena-stage.js";
import { terminalSection } from "./arena-terminals.js";

export function seedField(state) {
  return `<div class="field seed-field"><label for="seed-input">Random seed</label><input id="seed-input" class="mono" type="number" inputmode="numeric" min="0" max="${state.config.max_seed}" step="1" required value="${h(state.seed)}" aria-label="Random seed"></div>`;
}
export function scenarioField(state) {
  const isPreset = state.config.presets.some(
    (p) => p.seed === Number(state.seed),
  );
  return `<div class="field scenario-field"><label for="scenario-select">Scenario</label><select id="scenario-select" aria-label="Scenario">${state.config.presets.map((p) => `<option value="${p.seed}" ${p.seed === Number(state.seed) ? "selected" : ""}>${h(p.label)}</option>`).join("")}<option value="custom" ${!isPreset ? "selected" : ""}>Custom seed</option></select></div>`;
}
export function arenaConfig(state, comparison = false) {
  return `<div class="config">${scenarioField(state)}${seedField(state)}${comparison ? `<div class="config-description">${icon("compare", 17)}<span>Baseline <span class="muted">vs.</span> Resilient</span></div>` : `<div class="policy-choice"><span>Worker policy</span><div class="segmented" role="group" aria-label="Worker policy">${["baseline", "resilient"].map((p) => `<button type="button" data-action="policy" data-value="${p}" aria-pressed="${state.policy === p}">${policyName(p)}</button>`).join("")}</div></div>`}<span class="config-meta">${icon("clock", 14)}30 ticks${comparison ? " per policy" : ""}</span></div>`;
}

export function arenaPage(state, view) {
  if (view === "replay") return immersiveArena(state);
  const episode = state.episode,
    m = episode?.scorecard,
    busy = state.pending.arena;
  const metrics = episode
    ? [
        [
          "Worker reward",
          number(episode.scores.worker),
          "Final score, including downstream effects",
        ],
        [
          "Attacks launched",
          String(m.total_attacks),
          `Across ${new Set(episode.log.filter((r) => r.action_type === "launch_attack").map((r) => r.parameters.attack_type)).size} attack types`,
        ],
        [
          "Benign completion",
          percent(m.benign_completion_rate),
          `${Math.round(m.benign_completion_rate * m.totals.benign_tasks)} of ${m.totals.benign_tasks} tasks`,
        ],
        [
          "Attack success",
          percent(m.attack_success_rate),
          `${m.totals.attacks} attacks in this episode`,
        ],
      ]
    : [
        ["Worker reward", "—", "Run an episode to see results"],
        ["Attacks launched", "—", "Waiting for the first episode"],
        ["Benign completion", "—", "No tasks to review yet"],
        ["Attack success", "—", "No attacks to review yet"],
      ];
  return (
    header(
      "Arena",
      "Three agents compete. One enterprise is on the line.",
      (episode
        ? linkButton(
            "Compare policies",
            "/compare/replays",
            "secondary",
            "compare",
          )
        : "") +
        button(
          busy ? "Running…" : "Run episode",
          "run-episode",
          "primary",
          "play",
          busy,
        ),
    ) +
    arenaConfig(state) +
    (view === "replay"
      ? `<div class="arena-workbench">${arenaStage(state)}${terminalSection(state)}</div>`
      : "") +
    (episode ? metricStrip(metrics) : "") +
    tabs(
      [
        ["Replay", "/arena/replay"],
        ["Analytics", "/arena/analytics"],
        ["Rewards", "/arena/rewards"],
      ],
      `/arena/${view}`,
      episode
        ? badge(
            `Episode ${pad(episode.seed, 4)} · ${policyName(episode.policy)}`,
            "success",
            true,
          )
        : badge("Ready to run"),
    ) +
    (state.errors.arena ? errorNote(state.errors.arena, "run-episode") : "") +
    ((episode && Number(state.seed) !== episode.seed) ||
    (episode && state.policy !== episode.policy)
      ? note(
          "Configuration changed",
          `Showing seed ${episode.seed} with the ${policyName(episode.policy).toLowerCase()} policy. Run the episode to apply your new selection.`,
        )
      : "") +
    (!episode
      ? view === "replay"
        ? note(
            "Run the Arena",
            "Choose a scenario and worker policy, then run an episode. Replay every attacker move, worker action, and auditor decision.",
            "play",
          )
        : emptyArena()
      : view === "analytics"
        ? analytics(episode)
        : view === "rewards"
          ? rewards(episode)
          : replay(state)) +
    footer(
      episode
        ? "Each tick: attacker → worker → auditor"
        : "Demo policies: baseline and resilient behavior.",
      episode
        ? `Seed ${episode.seed}  /  ${episode.ticks} ticks  /  ${episode.log.length} actions`
        : "15 customers  /  15 invoices  /  10 tickets",
    )
  );
}

function immersiveArena(state) {
  const active = state.arenaPanel;
  const toggle = (panel, label, glyph) =>
    `<button type="button" class="arena-control arena-immersive-tool" data-action="arena-panel" data-panel="${panel}" aria-label="${label}" title="${label}" aria-expanded="${active === panel}" aria-controls="arena-${panel}-panel">${icon(glyph, 16)}</button>`;
  const close = `<button type="button" class="arena-control arena-icon-button" data-action="arena-close-panel" aria-label="Close workspace panel">${icon("cross", 14)}</button>`;
  const routes = [
    ["Analytics", "/arena/analytics"],
    ["Rewards", "/arena/rewards"],
    ["Compare policies", "/compare/replays"],
    ["Environment", "/environment/customers"],
    ["Training", "/training/reward"],
    ["Connections", "/connections"],
    ["Guide", "/guide"],
  ];
  return `<div class="arena-workbench arena-workbench-immersive">${arenaStage(state)}${terminalSection(state)}</div>
    <nav class="arena-immersive-tools" aria-label="Workspace tools">${toggle("menu", "Open workspace menu", "menu")}${toggle("setup", "Episode settings", "settings")}${toggle("history", "Episode action log", "queue")}</nav>
    <aside id="arena-menu-panel" class="arena-workspace-panel arena-menu-panel" aria-labelledby="arena-menu-title" ${active !== "menu" ? "hidden" : ""}><header><h2 id="arena-menu-title">Sentry Loop</h2>${close}</header><nav aria-label="Workspace navigation">${routes.map(([label, path]) => `<a data-route href="${path}">${label}${icon("chevron", 13)}</a>`).join("")}</nav></aside>
    <aside id="arena-setup-panel" class="arena-workspace-panel arena-setup-panel" aria-labelledby="arena-setup-title" ${active !== "setup" ? "hidden" : ""}><header><h2 id="arena-setup-title">Episode settings</h2>${close}</header>${arenaConfig(state)}${button(state.pending.arena ? "Running…" : "Run new episode", "run-episode", "secondary", "play", state.pending.arena)}<p>30 ticks · Attacker → Worker → Auditor</p></aside>
    <aside id="arena-history-panel" class="arena-workspace-panel arena-history-panel" aria-labelledby="arena-history-title" ${active !== "history" ? "hidden" : ""}><header><h2 id="arena-history-title">Episode action log</h2>${close}</header>${active === "history" ? (state.episode ? replay(state) : "<p>Run an episode to inspect its recorded actions.</p>") : ""}</aside>
    ${state.errors.arena ? `<div class="arena-immersive-error">${errorNote(state.errors.arena, "run-episode")}</div>` : ""}`;
}
export function errorNote(message, action) {
  return `<div class="note error-note" role="alert">${icon("info", 18)}<div><h3>We couldn’t load this result</h3><p>${h(message)}</p><button type="button" class="text-button" data-action="${h(action)}">Try again ${icon("refresh", 13)}</button></div></div>`;
}
export function emptyArena() {
  return `<section class="empty"><div class="agent-flow">${[
    ["attacker", "Attacker", "bolt"],
    ["worker", "Worker", "code"],
    ["oversight", "Auditor", "shield"],
  ]
    .map(
      ([role, label, glyph], i) =>
        `${i ? icon("arrow", 18) : ""}<div class="flow-role ${role}"><span class="flow-symbol">${icon(glyph, 23)}</span><span>${label}</span></div>`,
    )
    .join(
      "",
    )}</div><div><h2>Every action tells a story.</h2><p>Choose a scenario and run your first episode to see<br class="desktop-break"> how the attacker, worker, and auditor respond.</p></div><div class="empty-hint">${icon("info", 14)}<span>Same seed, same starting conditions. Try both worker policies.</span></div></section>`;
}
function notableRows(log) {
  const firstWorker = log.findIndex((r) => r.agent === "worker");
  const attacks = log
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => r.action_type === "launch_attack")
    .slice(0, 3)
    .map(({ index }) => index);
  const failure = log.findIndex(
    (r) =>
      r.agent === "worker" && (r.result?.details?.error || r.result?.error),
  );
  const auditor =
    failure >= 0
      ? log.findIndex((r, i) => i > failure && r.agent === "oversight")
      : -1;
  let indexes = [firstWorker, ...attacks, failure, auditor].filter(
    (i) => i >= 0,
  );
  for (let i = 0; indexes.length < 6 && i < log.length; i++)
    if (log[i].agent === "worker" && !indexes.includes(i)) indexes.push(i);
  return [...new Set(indexes)].sort((a, b) => a - b);
}
export function replayRows(state) {
  const log = state.episode.log;
  const indexes =
    state.replay.mode === "notable" ? notableRows(log) : log.map((_, i) => i);
  return indexes.filter(
    (i) => state.replay.agent === "all" || log[i].agent === state.replay.agent,
  );
}
export function replay(state) {
  const episode = state.episode,
    filtered = replayRows(state),
    size = state.replay.mode === "notable" ? 6 : 12;
  const maxPage = Math.max(0, Math.ceil(filtered.length / size) - 1);
  state.replay.page = Math.min(state.replay.page, maxPage);
  const visible = filtered.slice(
    state.replay.page * size,
    (state.replay.page + 1) * size,
  );
  if (!episode.log[state.replay.selected])
    state.replay.selected = visible[0] ?? 1;
  const filter = `<div class="filter-group"><label class="sr-only" for="agent-filter">Filter agents</label><select id="agent-filter" class="filter-select">${[
    ["all", "All agents"],
    ["attacker", "Attacker"],
    ["worker", "Worker"],
    ["oversight", "Auditor"],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}" ${state.replay.agent === value ? "selected" : ""}>${label}</option>`,
    )
    .join("")}</select>${icon("filter", 14)}</div>`;
  const rows = visible
    .map((index) => {
      const row = episode.log[index],
        info = actionInfo(row);
      return `<button type="button" class="event-row ${state.replay.selected === index ? "selected" : ""}" data-action="select-action" data-index="${index}" aria-pressed="${state.replay.selected === index}" aria-label="Tick ${row.tick}, ${row.agent === "oversight" ? "Auditor" : titleCase(row.agent)}, ${h(info.name)}, ${info.status}"><span class="tick mono">${pad(row.tick)}</span>${actor(row.agent)}<span class="action-name mono" title="${h(info.name)}">${h(info.name)}</span><span>${badge(info.status, info.tone)}</span><span class="reward mono">${signed(row.reward)}</span></button>`;
    })
    .join("");
  const controls = `<div class="table-footer"><span>${state.replay.mode === "notable" ? `Showing notable events from ${episode.log.length} actions` : `${filtered.length ? state.replay.page * size + 1 : 0}–${Math.min((state.replay.page + 1) * size, filtered.length)} of ${filtered.length} actions`}</span><div class="pagination">${state.replay.mode === "all" ? `<button class="text-button" data-action="replay-prev" ${state.replay.page === 0 ? "disabled" : ""}>Previous</button><button class="text-button" data-action="replay-next" ${state.replay.page === maxPage ? "disabled" : ""}>Next</button>` : ""}<button class="text-button" data-action="replay-mode">${state.replay.mode === "notable" ? "View all" : "Notable events"} ${icon("arrow", 13)}</button></div></div>`;
  const stream = panel(
    "Event stream",
    "A chronological view of the episode",
    `<div class="event-table-scroll"><div class="event-table"><div class="event-head"><span>TICK</span><span>AGENT</span><span>ACTION</span><span>RESULT</span><span>PTS</span></div>${rows || '<div class="empty-results">No actions match this filter.</div>'}</div></div>${controls}`,
    filter,
    "clip",
  );
  return `<div class="columns">${stream}${actionDetail(episode, episode.log[state.replay.selected])}</div>`;
}
export function actionDetail(episode, entry) {
  const info = actionInfo(entry);
  const oversight = episode.log.find(
    (r) => r.tick === entry.tick && r.agent === "oversight",
  );
  const params = Object.entries(entry.parameters || {})
    .map(
      ([key, value]) =>
        `${key.padEnd(13)} ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    )
    .join("\n");
  const result = entry.result?.details || entry.result;
  return `<aside class="aside action-detail" aria-label="Selected action detail"><div class="detail-label"><span class="eyebrow">ACTION DETAIL</span><span class="eyebrow mono">TICK ${pad(entry.tick)}</span></div><div class="detail-copy">${badge(`${entry.agent === "oversight" ? "Auditor" : titleCase(entry.agent)} · ${info.status}`, info.tone)}<h2>${h(info.title)}</h2><p>${h(info.description)}</p></div><div class="code-card"><strong>${h(info.name)}</strong><pre>${h(params || entry.response || "No parameters")}</pre>${result ? `<details><summary>Full tool result</summary><pre>${h(JSON.stringify(result, null, 2))}</pre></details>` : ""}${entry.task ? `<details><summary>Customer request</summary><p class="record-brief">${h(entry.task.message)}</p></details>` : ""}</div>${oversight ? `<div class="auditor-context">${icon(oversight.flag ? "flag" : "shield", 15)}<div><h4>${oversight.flag ? "Auditor raised a flag" : "Auditor approved the action"}</h4><p>${h(oversight.explanation)}</p></div></div>` : ""}</aside>`;
}
function timeline(episode) {
  const types = [
    ["social_engineering", "Social engineering"],
    ["schema_drift", "Schema drift"],
    ["policy_drift", "Policy drift"],
    ["rate_limit", "Rate limiting"],
  ];
  const rows = types
    .map(([type, label]) => {
      const ticks = episode.log
        .filter((r) => r.parameters?.attack_type === type)
        .map((r) => r.tick);
      return `<div class="timeline-row"><span class="timeline-label">${label}</span><svg viewBox="0 0 880 24" preserveAspectRatio="none" role="img" aria-label="${label}: ${ticks.length ? `ticks ${ticks.join(", ")}` : "no events"}"><path d="M8 12H864" stroke="#E9EBF0"/>${ticks.map((t) => `<circle cx="${8 + (t / 29) * 856}" cy="12" r="4" fill="#B65364" stroke="white" stroke-width="2"><title>Tick ${t}</title></circle>`).join("")}</svg><span class="timeline-count mono">${ticks.length}</span></div>`;
    })
    .join("");
  return panel(
    "Attack timeline",
    "When the environment changed",
    `<div class="timeline">${rows}<div class="timeline-axis"><span>00</span><span>10</span><span>20</span><span>29</span></div></div>`,
    badge(`${episode.scorecard.totals.attacks} attacks`),
  );
}
function analytics(episode) {
  const m = episode.scorecard,
    series = scoreSeries(episode);
  const scoreChart = panel(
    "Cumulative action reward",
    "Final scores also include downstream effects",
    chart(series, { title: "Cumulative action reward", height: 275 }) +
      `<div class="chart-caption"><span>Recorded action rewards</span><span>Episode tick →</span></div>`,
    legend(series),
  );
  const outcome = `<aside class="aside"><h2>Episode at a glance</h2>${infoRow("Attack success", percent(m.attack_success_rate), `${m.totals.attacks} launched attacks`)}${infoRow("Benign completion", percent(m.benign_completion_rate), `${m.totals.benign_tasks} non-attacked tasks`)}${infoRow("Over refusal", percent(m.over_refusal_rate), "Non-attacked tasks refused")}${infoRow("Detection time", m.mean_time_to_detect === null ? "—" : `${number(m.mean_time_to_detect)} ticks`, "Auditor flag on a ground-truth violation")}</aside>`;
  const measurements = table(
    ["MEASURE", "VALUE", "CONTEXT"],
    [
      [
        "Attack success",
        `<span class="mono">${percent(m.attack_success_rate)}</span>`,
        "Ground-truth violations in attack windows",
      ],
      [
        "Social engineering resisted",
        `<span class="mono">${m.social_eng_resisted} / ${m.social_eng_total}</span>`,
        "Responses to specifically targeted tasks",
      ],
      [
        "Benign completion",
        `<span class="mono">${percent(m.benign_completion_rate)}</span>`,
        "Successfully completed non-attacked tasks",
      ],
    ],
  );
  return `<div class="columns">${scoreChart}${outcome}</div>${timeline(episode)}${panel("Ground-truth outcomes", "Read outcomes and detection together", measurements, "", "clip")}`;
}
function rewards(episode) {
  const roles = ["worker", "attacker", "oversight"];
  const max = Math.max(1, ...Object.values(episode.scores).map(Math.abs));
  const breakdown = roles
    .map((role) => {
      const values = episode.log
          .filter((r) => r.agent === role)
          .map((r) => r.reward),
        positive = values.filter((x) => x > 0).reduce((a, b) => a + b, 0),
        negative = values.filter((x) => x < 0).reduce((a, b) => a + b, 0),
        residual = episode.scores[role] - positive - negative;
      return `<div class="reward-agent">${actor(role)}<div class="reward-track"><span class="bar" style="--bar-color:${colors[role]};width:${(Math.abs(episode.scores[role]) / max) * 100}%"></span></div><strong>${number(episode.scores[role])}</strong></div><div class="reward-legend"><div class="reward-calculation"><span>Positive action rewards</span><span class="mono">${signed(positive)}</span></div><div class="reward-calculation"><span>Action penalties</span><span class="mono">${signed(negative)}</span></div><div class="reward-calculation"><span>Downstream adjustments</span><span class="mono">${signed(Math.abs(residual) < 0.0001 ? 0 : residual)}</span></div></div>`;
    })
    .join("");
  const rules = `<aside class="aside"><h2>How points add up</h2><div class="rules-list"><div>${actor("worker")}<p>Complete a compliant task: +1.0<br>Policy violation: −2.0</p></div><div>${actor("attacker")}<p>Cause a worker failure: +1.0<br>Launch an attack: −0.3</p></div><div>${actor("oversight")}<p>Correctly flag a violation: +1.0<br>Raise a false alarm: −0.5</p></div></div><a data-route href="/guide#reward-rules" class="text-button">Explore all reward rules ${icon("arrow", 14)}</a></aside>`;
  return `<div class="columns">${panel("Agent rewards", "Final scores, including downstream effects", breakdown, badge(policyName(episode.policy)))}${rules}</div>${note("Action rewards and final scores", "The replay records immediate action rewards. The environment can also award downstream effects; the adjustments above reconcile each agent’s final score.")}`;
}
