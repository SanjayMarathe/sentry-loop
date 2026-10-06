import {
  h, button, badge, header, metricStrip, panel, footer, note,
  percent, number, pad, policyName, loading, titleCase,
} from "./ui.js";
import { arenaConfig, errorNote } from "./arena.js";

const scoreFields = [
  ["Attack success", "attack_success_rate", percent],
  ["Benign completion", "benign_completion_rate", percent],
  ["Over refusal", "over_refusal_rate", percent],
];

function detectionTime(value) {
  return value == null ? "—" : `${number(value)} ticks`;
}

export function resultsPage(state, view = "scorecard") {
  const comparison = state.comparison;
  const busy = state.pending.compare;
  let content = header(
    "Results",
    "Compare policy outcomes from the same attack seed.",
    button(busy ? "Comparing…" : "Run comparison", "run-comparison", "primary", "play", busy),
  );
  if (!comparison) {
    return content + (state.errors.compare
      ? errorNote(state.errors.compare, "run-comparison")
      : loading("Running both policies on the same seed…")) + arenaConfig(state, true);
  }
  const b = comparison.baseline.scorecard;
  const r = comparison.resilient.scorecard;
  content += metricStrip(scoreFields.map(([label, key, format]) => [
    label,
    `${format(b[key])} → ${format(r[key])}`,
    "Baseline → Resilient",
  ]), "compare-metrics");
  content += `<div class="columns paired">${["baseline", "resilient"].map((policy) => policyCard(comparison[policy])).join("")}</div>`;
  content += arenaConfig(state, true);
  if (state.errors.compare) content += errorNote(state.errors.compare, "run-comparison");
  if (Number(state.seed) !== comparison.seed) {
    content += note(
      "Configuration changed",
      `Showing the completed comparison for seed ${comparison.seed}. Run the comparison to apply your new seed.`,
    );
  }
  if (view === "replays") content += replayRows(comparison);
  return content + footer(
    "Each attack row opens its launch tick in the Arena replay.",
    `Seed ${comparison.seed} / ${comparison.baseline.ticks} ticks per policy`,
  );
}

// The old Compare bookmarks stay useful for development without exposing proxy metrics.
export function comparePage(state, view) {
  return resultsPage(state, view);
}

export function replayEntryIndex(episode, tick, agent = "attacker") {
  return episode.log.findIndex((row) => row.tick === tick && row.agent === agent);
}

function policyCard(episode) {
  const score = episode.scorecard;
  const policy = episode.policy;
  const summary = `<div class="stats-card">
    <div class="small-stat"><span>Social engineering resisted</span><strong>${h(score.social_eng_resisted)} / ${h(score.social_eng_total)}</strong><small>Targeted injected tasks</small></div>
    <div class="small-stat"><span>Mean time to detect</span><strong>${h(detectionTime(score.mean_time_to_detect))}</strong><small>From attack launch</small></div>
    <div class="small-stat"><span>Attacks launched</span><strong>${h(score.totals.attacks)}</strong><small>${h(score.totals.benign_tasks)} benign tasks</small></div>
  </div>`;
  const attacks = score.per_attack.length
    ? `<div class="pair-replay-head"><span>TICK</span><span>ATTACK OUTCOME</span><span>OPEN</span></div>${score.per_attack.map((attack) => attackRow(policy, attack)).join("")}`
    : '<p class="empty-results">No attacks were launched.</p>';
  return panel(
    `${policyName(policy)} policy`,
    "Scorecard outcomes from ground truth",
    `${summary}<h3>Attacks</h3>${attacks}`,
    badge(`${score.totals.attacks} attacks`),
    "clip",
  );
}

function attackRow(policy, attack) {
  const rules = attack.violated_rules.length ? attack.violated_rules.join(", ") : "None";
  return `<button type="button" class="pair-replay-row" data-action="open-scorecard-attack" data-policy="${h(policy)}" data-tick="${h(attack.tick)}"><span>${pad(attack.tick)}</span><span><strong>Attack type: ${h(attack.attack_type)}</strong><div>Target: ${h(attack.target)}</div><div>Outcome: ${h(attack.outcome)}</div><div>Worker action: ${h(attack.worker_action || "None")}</div><div>Violated rules: ${h(rules)}</div></span><span>→</span></button>`;
}

function replayRows(comparison) {
  return `<div class="columns paired">${["baseline", "resilient"].map((policy) => {
    const rows = comparison[policy].log.filter((row) => row.agent === "worker");
    return panel(
      `${policyName(policy)} actions`,
      "Open a worker tick in Arena",
      `<div class="pair-replay-head"><span>TICK</span><span>WORKER ACTION</span><span>OPEN</span></div>${rows.map((row) => `<button type="button" class="pair-replay-row" data-action="open-scorecard-attack" data-policy="${h(policy)}" data-tick="${h(row.tick)}" data-agent="worker" aria-label="${h(policyName(policy))}, tick ${h(row.tick)}, ${h(titleCase(row.action_type))}"><span>${pad(row.tick)}</span><span><strong>${h(titleCase(row.action_type))}</strong><small>${row.ground_truth?.violations_present ? "Violation" : "No violation"}</small></span><span>→</span></button>`).join("")}`,
      "", "clip",
    );
  }).join("")}</div>`;
}
