// A view of recorded episode actions, never a simulation of private reasoning.
// This module is DOM-free; the renderer owns layout, escaping, and animation.
import { titleCase } from "./ui.js";

const PALETTE = {
  attacker: "#FF7894",
  worker: "#789BFF",
  oversight: "#E4C66E",
  system: "#91B5D2",
  request: "#B6A3E3",
  positive: "#79D5B4",
  negative: "#FF7894",
  neutral: "#9AA8BF",
};
const AGENTS = [
  [
    "attacker",
    "Attacker",
    "Red team — launches attacks against the enterprise environment.",
  ],
  [
    "worker",
    "Worker",
    "Blue team — executes customer tasks through enterprise tools.",
  ],
  [
    "oversight",
    "Auditor",
    "Oversight — reviews the worker's recorded action and flags violations.",
  ],
];
const SYSTEMS = [
  ["crm", "CRM", "Customer records and schemas."],
  ["billing", "Billing", "Balances, invoices, refunds, and refund policies."],
  ["ticketing", "Ticketing", "Support tickets, resolutions, and SLA rules."],
];
const SYSTEM_IDS = new Set(SYSTEMS.map(([id]) => id));
const TOOL_SYSTEM = {
  lookup_customer: "crm",
  issue_refund: "billing",
  check_balance: "billing",
  create_ticket: "ticketing",
  resolve_ticket: "ticketing",
};

function readable(value, max = 1200) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function knownSystems(values) {
  return [...new Set(values.filter((value) => SYSTEM_IDS.has(value)))];
}

// Tool routing mirrors the original environment. A task may require a different
// system from the one the worker actually called; do not conflate the two.
function actionSystems(entry) {
  const params = entry.parameters || {};
  if (entry.agent === "attacker") {
    return entry.action_type === "launch_attack"
      ? knownSystems([params.target_system || entry.target_system])
      : [];
  }
  if (entry.agent !== "worker" || entry.action_type === "respond") return [];
  if (Object.hasOwn(TOOL_SYSTEM, entry.action_type))
    return [TOOL_SYSTEM[entry.action_type]];
  if (entry.action_type === "get_schema")
    return knownSystems([params.system || "crm"]);
  if (entry.action_type === "get_current_policy") {
    return [params.policy_type === "sla" ? "ticketing" : "billing"];
  }
  return knownSystems([
    params.system,
    params.target_system,
    entry.target_system,
  ]);
}

function recordedOutcome(entry) {
  const result = entry.result || {};
  const details = result.details || result;
  const error = readable(details.error || result.error);
  const response = readable(entry.response);
  if (entry.agent === "attacker") {
    if (entry.action_type === "pass") {
      return {
        label: "Idle",
        color: PALETTE.neutral,
        description: "The attacker recorded a pass this tick.",
      };
    }
    const payload = readable(entry.parameters?.injected_message);
    return {
      label: "Launched",
      color: PALETTE.attacker,
      description: payload
        ? `Recorded attack payload: ${payload}`
        : `Recorded attack: ${titleCase(readable(entry.parameters?.attack_type || entry.action_type))}.`,
    };
  }
  if (entry.agent === "oversight") {
    if (entry.flag === true || entry.action_type === "flag") {
      return {
        label: "Flagged",
        color: PALETTE.oversight,
        description:
          readable(entry.explanation) || "The auditor recorded a flag.",
      };
    }
    if (entry.flag === false || entry.action_type === "approve") {
      return {
        label: "Approved",
        color: PALETTE.positive,
        description:
          readable(entry.explanation) || "The auditor recorded an approval.",
      };
    }
    return {
      label: "Recorded",
      color: PALETTE.neutral,
      description:
        readable(entry.explanation) || "No auditor verdict was recorded.",
    };
  }
  if (error)
    return { label: "Rejected", color: PALETTE.negative, description: error };
  if (response) {
    const refused =
      /cannot|refus|social engineering|suspicious|official channels/i.test(
        response,
      );
    return {
      label: refused ? "Refused" : "Replied",
      color: refused ? PALETTE.worker : PALETTE.neutral,
      description: response,
    };
  }
  if (result.success === false || details.success === false) {
    return {
      label: "Not completed",
      color: PALETTE.negative,
      description: "The recorded result reports success: false.",
    };
  }
  if (result.success === true || details.success === true) {
    return {
      label: "Passed",
      color: PALETTE.positive,
      description: "The recorded tool result reports success: true.",
    };
  }
  return {
    label: "Called",
    color: PALETTE.neutral,
    description: "This tool call was recorded without a success result.",
  };
}

function actionLabel(entry) {
  if (entry.agent === "attacker") {
    return entry.action_type === "pass"
      ? "No attack"
      : titleCase(readable(entry.parameters?.attack_type || entry.action_type));
  }
  if (entry.agent === "oversight") {
    return entry.action_type === "flag"
      ? "Flag action"
      : entry.action_type === "approve"
        ? "Approve action"
        : titleCase(readable(entry.action_type));
  }
  return titleCase(readable(entry.action_type)) || "Worker action";
}

/**
 * Build an inclusive, bounded view of episode.log through cursor.
 *
 * Anchors use agent:<role> and system:<name>. Every other node carries the
 * exact actionIndex that produced it, with IDs action:<index>, outcome:<index>,
 * or request:<index>. Link endpoints are stable string IDs. No future actions
 * are read. A negative cursor (or absent episode) returns six anchors connected
 * by capability links. These persistent links describe the original topology;
 * only dynamic links represent recorded actions.
 * Default: 18 actions, at most 60 nodes; windowSize is capped at 18.
 */
export function buildArenaGraph(episode, cursor, options = {}) {
  const log = Array.isArray(episode?.log) ? episode.log : [];
  const requestedWindow = Number(options.windowSize ?? 18);
  const windowSize = Number.isFinite(requestedWindow)
    ? Math.max(1, Math.min(18, Math.floor(requestedWindow)))
    : 18;
  const requestedCursor = Number(cursor ?? -1);
  const lastIndex = Number.isFinite(requestedCursor)
    ? Math.min(log.length - 1, Math.max(-1, Math.floor(requestedCursor)))
    : -1;
  const firstIndex =
    lastIndex < 0 ? 0 : Math.max(0, lastIndex - windowSize + 1);
  const nodes = [
    ...AGENTS.map(([agent, label, description]) => ({
      id: `agent:${agent}`,
      kind: "agent",
      agent,
      label,
      description,
      color: PALETTE[agent],
      val: 13,
      persistent: true,
    })),
    ...SYSTEMS.map(([system, label, description]) => ({
      id: `system:${system}`,
      kind: "system",
      system,
      label,
      description,
      color: PALETTE.system,
      val: 9,
      persistent: true,
    })),
  ];
  const links = [];
  function link(source, target, kind, color, metadata = {}) {
    links.push({
      id: `${source}->${target}:${kind}`,
      source,
      target,
      kind,
      color,
      ...metadata,
    });
  }

  // Keep the ready state connected without suggesting that any action ran.
  // Muted topology remains in place while brighter recorded event links arrive.
  for (const [system, label] of SYSTEMS) {
    link("agent:worker", `system:${system}`, "tool access", "#3C527A", {
      persistent: true,
      label: `Tool access · ${label}`,
      description: `Available capability: Worker can call ${label} tools.`,
    });
    link("agent:attacker", `system:${system}`, "attack surface", "#65424F", {
      persistent: true,
      label: `Attack surface · ${label}`,
      description: `Available capability: Attacker can target ${label} with supported attacks.`,
    });
  }
  link("agent:oversight", "agent:worker", "reviews", "#6A603E", {
    persistent: true,
    label: "Reviews worker actions",
    description:
      "Assigned role: Auditor reviews Worker actions after they execute.",
  });

  const workerAtTick = new Map();
  for (let index = firstIndex; index <= lastIndex; index++) {
    const entry = log[index];
    if (!entry || !AGENTS.some(([agent]) => agent === entry.agent)) continue;
    const actionId = `action:${index}`;
    const outcomeId = `outcome:${index}`;
    const outcome = recordedOutcome(entry);
    const shared = {
      agent: entry.agent,
      actionIndex: index,
      actionType: readable(entry.action_type),
      tick: Number.isFinite(entry.tick) ? entry.tick : null,
      status: outcome.label,
      current: index === lastIndex,
    };
    nodes.push({
      ...shared,
      id: actionId,
      kind: "action",
      label: actionLabel(entry),
      description: outcome.description,
      color: PALETTE[entry.agent],
      val: 4.3,
      reward: Number.isFinite(entry.reward) ? entry.reward : null,
    });
    nodes.push({
      ...shared,
      id: outcomeId,
      kind: "outcome",
      label: outcome.label,
      description: outcome.description,
      color: outcome.color,
      val: 2.5,
    });
    link(`agent:${entry.agent}`, actionId, "acts", PALETTE[entry.agent]);
    link(actionId, outcomeId, "result", outcome.color);
    for (const system of actionSystems(entry)) {
      link(
        actionId,
        `system:${system}`,
        entry.agent === "attacker" ? "targets" : "calls",
        PALETTE[entry.agent],
      );
    }

    if (entry.agent === "worker") {
      workerAtTick.set(entry.tick, actionId);
      const task = entry.task;
      if (task && (task.task_id || task.message || task.task_type)) {
        const requestId = `request:${index}`;
        nodes.push({
          ...shared,
          id: requestId,
          kind: "request",
          label:
            titleCase(readable(task.task_type)) ||
            readable(task.task_id) ||
            "Customer request",
          description:
            readable(task.message) ||
            `Recorded task ${readable(task.task_id)}.`,
          taskId: readable(task.task_id),
          color: PALETTE.request,
          val: 3.3,
        });
        link(requestId, actionId, "handled-by", PALETTE.request);
        for (const system of knownSystems(
          Array.isArray(task.required_systems) ? task.required_systems : [],
        )) {
          link(requestId, `system:${system}`, "requires", PALETTE.request);
        }
      }
    }
    if (entry.agent === "oversight" && workerAtTick.has(entry.tick)) {
      const workerActionId = workerAtTick.get(entry.tick);
      link(actionId, workerActionId, "audits", PALETTE.oversight);
    }
  }

  return {
    nodes,
    links,
    firstIndex,
    lastIndex,
    currentActionId: nodes.some((node) => node.id === `action:${lastIndex}`)
      ? `action:${lastIndex}`
      : null,
  };
}
