// Terminal styling follows recorded outcomes. The +/- markers identify writes
// and rejected/flagged operations; they never invent a before/after state diff.
const WRITES = new Set([
  "add_note",
  "apply_credit",
  "generate_invoice",
  "create_ticket",
]);
const UPDATES = new Set([
  "update_tier",
  "issue_refund",
  "assign_ticket",
  "escalate_ticket",
  "resolve_ticket",
  "launch_attack",
]);
const SHELL_IDENTITIES = Object.freeze({
  attacker: "attacker@root",
  worker: "worker@root",
  oversight: "auditor@loop",
});

export function agentShellIdentity(role) {
  return Object.hasOwn(SHELL_IDENTITIES, role)
    ? SHELL_IDENTITIES[role]
    : "agent@loop";
}

export function shellPrompt(role) {
  return `${agentShellIdentity(role)}:~$ `;
}

// A visual idle prompt, with no command to execute or synthesize.
export function idlePromptLine(role) {
  const prompt = shellPrompt(role);
  return { text: prompt, prompt, command: "", commandRole: role, bold: true };
}

// Trace text is data. Escape controls before the renderer adds its own ANSI so
// an injected message cannot clear the screen, issue OSC commands, or move the
// cursor to impersonate another transcript entry. Newlines become indented
// field continuations below.
export function safeTraceText(value) {
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(
      /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
}

function shellQuote(value) {
  const singleLine = safeTraceText(value).replaceAll("\n", "\\n");
  return `'${singleLine.replaceAll("'", "'\"'\"'")}'`;
}

function shellValue(value) {
  if (
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return String(value);
  }
  let compact;
  try {
    compact = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    compact = String(value);
  }
  return shellQuote(compact ?? String(value));
}

// These are the recorded tool name and arguments presented as a shell command.
// The display never sends this text to Bash or adds fictitious OS operations.
function traceCommand(entry) {
  const action = safeTraceText(entry.action_type || "action").replaceAll(
    "\n",
    "\\n",
  );
  const tool = /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(action)
    ? action
    : shellQuote(action);
  const parameters =
    entry.parameters && typeof entry.parameters === "object"
      ? Object.entries(entry.parameters)
      : [];
  const argumentsText = parameters.map(([key, value]) => {
    const flag = `--${safeTraceText(key).replaceAll("_", "-").replaceAll("\n", "\\n")}`;
    const name = /^--[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(flag)
      ? flag
      : shellQuote(flag);
    return `${name} ${shellValue(value)}`;
  });
  return [tool, ...argumentsText].join(" ");
}

function textLine(text, options = {}) {
  const prefix =
    options.tone === "added" ? "+ " : options.tone === "removed" ? "- " : "";
  return { text: `${prefix}${text}`, ...options };
}

function field(label, value, options = {}) {
  if (value === undefined || value === null || value === "") return [];
  const lines = safeTraceText(value).split("\n");
  return [
    textLine(`${label ? `${label} ` : ""}${lines[0]}`, options),
    ...lines
      .slice(1)
      .map((text) => textLine(`${label ? "  " : ""}${text}`, options)),
  ];
}

function outcomeStyle(entry) {
  const action = entry.action_type;
  const flagged =
    entry.agent === "oversight" && (entry.flag === true || action === "flag");
  if (flagged) return { tone: "removed", label: "FLAGGED" };

  // This whitelist is the original environment's registered mutation tools.
  // Action names containing "write" or "update" are not sufficient evidence.
  const operation = WRITES.has(action)
    ? "WRITE"
    : UPDATES.has(action)
      ? "UPDATE"
      : null;
  if (!operation) return {};
  const result =
    entry.result && typeof entry.result === "object" ? entry.result : {};
  const details =
    result.details && typeof result.details === "object"
      ? result.details
      : result;
  const failed =
    Boolean(result.error || details.error) ||
    result.success === false ||
    details.success === false;
  if (failed) return { tone: "removed", label: "REJECTED" };
  // The billing implementation reports success for approval requests before a
  // refund is applied. Preserve that distinction from a completed write.
  if (
    result.status === "pending_approval" ||
    details.status === "pending_approval"
  ) {
    return { label: `PENDING ${operation}`, dim: true };
  }
  if (result.success === true || details.success === true) {
    return { tone: "added", label: operation };
  }
  return { label: `${operation} ATTEMPT`, dim: true };
}

/**
 * Return transcript lines with plain text and optional bold/dim/added/removed
 * presentation hints. No DOM, ANSI styling, environment changes, or generated
 * observations are performed here.
 */
export function terminalEntryLines(entry, index) {
  const action = safeTraceText(entry.action_type || "action").replaceAll(
    "\n",
    "\\n",
  );
  const style = outcomeStyle(entry);
  const colored = style.tone ? { tone: style.tone } : {};
  const prompt = shellPrompt(entry.agent);
  const command = traceCommand(entry);
  const lines = [
    {
      text: `${prompt}${command}`,
      prompt,
      command,
      commandRole: entry.agent,
      actionIndex: index,
      tick: entry.tick,
      bold: true,
    },
  ];
  if (style.label) {
    lines.push(
      textLine(`${style.label} ${action}`, {
        bold: true,
        ...(style.dim ? { dim: true } : {}),
        ...colored,
      }),
    );
  }
  if (entry.agent === "worker" && entry.task) {
    const task = entry.task;
    if (typeof task === "object") {
      lines.push(
        ...field(
          "task:",
          [task.task_id, task.task_type].filter(Boolean).join(" / "),
          { dim: true },
        ),
        ...field("request:", task.message),
      );
    } else lines.push(...field("task:", task));
  }
  if (entry.agent === "attacker" && entry.parameters?.attack_type) {
    lines.push(...field("attack:", entry.parameters.attack_type));
  }
  // Every parameter is retained in the command, so a duplicate log block is
  // unnecessary. Keep legacy detail text when structured parameters are absent.
  if (
    (!entry.parameters || !Object.keys(entry.parameters).length) &&
    entry.details
  )
    lines.push(...field("details:", entry.details, colored));
  if (entry.response) lines.push(...field("response:", entry.response));
  if (entry.agent === "oversight") {
    if (typeof entry.flag === "boolean") {
      lines.push(textLine(entry.flag ? "flagged" : "approved", colored));
    }
    lines.push(...field("audit:", entry.explanation, colored));
  } else if (entry.result !== undefined && entry.result !== null) {
    lines.push(
      ...field(
        typeof entry.result === "object" ? "" : "result:",
        entry.result,
        colored,
      ),
    );
  }
  const reward = Number(entry.reward);
  if (Number.isFinite(reward)) {
    lines.push({
      text: `reward: ${reward > 0 ? "+" : ""}${reward.toFixed(2)}`,
      dim: true,
    });
  }
  lines.push({ text: "" });
  return lines;
}
