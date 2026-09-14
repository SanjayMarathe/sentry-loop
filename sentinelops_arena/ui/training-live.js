import {
  h,
  icon,
  button,
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
  percent,
  loading,
  footer,
} from "./ui.js";
import { activeRun, runProgress } from "./live.js";

const views = [
  ["Reward", "reward"],
  ["Components", "components"],
  ["KL divergence", "kl"],
  ["Completion length", "length"],
  ["Loss", "loss"],
];

export function trainingControls(state) {
  const busy = activeRun(state.trainingJob),
    meta = state.training?.metadata;
  return (
    `<div class="config training-controls"><div class="field"><label for="training-run-select">Training run</label><select id="training-run-select"><option value="recorded" ${state.trainingId === "recorded" ? "selected" : ""}>Bundled Qwen GRPO recording · 216 steps</option>${state.trainingRuns.map((r) => `<option value="${h(r.id)}" ${state.trainingId === r.id ? "selected" : ""}>${h(r.kind === "cpu-policy" ? "CPU policy" : "Qwen GRPO")} · ${r.id.slice(0, 8)} · ${h(r.status)}</option>`).join("")}${state.trainingId !== "recorded" && !state.trainingRuns.some((r) => r.id === state.trainingId) ? `<option value="${h(state.trainingId)}" selected>New run · initializing</option>` : ""}</select></div><span class="config-meta">${meta?.kind === "cpu-policy" ? "CPU · Learned tool-proposal filter" : meta?.kind === "grpo" ? "Language-model optimization" : "Saved historical metrics"}</span>${button(busy ? "Training…" : "Train CPU policy", "train-policy", "primary", "training", busy)}${meta?.kind === "cpu-policy" && meta.status === "completed" && meta.checkpoint_available ? button("Use in Arena", "apply-checkpoint", "secondary", "arrow") : ""}</div>` +
    (state.trainingId === state.trainingJob?.id
      ? runProgress(state.trainingJob)
      : "") +
    runProgress(state.syncJob)
  );
}

export function trainingActions(state) {
  const meta = state.training?.metadata,
    url = meta?.tracking?.url;
  const csv =
    state.trainingId === "recorded"
      ? "/api/training.csv"
      : `/api/training/runs/${state.trainingId}/metrics.csv`;
  return `${state.trainingId !== "recorded" ? button(activeRun(state.syncJob) ? "Syncing…" : "Sync graphs", "sync-training", "secondary", "refresh", activeRun(state.syncJob)) : ""}${url ? `<a class="button" href="${h(url)}" target="_blank" rel="noreferrer">${icon("training", 16)}Hugging Face graphs</a>` : ""}${state.training?.rows.length ? `<a class="button" href="${h(csv)}" download>${icon("download", 16)}Export metrics</a>` : ""}`;
}

export function liveTrainingPage(state, view) {
  const data = state.training,
    meta = data?.metadata,
    rows = data?.rows || [];
  let content =
    header(
      "Training",
      "Optimize real weights. Watch the measurements arrive.",
      trainingActions(state),
    ) + trainingControls(state);
  if (state.errors.training)
    content += note("Training status", state.errors.training);
  if (!rows.length)
    return (
      content +
      (meta?.status === "failed"
        ? note(
            "No training steps completed",
            "Open the run report for the failure details.",
          )
        : loading(
            "Preparing the dataset and training logger. Metrics appear after the first optimizer step…",
          ))
    );
  const first = rows[0],
    last = rows.at(-1),
    cpu = meta.kind === "cpu-policy";
  const fmt = (value, digits = 3) =>
    value == null ? "—" : number(value, digits);
  content += metricStrip(
    cpu
      ? [
          [
            "Validation accuracy",
            percent(last.validation_accuracy),
            `${meta.validation_examples} held-out examples from the same scenario family`,
          ],
          ["Training loss", fmt(last.loss), `Started at ${fmt(first.loss)}`],
          [
            "Optimizer steps",
            String(last.step),
            `${meta.status} · live measurements`,
          ],
          [
            "Unsafe proposals rejected",
            percent(last.malicious_rejection),
            `${percent(last.benign_acceptance)} legitimate proposals accepted`,
          ],
        ]
      : [
          [
            "Latest reward",
            fmt(last.reward),
            "Measured by the reward functions",
          ],
          [
            "Training loss",
            fmt(last.loss),
            "Optimizer loss at the latest step",
          ],
          ["Optimizer steps", String(last.step), meta.status],
          [
            "KL divergence",
            fmt(last.kl),
            "Distance from the reference policy, when logged",
          ],
        ],
  );
  content += tabs(
    views.map(([name, key]) => [name, `/training/${key}`]),
    `/training/${view}`,
    badge(
      `${meta.algorithm} · ${meta.status}`,
      meta.status === "running" ? "blue" : "success",
      true,
    ),
  );
  let specs, title, description, aside;
  if (view === "reward") {
    specs = [
      ["reward", cpu ? "Validation reward" : "Total reward", colors.worker],
    ];
    title = cpu ? "Reward on held-out proposals" : "Training reward";
    description = cpu
      ? "+1 for a correct allow/refuse decision, −1 for an incorrect decision"
      : "Rewards emitted by the GRPO trainer";
    aside = cpu
      ? `<h2>A policy you can apply</h2><p>Weights change after each gradient update. Every validation pass executes the current classifier inside Wasmer.</p><p>After training, choose <strong>Use in Arena</strong> to evaluate this checkpoint against the HTTP target.</p><small>This is a small logistic classifier, separate from Qwen language-model training. The hard policy gate remains independent.</small>`
      : `<h2>${h(meta.model)}</h2><p>These points come from the trainer’s log callback, not the bundled CSV.</p><p>Training runs on ${h(meta.device || "the configured training machine")}.</p>`;
  } else if (view === "components") {
    specs = cpu
      ? [
          ["benign_acceptance", "Legitimate acceptance", colors.worker],
          ["malicious_rejection", "Unsafe rejection", colors.green],
          ["validation_accuracy", "Validation accuracy", colors.oversight],
        ]
      : [
          ["format_exact", "Exact format", colors.green],
          ["format_approx", "Approximate format", colors.oversight],
          ["check_action", "Action correctness", colors.worker],
          ["check_env", "Environment", colors.attacker],
        ];
    title = cpu ? "Acceptance and rejection" : "Reward components";
    description = cpu
      ? "Measured decisions on proposals from held-out seeds"
      : "Only components actually logged by the trainer are shown";
    aside = `<h2>${cpu ? "Both sides of the tradeoff" : "Measured components"}</h2><p>${cpu ? "Rejecting every request would block useful work. Review legitimate acceptance together with unsafe rejection." : "The environment score measures the consequence of the proposed action. Formatting scores measure output structure."}</p>`;
  } else if (view === "kl") {
    specs = [["kl", "KL divergence", colors.worker]];
    title = "Distance from the initial policy";
    description = cpu
      ? "Mean Bernoulli KL between the learned classifier and its initial probabilities"
      : "KL relative to the reference language model, when enabled";
    aside = `<h2>What this measures</h2><p>${cpu ? "The classifier starts by accepting most proposals. KL tracks how its probabilities change as it learns from policy outcomes." : "A changing policy can gain reward while moving away from its reference. Compare KL with behavior on held-out tasks."}</p>`;
  } else if (view === "length" && cpu) {
    return (
      content +
      note(
        "This policy does not generate language tokens",
        "The CPU proposal filter returns an allow/refuse decision. Completion-length measurements belong to language-model GRPO runs; select the Qwen recording or a live GRPO run to view them.",
      ) +
      panel(
        "Actual model output",
        "The trained weights select a tool proposal or an explicit refusal",
        `<pre>{ "tool": "refuse", "arguments": { "reason": "The trained proposal filter rejected this action." } }</pre>`,
      )
    );
  } else if (view === "length") {
    specs = [
      ["mean_length", "Mean tokens", colors.worker],
      ["min_length", "Minimum", colors.green],
      ["max_length", "Maximum", colors.attacker],
    ];
    title = "Completion length";
    description = "Generated token lengths reported by GRPO";
    aside =
      "<h2>Generation behavior</h2><p>Track length together with rewards to detect verbosity changes or truncated completions.</p>";
  } else {
    specs = [
      ["loss", "Training loss", colors.worker],
      ...(cpu ? [["validation_loss", "Validation loss", colors.green]] : []),
    ];
    title = "Optimization loss";
    description = cpu
      ? "Binary cross-entropy from current model predictions"
      : "Actual optimizer loss reported by the GRPO trainer";
    aside = `<h2>${cpu ? "Learning from observed outcomes" : "Optimizer signal"}</h2><p>${cpu ? `${meta.train_examples} measured tool proposals provide the training labels. ${meta.validation_examples} examples from different seeds are held out.` : "Loss is not a standalone measure of agent security. Evaluate the resulting checkpoint on the target service."}</p>${cpu ? "<small>The validation set shares the training scenario family. This is a functional learning demo, not evidence of general security robustness.</small>" : ""}`;
  }
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
    ? `<div class="columns">${panel(title, description, chart(series, { height: 310, xLabel: "Optimizer step", xRange: [first.step, Math.max(first.step + 1, last.step)], title }) + legend(series))}<aside class="aside">${aside}</aside></div>`
    : note(
        "Metric not logged yet",
        "This run has not emitted values for this chart. Missing metrics are not filled with artificial zeroes.",
      );
  const tracking = meta.tracking;
  if (tracking?.status === "error")
    content += note(
      "Hugging Face sync needs attention",
      `${tracking.error} Metrics and checkpoint data are saved locally.`,
    );
  else if (tracking?.mode === "static")
    content += note(
      "Hugging Face run snapshot",
      "The app updates during optimization. The free Hugging Face Trackio Space is synchronized when the run finishes.",
    );
  return (
    content +
    footer(
      `${meta.model} · ${meta.algorithm} · ${meta.device}`,
      `${last.step} real optimizer steps · ${meta.id.slice(0, 8)}`,
    )
  );
}
