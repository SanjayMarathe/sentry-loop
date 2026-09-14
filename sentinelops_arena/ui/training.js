import {
  h,
  icon,
  badge,
  header,
  tabs,
  metricStrip,
  panel,
  footer,
  note,
  infoRow,
  smallStats,
  chart,
  legend,
  colors,
  number,
  percent,
  pad,
  table,
  loading,
} from "./ui.js";
import { errorNote } from "./arena.js";
import {
  trainingControls,
  trainingActions,
  grpoTrainingPage,
} from "./grpo-training.js";

const average = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const views = [
  ["Reward", "reward"],
  ["Components", "components"],
  ["KL divergence", "kl"],
  ["Completion length", "length"],
  ["Loss", "loss"],
];
const componentInfo = [
  ["check_action", "Action correctness", colors.worker],
  ["format_exact", "Exact format", colors.green],
  ["format_approx", "Approx. format", colors.oversight],
  ["check_env", "Environment", colors.attacker],
];

export function trainingPage(state, view) {
  const data = state.training;
  if (state.trainingId !== "recorded") return grpoTrainingPage(state, view);
  let content = header(
    "Training",
    "Follow the learning signal, one step at a time.",
    trainingActions(state),
  );
  content += trainingControls(state);
  if (!data)
    return (
      content +
      (state.errors.training
        ? errorNote(state.errors.training, "reload-training")
        : loading("Loading recorded training metrics…"))
    );
  const rows = data.rows,
    meta = data.metadata,
    last = rows.at(-1),
    first = rows[0],
    avgReward = average(rows.map((r) => r.reward)),
    avgKL = average(rows.map((r) => r.kl)),
    peakKL = rows.reduce((a, b) => (a.kl > b.kl ? a : b));
  content += `<div class="config run-config"><div class="field"><span class="label">Training run</span><span class="field-value">${h(meta.agent)} · ${h(meta.model.replace("-Instruct", ""))}</span></div><div class="config-divider"></div><div class="field"><span class="label">Algorithm</span><span class="field-value">${h(meta.algorithm)}</span></div><div class="field"><span class="label">Adaptation</span><span class="field-value">LoRA · rank ${meta.lora_rank}</span></div>${badge("Recorded run", "", true)}<span class="mono muted">${rows.length} steps</span></div>`;
  content += metricStrip([
    [
      "Final reward",
      number(last.reward),
      `${number(avgReward, 2)} average across the run`,
    ],
    [
      "Recorded steps",
      String(rows.length),
      `${meta.generations} generations per group`,
    ],
    [
      "Average KL",
      number(avgKL, 3),
      `Peak ${number(peakKL.kl, 2)} at step ${peakKL.step}`,
    ],
    [
      "Completion length",
      number(last.mean_length),
      "Mean tokens at the final step",
    ],
  ]);
  content += tabs(
    views.map(([label, key]) => [label, `/training/${key}`]),
    `/training/${view}`,
    badge("Worker agent", "blue"),
  );
  const seriesFor = (spec) =>
    spec.map(([key, name, color]) => ({
      name,
      color,
      points: rows.map((row) => [row.step, row[key]]),
    }));
  const plot = (series, opts) =>
    chart(series, {
      width: 810,
      height: 300,
      xLabel: "Step",
      xRange: [first.step, last.step],
      xTicks:
        first.step === 1 && last.step === 216
          ? [1, 40, 80, 120, 160, 200, 216]
          : undefined,
      area: series.length === 1,
      ...opts,
    }) +
    `<div class="chart-caption">${legend(series)}<span>Training step →</span></div>`;
  const layout = (title, subtitle, plotBody, aside) =>
    `<div class="columns">${panel(title, subtitle, plotBody, badge(`Steps ${first.step}–${last.step}`))}<aside class="aside training-aside">${aside}</aside></div>`;
  if (view === "reward") {
    const low = rows.reduce((a, b) => (a.reward < b.reward ? a : b)),
      high = Math.max(...rows.map((r) => r.reward)),
      min = Math.floor(low.reward * 10) / 10,
      max = Math.ceil(high * 10) / 10;
    const bottom = min === max ? min - 0.1 : min,
      span = max - bottom || 0.1;
    const yTicks = Array.from({ length: 5 }, (_, i) => bottom + (span * i) / 4);
    content += layout(
      "Total reward",
      `Recorded reward · Expanded scale: ${number(bottom)} to ${number(max)}`,
      plot(seriesFor([["reward", "Total reward", colors.worker]]), {
        title: "Total training reward",
        yRange: [bottom, max + span * 0.08],
        yTicks,
        highlight: [
          low.step,
          low.reward,
          `Step ${low.step} · ${number(low.reward, 2)}`,
        ],
      }),
      `<h2>A narrow reward range</h2><p>The recorded run begins near its maximum reward and stays close to it.</p>${infoRow("Average reward", number(avgReward, 2))}${infoRow("Lowest reward", number(low.reward, 2))}${infoRow("Final reward", number(last.reward, 2))}<small>This view uses a zoomed vertical scale to make the small changes visible.</small>`,
    );
    content += smallStats([
      [
        "Zero reward variance",
        `${rows.filter((r) => r.reward_std === 0).length} / ${rows.length} steps`,
        "A property of reward scores across each generation group.",
      ],
      [
        `Steps below ${number(high)}`,
        `${rows.filter((r) => r.reward < high).length} steps`,
        "Small dips appear throughout the recorded run.",
      ],
      [
        "Observed range",
        `${number(low.reward, 2)}–${number(high, 2)}`,
        "Review behavior in the Arena alongside this learning signal.",
      ],
    ]);
    content += note(
      "What this run tells you",
      "Consistent reward scores do not establish identical outputs or performance on unseen scenarios. Use matched episode comparisons to evaluate behavior.",
    );
  } else if (view === "components") {
    const series = seriesFor(componentInfo),
      max = Math.max(5, ...series.flatMap((s) => s.points.map((p) => p[1])));
    content += layout(
      "Reward components",
      "The four scores recorded at every training step",
      plot(series, {
        title: "Training reward components",
        yRange: [0, max],
        yTicks: max === 5 ? [0, 1, 2, 3, 4, 5] : undefined,
      }),
      `<h2>Final component scores</h2>${componentInfo.map(([key, label]) => infoRow(label, number(last[key]))).join("")}<small>Values match the recorded metrics. Training configuration is listed separately below.</small>`,
    );
    const functions = [
      ["Exact JSON format", "Check strict output structure", "format_exact"],
      [
        "Approximate format",
        "Give partial credit for a usable structure",
        "format_approx",
      ],
      [
        "Action correctness",
        "Assess whether the action fits the agent role",
        "check_action",
      ],
      [
        "Environment execution",
        "Execute the action and measure its outcome",
        "check_env",
      ],
    ];
    content += panel(
      "Reward functions",
      "Each function captures a different part of a valid action",
      table(
        ["FUNCTION", "PURPOSE", "WEIGHT"],
        functions.map(([label, purpose, key]) => [
          `<strong>${label}</strong>`,
          `<span class="muted">${purpose}</span>`,
          `<span class="mono">${number(meta.weights[key])}</span>`,
        ]),
      ),
      "",
      "clip",
    );
  } else if (view === "kl") {
    const spikes = rows.filter((r) => r.kl > 2),
      max = Math.max(16, Math.ceil(peakKL.kl * 1.05));
    content += layout(
      "KL divergence",
      "Distance from the reference model during training",
      plot(seriesFor([["kl", "KL divergence", colors.worker]]), {
        title: "KL divergence during training",
        yRange: [0, max],
        yTicks: max === 16 ? [0, 4, 8, 12, 16] : undefined,
        highlight: [
          peakKL.step,
          peakKL.kl,
          `Step ${peakKL.step} · ${number(peakKL.kl, 2)}`,
        ],
      }),
      `<h2>${spikes.length === 2 ? "Two notable spikes" : `${spikes.length} notable spikes`}</h2><p>${rows.filter((r) => r.kl < 1).length} of ${rows.length} steps remain below 1.0. ${spikes.length} steps exceed 2.0.</p>${infoRow("Average KL", number(avgKL, 3))}${infoRow("Peak KL", number(peakKL.kl, 2), `Step ${peakKL.step}`)}${infoRow("Final KL", number(last.kl, 3))}`,
    );
    content += panel(
      "Divergence events",
      "Steps with KL above 2.0",
      spikes.length
        ? table(
            ["STEP", "KL", "REWARD", "NEXT RECORDED STEP"],
            spikes.map((row) => {
              const next = rows[rows.indexOf(row) + 1];
              return [
                `<strong class="mono">${pad(row.step, 3)}</strong>`,
                `<strong class="mono">${number(row.kl, 3)}</strong>`,
                `<span class="mono">${number(row.reward, 2)}</span>`,
                `<span class="muted">${next ? `KL is ${number(next.kl, 3)} at step ${next.step}` : "No later step recorded"}</span>`,
              ];
            }),
          )
        : '<div class="empty-results">No steps exceeded KL 2.0 in this run.</div>',
      badge(`${spikes.length} events`),
      "clip",
    );
    content += note(
      "Read divergence with the other signals",
      "A spike shows a larger policy change at that step. Check reward, output length, and loss before interpreting its effect.",
    );
  } else if (view === "length") {
    const series = seriesFor([
        ["max_length", "Maximum", colors.muted],
        ["mean_length", "Mean", colors.worker],
        ["min_length", "Minimum", colors.oversight],
      ]),
      max = Math.max(110, ...rows.map((r) => r.max_length * 1.1)),
      delta = first.mean_length
        ? ((last.mean_length - first.mean_length) / first.mean_length) * 100
        : 0,
      clipped = rows.filter((r) => r.clipped_ratio > 0).length;
    content += layout(
      "Completion length",
      "Minimum, mean, and maximum tokens per group",
      plot(series, {
        title: "Completion length during training",
        yRange: [0, max],
        yTicks: max === 110 ? [0, 25, 50, 75, 100] : undefined,
      }),
      `<h2>${delta < 0 ? "Shorter" : "Longer"} at the final step</h2><p>Mean completion length moves from ${number(first.mean_length)} to ${number(last.mean_length)} tokens across the recorded run.</p>${infoRow("Final minimum", `${number(last.min_length, 0)} tokens`)}${infoRow("Final mean", `${number(last.mean_length)} tokens`)}${infoRow("Final maximum", `${number(last.max_length, 0)} tokens`)}`,
    );
    content += smallStats([
      [
        "Starting mean",
        `${number(first.mean_length)} tokens`,
        "The first recorded step.",
      ],
      [
        "Final mean",
        `${number(last.mean_length)} tokens`,
        `${number(Math.abs(delta))}% ${delta < 0 ? "fewer" : "more"} tokens than the first step.`,
      ],
      [
        "Steps with clipping",
        `${clipped} recorded`,
        clipped
          ? "Review the clipping ratio in the exported metrics."
          : "The clipping ratio is zero throughout this run.",
      ],
    ]);
    content += note(
      "Length describes output size",
      "Shorter completions can reduce generation cost. Inspect the actions and outcomes to judge whether useful information was preserved.",
    );
  } else {
    const peak = rows.reduce((a, b) => (a.loss > b.loss ? a : b)),
      low = Math.min(...rows.map((r) => r.loss)),
      avg = average(rows.map((r) => r.loss)),
      min = Math.min(-0.035, low * 1.1),
      max = Math.max(0.12, peak.loss * 1.1);
    content += layout(
      "Training loss",
      `Recorded optimization signal across ${rows.length} steps`,
      plot(seriesFor([["loss", "Training loss", colors.worker]]), {
        title: "Training loss",
        yRange: [min, max],
        yTicks:
          min === -0.035 && max === 0.12
            ? [-0.03, 0, 0.03, 0.06, 0.09, 0.12]
            : undefined,
        highlight: [
          peak.step,
          peak.loss,
          `Step ${peak.step} · ${number(peak.loss, 3)}`,
        ],
      }),
      `<h2>Usually close to zero</h2><p>The loss varies around a small average, with occasional larger updates.</p>${infoRow("Average loss", number(avg, 5))}${infoRow("Lowest loss", number(low, 4))}${infoRow("Final loss", number(last.loss, 4))}`,
    );
    content += smallStats([
      [
        "Largest recorded loss",
        number(peak.loss, 4),
        `At step ${peak.step} of the run.`,
      ],
      [
        "Reference-model distance",
        `${number(avgKL, 3)} avg. KL`,
        "Review divergence alongside the objective.",
      ],
      [
        "Recorded reward",
        `${number(avgReward, 2)} average`,
        "Use episode behavior as a separate evaluation.",
      ],
    ]);
    content += note(
      "Loss is one part of the evaluation",
      "A small optimization loss alone does not establish a robust policy. Compare task completion, violations, and false alarms in the Arena.",
    );
  }
  return (
    content +
    footer(
      `Recorded metrics · ${meta.model} · ${meta.agent} agent`,
      `GRPO  /  LoRA r${meta.lora_rank}  /  ${rows.length} steps`,
    )
  );
}
