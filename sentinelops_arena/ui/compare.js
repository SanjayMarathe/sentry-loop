import {
  h,
  button,
  badge,
  actor,
  header,
  tabs,
  metricStrip,
  panel,
  footer,
  note,
  chart,
  legend,
  scoreSeries,
  colors,
  actionInfo,
  number,
  percent,
  signed,
  pad,
  table,
  policyName,
  loading,
} from "./ui.js";
import { arenaConfig, errorNote } from "./arena.js";

export function comparePage(state, view) {
  const comparison = state.comparison,
    busy = state.pending.compare;
  let content =
    header(
      "Compare",
      "Same conditions. Two policies. See what changes.",
      button(
        busy ? "Comparing…" : "Run comparison",
        "run-comparison",
        "primary",
        "play",
        busy,
      ),
    ) + arenaConfig(state, true);
  if (!comparison)
    return (
      content +
      (state.errors.compare
        ? errorNote(state.errors.compare, "run-comparison")
        : loading("Running both policies on the same seed…"))
    );
  const b = comparison.baseline,
    r = comparison.resilient,
    bm = b.metrics,
    rm = r.metrics;
  content += metricStrip(
    [
      [
        "Worker reward",
        `${number(b.scores.worker)} → ${number(r.scores.worker)}`,
        `${signed(r.scores.worker - b.scores.worker)} points with the resilient policy`,
      ],
      [
        "Oversight accuracy",
        `${percent(bm.oversight_accuracy)} → ${percent(rm.oversight_accuracy)}`,
        `${signed((rm.oversight_accuracy - bm.oversight_accuracy) * 100)} percentage points · reported`,
      ],
      [
        "Task success",
        `${percent(bm.benign_task_success)} → ${percent(rm.benign_task_success)}`,
        "Reported completion signal",
      ],
      [
        "Flags raised",
        `${bm.total_flags} → ${rm.total_flags}`,
        `${signed(rm.total_flags - bm.total_flags, 0)} flags with the resilient policy`,
      ],
    ],
    "compare-metrics",
  );
  content += tabs(
    [
      ["Replays", "/compare/replays"],
      ["Analytics", "/compare/analytics"],
    ],
    `/compare/${view}`,
    badge(`Seed ${comparison.seed} · Complete`, "success", true),
  );
  if (state.errors.compare)
    content += errorNote(state.errors.compare, "run-comparison");
  if (Number(state.seed) !== comparison.seed)
    content += note(
      "Configuration changed",
      `Showing the completed comparison for seed ${comparison.seed}. Run the comparison to apply your new seed.`,
    );
  content +=
    view === "analytics"
      ? comparisonAnalytics(comparison)
      : comparisonReplays(state);
  return (
    content +
    footer(
      "Both policies use the same starting environment and attack seed.",
      `Seed ${comparison.seed}  /  ${b.ticks} ticks per policy`,
    )
  );
}
function interpretation(c) {
  const o =
      (c.resilient.metrics.oversight_accuracy -
        c.baseline.metrics.oversight_accuracy) *
      100,
    t =
      (c.resilient.metrics.benign_task_success -
        c.baseline.metrics.benign_task_success) *
      100;
  const title =
    o > 0 && t < 0
      ? "Better oversight, fewer completed tasks"
      : o === 0 && t === 0
        ? "Similar outcomes, different actions"
        : o < 0
          ? "A different balance of outcomes"
          : "Inspect the policy tradeoff";
  return {
    title,
    copy: `On seed ${c.seed}, reported oversight accuracy changes by ${signed(o)} percentage points and task success by ${signed(t)}. Inspect the replays to understand the difference.`,
    o,
    t,
  };
}
function comparisonReplays(state) {
  const c = state.comparison,
    start = state.compareStart,
    end = Math.min(start + 6, 30),
    insight = interpretation(c);
  const pair = ["baseline", "resilient"]
    .map((policy) => {
      const episode = c[policy],
        rows = episode.log.filter(
          (r) => r.agent === "worker" && r.tick >= start && r.tick < end,
        );
      const actions = rows
        .map((row) => {
          const info = actionInfo(row),
            details = row.result?.details || row.result || {};
          const brief =
            details.error ||
            row.response ||
            (Object.keys(row.parameters || {}).length
              ? Object.entries(row.parameters)
                  .map(
                    ([key, value]) =>
                      `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`,
                  )
                  .join(" · ")
              : info.description);
          const defensive = [
            "get_current_policy",
            "get_schema",
            "respond",
          ].includes(row.action_type);
          return `<button class="pair-replay-row ${defensive ? "emphasized" : ""}" data-action="compare-detail" data-policy="${policy}" data-tick="${row.tick}" aria-label="${policyName(policy)}, tick ${row.tick}, ${h(info.name)}"><span>${pad(row.tick)}</span><span><strong>${h(info.name)}</strong><small title="${h(brief)}">${h(brief)}</small></span><span>${signed(row.reward)}</span></button>`;
        })
        .join("");
      return panel(
        policyName(policy),
        policy === "baseline"
          ? "Direct task execution"
          : "Policy checks and defensive responses",
        `<div class="pair-replay-head"><span>TICK</span><span>WORKER ACTION</span><span>PTS</span></div>${actions}<div class="table-footer"><span>Ticks ${pad(start)}–${pad(end - 1)} of 30</span>${badge(`${episode.metrics.total_flags} flags`)}</div>`,
        `<div class="pair-score"><small>Worker</small><strong>${number(episode.scores.worker)}</strong></div>`,
        "clip",
      );
    })
    .join("");
  return (
    note(insight.title, insight.copy, "compare", true) +
    `<div class="columns paired">${pair}</div><div class="page-footer"><span>Click any action to inspect its request and result.</span><div class="pagination"><button class="text-button" data-action="compare-prev" ${start === 0 ? "disabled" : ""}>Previous ticks</button><span class="mono">${pad(start)}–${pad(end - 1)}</span><button class="text-button" data-action="compare-next" ${end >= 30 ? "disabled" : ""}>Next ticks</button></div></div>`
  );
}
function comparisonAnalytics(c) {
  const b = c.baseline,
    r = c.resilient,
    bm = b.metrics,
    rm = r.metrics,
    insight = interpretation(c);
  const largest = Math.max(
    1,
    ...Object.values(b.scores).map(Math.abs),
    ...Object.values(r.scores).map(Math.abs),
  );
  const bars = ["worker", "attacker", "oversight"]
    .map(
      (role) =>
        `<div class="score-bar-row">${actor(role)}<div class="paired-bars">${[
          [b, "#BFC9FA"],
          [r, colors.worker],
        ]
          .map(
            ([e, color]) =>
              `<div class="paired-bar"><i style="--bar-color:${color};width:${(Math.abs(e.scores[role]) / largest) * 85}%"></i><span>${number(e.scores[role])}</span></div>`,
          )
          .join("")}</div></div>`,
    )
    .join("");
  const side = `<aside class="aside"><h2>Read the whole picture</h2><div><h4>Oversight ${insight.o > 0 ? "improved" : insight.o < 0 ? "decreased" : "was unchanged"}</h4><p>${Math.round(rm.oversight_accuracy * rm.total_oversight)} of ${rm.total_oversight} decisions were reported correct with the resilient worker.</p></div><div><h4>Task completion ${insight.t > 0 ? "increased" : insight.t < 0 ? "decreased" : "was unchanged"}</h4><p>Reported task success changed by ${signed(insight.t)} percentage points.</p></div><div><h4>A single scenario</h4><p>Use more seeds before drawing conclusions about overall robustness.</p></div></aside>`;
  const rows = [
    [
      "Attack success rate",
      percent(bm.attack_success_rate),
      percent(rm.attack_success_rate),
      `${signed((rm.attack_success_rate - bm.attack_success_rate) * 100)} percentage points`,
    ],
    [
      "Task success",
      percent(bm.benign_task_success),
      percent(rm.benign_task_success),
      `${signed(insight.t)} percentage points`,
    ],
    [
      "Oversight accuracy",
      percent(bm.oversight_accuracy),
      percent(rm.oversight_accuracy),
      `${signed(insight.o)} percentage points`,
    ],
    [
      "False positives / flags",
      `${bm.false_positives} / ${bm.total_flags}`,
      `${rm.false_positives} / ${rm.total_flags}`,
      `${signed(rm.false_positives - bm.false_positives, 0)} reported false positives`,
    ],
    [
      "Drift adaptation",
      `${bm.drifts_detected} / ${bm.drift_events}`,
      `${rm.drifts_detected} / ${rm.drift_events}`,
      `${signed(rm.drifts_detected - bm.drifts_detected, 0)} subsequent detections`,
    ],
    [
      "Mean detection time",
      bm.attacks_detected ? `${number(bm.mean_time_to_detect)} ticks` : "—",
      rm.attacks_detected ? `${number(rm.mean_time_to_detect)} ticks` : "—",
      `${rm.attacks_detected} resilient defensive probes`,
    ],
    [
      "Refusal responses",
      String(bm.social_eng_resisted),
      String(rm.social_eng_resisted),
      `${bm.social_eng_total} injected messages per run`,
    ],
    [
      "Explanation quality",
      number(bm.avg_explanation_quality, 3),
      number(rm.avg_explanation_quality, 3),
      signed(rm.avg_explanation_quality - bm.avg_explanation_quality, 3),
    ],
  ].map(([label, before, after, change]) => [
    h(label),
    `<span class="mono">${h(before)}</span>`,
    `<strong class="mono">${h(after)}</strong>`,
    `<small>${h(change)}</small>`,
  ]);
  const timelines = ["baseline", "resilient"]
    .map((policy) => {
      const series = scoreSeries(c[policy]);
      return panel(
        `${policyName(policy)} · Action rewards`,
        "Cumulative reward per recorded action",
        chart(series, {
          width: 548,
          height: 230,
          title: `${policyName(policy)} action rewards`,
        }) + `<div class="chart-caption">${legend(series)}</div>`,
      );
    })
    .join("");
  return `<div class="columns">${panel(
    "Final scores",
    "Same seed, including downstream rewards",
    bars,
    legend([
      { name: "Baseline", color: "#BFC9FA" },
      { name: "Resilient", color: colors.worker },
    ]),
  )}${side}</div>${panel("Security metrics", "Reported outcomes and detection signals together", table(["MEASURE", "BASELINE", "RESILIENT", "CHANGE"], rows), "", "clip")}<div class="columns paired">${timelines}</div>`;
}
