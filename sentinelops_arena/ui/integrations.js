import {
  h,
  icon,
  button,
  badge,
  header,
  panel,
  note,
  linkButton,
} from "./ui.js";

export function connectionsPage(state) {
  const providers = state.connections?.providers || {};
  const status = (provider) => provider?.status || "not_configured";
  const cards = [
    [
      "Tenki Cloud",
      "Application hosting",
      "Tenki hosts the redesigned app, including the original three-agent OpenEnv episodes and comparisons.",
      status(providers.tenki),
      "https://tenki.cloud/docs/sandbox/sdk",
    ],
    [
      "Hugging Face",
      "GRPO training graphs",
      "The training Space displays the original Qwen recording and metrics logged by new GRPO training runs.",
      status(providers.huggingface),
      providers.huggingface?.trackio_url ||
        "https://huggingface.co/docs/trackio/quickstart",
    ],
    [
      "Wasmer",
      "Optional sandbox SDK",
      "The SDK and its separate execution experiments are retained. The main Arena uses the original OpenEnv environment and agent loop.",
      providers.wasmer?.sdk_version ? "SDK installed" : "not_installed",
      "https://docs.wasmer.io/runtime/python/",
    ],
    [
      "OpenAI",
      "Optional model provider",
      "The account is available for model integration. The original demo’s baseline and resilient workers are heuristic policies.",
      status(providers.openai),
      "https://developers.openai.com/api/docs/",
    ],
  ];
  let content = header(
    "Connections",
    "Hosting and training services for the three-agent Arena.",
    button(
      state.pending.connections ? "Checking…" : "Verify accounts",
      "check-connections",
      "primary",
      "refresh",
      state.pending.connections,
    ),
  );
  if (state.errors.connections)
    content += note("Connection check", state.errors.connections);
  content += `<div class="connection-grid">${cards.map(([name, purpose, copy, state, url]) => `<section class="panel connection-card"><div class="connection-heading"><h2>${name}</h2>${badge(state.replaceAll("_", " "), state === "authenticated" ? "success" : "", true)}</div><h3>${purpose}</h3><p>${copy}</p><a class="text-button" href="${h(url)}" target="_blank" rel="noreferrer">${name === "Hugging Face" ? "Training graphs" : "Documentation"} ${icon("arrow", 13)}</a></section>`).join("")}</div>`;
  content += note(
    "Arena episodes are ready to run",
    "The original Arena, policy comparison, environment inspector, and recorded GRPO charts work without unlocking account controls.",
  );
  if (state.connections?.public)
    content += panel(
      "Owner controls",
      "Use the application control token to verify or manage connected accounts.",
      `<div class="connection-body"><label for="control-token">Sentry control token</label><div class="control-unlock"><input id="control-token" type="password" autocomplete="off" placeholder="Enter your application control token"><button class="button primary" data-action="unlock-controls">Unlock controls</button><button class="button" data-action="lock-controls">Lock</button></div><p class="muted">Provider credentials stay on the server.</p></div>`,
    );
  return (
    content +
    panel(
      "Training the original agents",
      "Worker, Attacker, and Oversight use the same GRPO training entry point.",
      `<div class="connection-body"><pre>uv run --extra train python train.py --agent all --device cuda</pre><p>The current trainer runs the roles sequentially. New measurements appear in Training when this app shares the trainer’s data directory.</p>${linkButton("GRPO training guide", "/guide#grpo-training", "secondary", "book")}</div>`,
    )
  );
}
