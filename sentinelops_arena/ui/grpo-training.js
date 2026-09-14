import {
  h,
  icon,
  badge,
  header,
  tabs,
  metricStrip,
  panel,
  note,
  chart,
  legend,
  colors,
  number,
  loading,
  footer,
  linkButton,
} from "./ui.js";

const views = [
  ["Reward", "reward"],
  ["Components", "components"],
  ["KL divergence", "kl"],
  ["Completion length", "length"],
  ["Loss", "loss"],
];

export function trainingControls(state) {
  const runs = state.trainingRuns.filter((run) => run.kind === "grpo");
  return `<div class="config training-controls"><div class="field"><label for="training-run-select">GRPO training run</label><select id="training-run-select"><option value="recorded" ${state.trainingId === "recorded" ? "selected" : ""}>Worker · Qwen2.5-1.5B · Recorded 216-step run</option>${runs.map((run) => `<option value="${h(run.id)}" ${state.trainingId === run.id ? "selected" : ""}>${h(run.agent)} · ${h(run.model)} · ${h(run.status)}</option>`).join("")}</select></div><span class="config-meta">LLM agents · Group Relative Policy Optimization</span></div>`;
}

export function trainingActions(state) {
  const url =
    state.training?.metadata?.tracking?.url ||
    state.connections?.providers?.huggingface?.trackio_url;
  const replayUrl =
    state.connections?.providers?.huggingface?.replay_url ||
    (url?.endsWith("/sentry-loop-training") ? `${url}-replay` : null);
  const csv =
    state.trainingId === "recorded"
      ? "/api/training.csv"
      : `/api/training/runs/${state.trainingId}/metrics.csv`;
  return (
    linkButton("Training setup", "/guide#grpo-training", "secondary", "book") +
    (url
      ? `<a class="button" href="${h(url)}" target="_blank" rel="noreferrer">${icon("training", 16)}Hugging Face graphs</a>`
      : "") +
    (replayUrl
      ? `<a class="button primary" href="${h(replayUrl)}" target="_blank" rel="noreferrer">${icon("play", 16)}Live metric replay</a>`
      : "") +
    (state.training?.rows.length
      ? `<a class="button" href="${h(csv)}" download>${icon("download", 16)}Export metrics</a>`
      : "")
  );
}

export function grpoTrainingPage(state, view) {
  const data = state.training,
    meta = data?.metadata,
    rows = data?.rows || [];
  let content =
    header(
      "Training",
      "GRPO learning signals for the Arena’s agents.",
      trainingActions(state),
    ) + trainingControls(state);
  if (state.errors.training)
    content += note("Training status", state.errors.training);
  if (!meta || !rows.length)
    return (
      content +
      (meta?.status === "failed"
        ? note(
            "Training did not emit metrics",
            "Inspect the trainer output for the failure details.",
          )
        : loading("Waiting for the GRPO trainer’s first logged step…"))
    );
  const first = rows[0],
    last = rows.at(-1),
    fmt = (v) => (v == null ? "—" : number(v, 3));
  content += metricStrip([
    [
      "Latest reward",
      fmt(last.reward),
      "Measured by the original role reward functions",
    ],
    ["Training loss", fmt(last.loss), "Actual GRPO optimizer loss"],
    ["Optimizer steps", String(last.step), `${meta.agent} · ${meta.status}`],
    [
      "KL divergence",
      fmt(last.kl),
      "Distance from the reference language model",
    ],
  ]);
  content += tabs(
    views.map(([name, key]) => [name, `/training/${key}`]),
    `/training/${view}`,
    badge(`${meta.agent} · ${meta.status}`, "blue", true),
  );
  const configurations = {
    reward: [
      "Training reward",
      "Environment, action, and formatting rewards",
      [["reward", "Total reward", colors.worker]],
    ],
    components: [
      "Reward components",
      "Each agent is scored for its role in the enterprise environment",
      [
        ["format_exact", "Exact format", colors.green],
        ["format_approx", "Approximate format", colors.oversight],
        ["check_action", "Action correctness", colors.worker],
        ["check_env", "Environment reward", colors.attacker],
      ],
    ],
    kl: [
      "KL divergence",
      "Distance from the reference language model",
      [["kl", "KL divergence", colors.worker]],
    ],
    length: [
      "Completion length",
      "Token lengths emitted by the language-model trainer",
      [
        ["mean_length", "Mean tokens", colors.worker],
        ["min_length", "Minimum", colors.green],
        ["max_length", "Maximum", colors.attacker],
      ],
    ],
    loss: [
      "Optimization loss",
      "Actual loss emitted after gradient updates",
      [["loss", "Training loss", colors.worker]],
    ],
  };
  const [title, description, specs] =
    configurations[view] || configurations.reward;
  const series = specs
    .map(([key, name, color]) => ({
      name,
      color,
      points: rows
        .filter((r) => r[key] != null && Number.isFinite(r[key]))
        .map((r) => [r.step, r[key]]),
    }))
    .filter((s) => s.points.length);
  content += series.length
    ? `<div class="columns">${panel(title, description, chart(series, { height: 310, xLabel: "Optimizer step", xRange: [first.step, Math.max(first.step + 1, last.step)], title }) + legend(series))}<aside class="aside"><h2>${h(meta.agent)} agent</h2><p>${h(meta.model)}</p><p>These measurements come from the GRPO trainer for the original enterprise environment. Its other roles provide the surrounding episode behavior.</p><small>Training status: ${h(meta.status)} · Device: ${h(meta.device || "Configured training machine")}</small></aside></div>`
    : note(
        "Metric not logged",
        "The trainer has not emitted values for this chart. Missing values remain empty.",
      );
  if (meta.tracking?.status === "error")
    content += note("Graph publication needs attention", meta.tracking.error);
  return (
    content +
    footer(
      `${meta.model} · GRPO · ${meta.agent}`,
      `${last.step} measured optimizer steps`,
    )
  );
}
