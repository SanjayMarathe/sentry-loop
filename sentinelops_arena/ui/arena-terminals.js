import { icon, policyName } from "./ui.js";
import {
  terminalEntryLines as entryLines,
  safeTraceText as safeText,
  agentShellIdentity,
  shellPrompt,
} from "./arena-terminal-format.js";

const agents = [
  {
    role: "attacker",
    name: "Attacker",
    team: "Red team",
  },
  {
    role: "worker",
    name: "Worker",
    team: "Blue team",
  },
  {
    role: "oversight",
    name: "Auditor",
    team: "Oversight",
  },
];
const RESET = "\x1b[0m";
const DIM = "\x1b[38;2;179;179;179m";
const CLEAR = "\x1b[0m\x1b[?25l\x1b[2J\x1b[3J\x1b[H";
const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
let controller = null;
let vendorPromise = null;
let requestedFocus = null;

export function terminalSection(state) {
  const open = state.terminalsOpen !== false;
  return `<section id="arena-terminals" class="arena-terminals" aria-labelledby="arena-terminals-title">
    <div class="arena-terminals-heading"><div><h2 id="arena-terminals-title">Agent terminals · replay</h2><p>Calls and messages from the replay.</p></div><button type="button" class="button secondary arena-terminals-toggle" data-action="toggle-terminals" aria-expanded="${open}" aria-controls="arena-terminals-host">${icon(open ? "down" : "chevron", 15)}<span>${open ? "Collapse" : "Open"}</span></button></div>
    <div id="arena-terminals-host" class="arena-terminals-host" ${open ? "" : "hidden"}>
      ${agents
        .map(
          (
            agent,
          ) => `<article class="agent-terminal ${agent.role} ${agent.role !== "attacker" ? "without-window-controls" : ""}" data-terminal-role="${agent.role}" aria-labelledby="terminal-${agent.role}-title">
        <div class="agent-terminal-heading">${agent.role === "attacker" ? `<span class="terminal-window-controls" aria-hidden="true"><i class="terminal-window-close"></i><i class="terminal-window-minimize"></i><i class="terminal-window-zoom"></i></span>` : ""}<button type="button" class="agent-terminal-focus" data-action="focus-terminal" data-role="${agent.role}" aria-label="Focus ${agent.name} transcript"><span><strong id="terminal-${agent.role}-title">${agentShellIdentity(agent.role)} — ~</strong><small>episode replay</small></span></button><span class="agent-terminal-status"><span data-terminal-status>Ready</span></span></div>
        <div class="agent-terminal-meta"><span>READ-ONLY REPLAY</span><span data-terminal-count>0 actions</span></div>
        <div id="terminal-${agent.role}" class="agent-terminal-viewport" aria-label="${agent.name} recorded action transcript"><p class="agent-terminal-loading">Preparing ${agent.name.toLowerCase()} transcript…</p></div>
        <details class="agent-terminal-text"><summary>Plain-text transcript</summary><pre tabindex="0" aria-label="${agent.name} plain-text transcript" data-terminal-plaintext>Awaiting an episode.</pre></details>
      </article>`,
        )
        .join("")}
    </div>
    <p class="arena-terminals-closed" ${open ? "hidden" : ""}>Select an agent in the graph or open terminals to follow the replay.</p>
  </section>`;
}

function introLines(agent, episode, replayUrl) {
  return [
    {
      text: episode
        ? `# Episode ${safeText(episode.seed)} · ${policyName(episode.policy)} · recorded commands`
        : "# Run an episode to begin.",
      dim: true,
    },
    ...(agent.role === "worker" && replayUrl
      ? [{ text: `# metrics: ${replayUrl}`, dim: true }]
      : []),
    { text: "" },
  ];
}

function coloredPrompt(role) {
  return `\x1b[1;38;2;138;226;52m${agentShellIdentity(role)}${RESET}:\x1b[1;38;2;114;159;239m~${RESET}$ `;
}

function terminalText(lines) {
  const tones = {
    added: "\x1b[38;2;168;225;128m\x1b[48;2;15;42;12m",
    removed: "\x1b[38;2;255;166;155m\x1b[48;2;54;15;13m",
  };
  return lines
    .map((line) => {
      if (line.prompt !== undefined) {
        return `${coloredPrompt(line.commandRole)}${line.command || ""}${RESET}\r\n`;
      }
      const tone = tones[line.tone];
      return `${line.bold ? "\x1b[1m" : ""}${tone || (line.dim ? DIM : "")}${line.text}${tone ? "\x1b[K" : ""}${RESET}\r\n`;
    })
    .join("");
}

function cancelTyping(instance) {
  if (instance.typing) clearTimeout(instance.typing.timer);
  instance.typing = null;
  instance.generation = (instance.generation || 0) + 1;
  instance.mount.dataset.typing = "false";
}

function renderHistory(current, instance, agent, lines, follow) {
  cancelTyping(instance);
  const generation = instance.generation;
  instance.hasPrompt = true;
  instance.terminal.write(
    `${CLEAR}${terminalText(lines)}${coloredPrompt(agent.role)}\x1b[?25h`,
    () => {
      if (
        current !== controller ||
        current.disposed ||
        generation !== instance.generation
      )
        return;
      if (follow) instance.terminal.scrollToBottom();
    },
  );
}

function typeCommand(current, instance, agent, lines, history, follow) {
  cancelTyping(instance);
  const generation = instance.generation;
  const [commandLine, ...output] = lines;
  const characters = Array.from(commandLine.command);
  const animation = { written: 0, started: performance.now(), timer: null };
  instance.typing = animation;
  instance.mount.dataset.typing = "true";
  const active = () =>
    current === controller &&
    !current.disposed &&
    instance.generation === generation &&
    instance.typing === animation;
  const step = () => {
    if (!active()) return;
    if (!current.state.playback.playing || reducedMotion()) {
      renderHistory(current, instance, agent, history, follow);
      return;
    }
    const duration = Math.min(500, 520 / (current.state.playback.speed || 1));
    const count = Math.min(
      characters.length,
      Math.max(
        animation.written + 1,
        Math.floor(
          (characters.length * (performance.now() - animation.started)) /
            duration,
        ),
      ),
    );
    const chunk = characters.slice(animation.written, count).join("");
    animation.written = count;
    instance.terminal.write(chunk, () => {
      if (!active()) return;
      if (follow) instance.terminal.scrollToBottom();
      if (count < characters.length) {
        animation.timer = setTimeout(step, 18);
      } else {
        instance.terminal.write(
          `${RESET}\r\n${terminalText(output)}${coloredPrompt(agent.role)}\x1b[?25h`,
          () => {
            if (!active()) return;
            instance.typing = null;
            instance.hasPrompt = true;
            instance.mount.dataset.typing = "false";
            if (follow) instance.terminal.scrollToBottom();
          },
        );
      }
    });
  };
  instance.terminal.write(
    `${instance.hasPrompt ? "\r\x1b[2K" : ""}${coloredPrompt(agent.role)}\x1b[?25h`,
    () => {
      if (!active()) return;
      animation.started = performance.now();
      step();
    },
  );
  instance.hasPrompt = false;
}

function snapshot(state) {
  const episode = state.episode || null;
  const log = Array.isArray(episode?.log) ? episode.log : [];
  const selected = Number(state.replay?.selected ?? 0);
  const cursor = log.length
    ? Math.max(
        0,
        Math.min(
          log.length - 1,
          Number.isFinite(selected) ? Math.floor(selected) : 0,
        ),
      )
    : -1;
  return { episode, log, cursor, current: log[cursor] };
}

function updateTranscripts(current) {
  if (current !== controller || current.disposed) return;
  const { episode, log, cursor, current: selected } = snapshot(current.state);
  for (const agent of agents) {
    const panel = current.host.querySelector(
      `[data-terminal-role="${agent.role}"]`,
    );
    if (!panel) continue;
    const rows = log
      .slice(0, cursor + 1)
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.agent === agent.role);
    panel.classList.toggle("is-current", selected?.agent === agent.role);
    panel.querySelector("[data-terminal-count]").textContent =
      `${rows.length} action${rows.length === 1 ? "" : "s"}`;
    const latest = rows.at(-1)?.entry;
    panel.querySelector("[data-terminal-status]").textContent = latest
      ? selected?.agent === agent.role
        ? `Tick ${latest.tick}`
        : `Last T${String(latest.tick).padStart(2, "0")}`
      : episode
        ? "Waiting"
        : "Ready";
    const lines = [
      ...introLines(
        agent,
        episode,
        current.state.config?.training_replay?.url,
      ),
      ...rows.flatMap(({ entry, index }) => entryLines(entry, index)),
    ];
    const plain = panel.querySelector("[data-terminal-plaintext]");
    const plainText = `${lines.map((line) => line.text).join("\n")}\n${shellPrompt(agent.role)}`;
    if (plain.textContent !== plainText) plain.textContent = plainText;
    const instance = current.instances.get(agent.role);
    if (!instance) continue;
    const rebuild =
      instance.episode !== episode ||
      instance.log !== log ||
      cursor < instance.cursor ||
      instance.cursor === undefined;
    const newLines = rebuild
      ? lines
      : rows
          .filter(({ index }) => index > instance.cursor)
          .flatMap(({ entry, index }) => entryLines(entry, index));
    if (
      rebuild ||
      newLines.length ||
      (instance.typing && !current.state.playback.playing)
    ) {
      const terminal = instance.terminal;
      const follow =
        rebuild ||
        terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
      if (
        !rebuild &&
        !instance.typing &&
        newLines.length &&
        current.state.playback.playing &&
        !reducedMotion() &&
        newLines.filter((line) => line.prompt !== undefined).length === 1
      ) {
        typeCommand(current, instance, agent, newLines, lines, follow);
      } else {
        renderHistory(current, instance, agent, lines, follow);
      }
    }
    instance.episode = episode;
    instance.log = log;
    instance.cursor = cursor;
  }
}

function visible(element) {
  return (
    element?.isConnected && element.clientWidth > 0 && element.clientHeight > 0
  );
}

function scheduleFit(current) {
  if (current !== controller || current.disposed || current.frame) return;
  current.frame = requestAnimationFrame(() => {
    current.frame = null;
    if (current !== controller || current.disposed) return;
    for (const instance of current.instances.values()) {
      if (visible(instance.mount)) instance.fit.fit();
    }
  });
}

async function initialize(current) {
  if (
    current.initializing ||
    current.disposed ||
    current !== controller ||
    current.host.hidden
  )
    return;
  current.initializing = true;
  try {
    vendorPromise ||= import("./vendor/terminal-vendor.js");
    const { Terminal, FitAddon } = await vendorPromise;
    if (
      current !== controller ||
      current.disposed ||
      !current.host.isConnected ||
      current.host.hidden
    )
      return;
    for (const agent of agents) {
      if (current.instances.has(agent.role)) continue;
      const mount = current.host.querySelector(`#terminal-${agent.role}`);
      if (!visible(mount)) continue;
      const terminal = new Terminal({
        cols: 48,
        rows: 16,
        disableStdin: true,
        convertEol: true,
        cursorBlink: !reducedMotion(),
        cursorStyle: "block",
        cursorInactiveStyle: "block",
        fontFamily: 'Menlo, Monaco, "SFMono-Regular", Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.35,
        scrollback: 3000,
        screenReaderMode: true,
        allowProposedApi: false,
        theme: {
          background: "#000000",
          foreground: "#F2F2F2",
          cursor: "#BEBEBE",
          selectionBackground: "#505050",
          black: "#000000",
          brightBlack: "#B3B3B3",
          red: "#F2F2F2",
          brightRed: "#FFFFFF",
          blue: "#F2F2F2",
          brightBlue: "#FFFFFF",
          yellow: "#F2F2F2",
          brightYellow: "#FFFFFF",
          green: "#F2F2F2",
          brightGreen: "#FFFFFF",
          magenta: "#F2F2F2",
          brightMagenta: "#FFFFFF",
          cyan: "#F2F2F2",
          brightCyan: "#FFFFFF",
          white: "#F2F2F2",
          brightWhite: "#FFFFFF",
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      mount.replaceChildren();
      terminal.open(mount);
      terminal.textarea?.setAttribute(
        "aria-label",
        `${agent.name} read-only episode transcript`,
      );
      terminal.textarea?.setAttribute("readonly", "");
      terminal.textarea?.setAttribute("aria-readonly", "true");
      current.instances.set(agent.role, { terminal, fit, mount });
    }
    updateTranscripts(current);
    scheduleFit(current);
    if (requestedFocus) focusTerminal(requestedFocus);
  } catch (error) {
    if (current !== controller || current.disposed) return;
    vendorPromise = null;
    current.failed = true;
    for (const panel of current.host.querySelectorAll(".agent-terminal")) {
      const mount = panel.querySelector(".agent-terminal-viewport");
      if (!mount.querySelector(".xterm"))
        mount.textContent =
          "Terminal renderer unavailable. The full transcript is below.";
      panel.querySelector("details").open = true;
    }
  } finally {
    current.initializing = false;
  }
}

// The caller retains the host during app renders, so xterm's canvas, scroll
// position, selection, and buffers survive each playback tick.
export function syncTerminals(host, state) {
  if (!host?.isConnected) return;
  if (!controller || controller.host !== host) {
    destroyTerminals();
    const current = {
      host,
      state,
      instances: new Map(),
      initializing: false,
      disposed: false,
      frame: null,
      failed: false,
    };
    controller = current;
    current.observer = new ResizeObserver(() => {
      if (current !== controller || current.disposed) return;
      if (!current.failed && current.instances.size < agents.length)
        void initialize(current);
      scheduleFit(current);
    });
    current.observer.observe(host);
    for (const mount of host.querySelectorAll(".agent-terminal-viewport"))
      current.observer.observe(mount);
    if (document.fonts?.ready)
      document.fonts.ready.then(() => scheduleFit(current));
  }
  controller.state = state;
  host.hidden = state.terminalsOpen === false;
  updateTranscripts(controller);
  if (!controller.failed && controller.instances.size < agents.length)
    void initialize(controller);
  scheduleFit(controller);
}

export function focusTerminal(role) {
  if (!agents.some((agent) => agent.role === role)) return false;
  requestedFocus = role;
  if (!controller || controller.disposed) return false;
  for (const panel of controller.host.querySelectorAll(".agent-terminal")) {
    panel.classList.toggle("is-focused", panel.dataset.terminalRole === role);
    if (panel.dataset.terminalRole === role) {
      const plainText = panel.querySelector(".agent-terminal-text");
      if (plainText) plainText.open = false;
    }
  }
  const instance = controller.instances.get(role);
  if (!instance || !visible(instance.mount)) return false;
  instance.fit.fit();
  instance.terminal.focus();
  return true;
}

export function destroyTerminals() {
  const current = controller;
  controller = null;
  requestedFocus = null;
  if (!current) return;
  current.disposed = true;
  current.observer?.disconnect();
  if (current.frame) cancelAnimationFrame(current.frame);
  for (const instance of current.instances.values()) {
    cancelTyping(instance);
    // Disposing a terminal also disposes every addon loaded into it.
    instance.terminal.dispose();
  }
  current.instances.clear();
}
