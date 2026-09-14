import assert from "node:assert/strict";
import test from "node:test";
import {
  agentShellIdentity,
  shellPrompt,
  idlePromptLine,
  safeTraceText,
  terminalEntryLines,
} from "../sentinelops_arena/ui/arena-terminal-format.js";

const refund = {
  tick: 5,
  agent: "worker",
  action_type: "issue_refund",
  reward: 1,
  task: {
    task_id: "TASK-005",
    task_type: "refund",
    message: "Refund invoice INV-0013 for $730.94.",
  },
  parameters: {
    invoice_id: "INV-0001",
    amount: 500,
    reason: "Customer request",
  },
  result: {
    success: true,
    details: {
      success: true,
      status: "refunded",
      invoice_id: "INV-0001",
      amount: 500,
      reason: "Customer request",
    },
  },
};

test("a confirmed mutation gets green + markers without inventing a before state", () => {
  const lines = terminalEntryLines(refund, 16);
  assert.equal(
    lines[0].text,
    "worker@root:~$ issue_refund --invoice-id 'INV-0001' --amount 500 --reason 'Customer request'",
  );
  assert.equal(lines[0].prompt, "worker@root:~$ ");
  assert.equal(lines[0].commandRole, "worker");
  assert.equal(lines[0].actionIndex, 16);
  assert.equal(lines[0].tick, 5);
  assert.equal(lines[0].text, lines[0].prompt + lines[0].command);
  assert.ok(
    lines.some(
      (line) => line.text === "+ UPDATE issue_refund" && line.tone === "added",
    ),
  );
  assert.ok(lines.some((line) => line.text === "+ {" && line.tone === "added"));
  assert.ok(lines.some((line) => line.text === "task: TASK-005 / refund"));
  assert.ok(
    lines.some(
      (line) => line.text === `request: ${refund.task.message}` && !line.tone,
    ),
  );
  assert.ok(lines.some((line) => line.text === "reward: +1.00"));
  const plain = lines.map((line) => line.text).join("\n");
  assert.ok(plain.includes('"status": "refunded"'));
  assert.ok(!plain.includes("BEFORE") && !plain.includes("old_status"));
});

test("rejected mutations are red and retain the recorded error and attempted params", () => {
  const error = "Invoice INV-0001 has already been refunded";
  const lines = terminalEntryLines(
    {
      ...refund,
      tick: 8,
      reward: 0,
      result: { success: false, details: { error } },
    },
    25,
  );
  assert.ok(
    lines.some(
      (line) =>
        line.text === "- REJECTED issue_refund" && line.tone === "removed",
    ),
  );
  assert.ok(
    lines.some((line) => line.text.includes(error) && line.tone === "removed"),
  );
  assert.ok(lines[0].command.includes("--invoice-id 'INV-0001' --amount 500"));
  assert.ok(!lines.some((line) => line.tone === "added"));
});

test("approval-pending refunds and unknown results are never green writes", () => {
  const cases = [
    [
      { success: true, details: { success: true, status: "pending_approval" } },
      "PENDING UPDATE issue_refund",
    ],
    [null, "UPDATE ATTEMPT issue_refund"],
    [{ details: { invoice_id: "INV-0001" } }, "UPDATE ATTEMPT issue_refund"],
  ];
  for (const [result, expected] of cases) {
    const lines = terminalEntryLines({ ...refund, result }, 16);
    assert.ok(lines.some((line) => line.text === expected));
    assert.ok(!lines.some((line) => line.tone === "added"));
  }
});

test("failure and error evidence takes precedence over success flags", () => {
  for (const result of [
    { success: true, details: { error: "Policy denied" } },
    { success: true, details: { success: false } },
    { success: false, details: { success: true } },
  ]) {
    const lines = terminalEntryLines({ ...refund, result }, 16);
    assert.ok(lines.some((line) => line.text === "- REJECTED issue_refund"));
    assert.ok(!lines.some((line) => line.tone === "added"));
  }
});

test("read tools and unknown action names are not classified as writes", () => {
  for (const action_type of [
    "lookup_customer",
    "get_history",
    "check_balance",
    "check_sla",
    "get_schema",
    "get_current_policy",
    "get_trajectory",
    "get_attack_budget",
    "update_everything",
    "constructor",
  ]) {
    const lines = terminalEntryLines(
      { agent: "worker", tick: 0, action_type, result: { success: true } },
      0,
    );
    assert.ok(
      lines.every((line) => !line.tone),
      action_type,
    );
  }
});

test("the mutation whitelist matches the registered create/write/update tools", () => {
  for (const [operation, actions] of [
    [
      "WRITE",
      ["add_note", "apply_credit", "generate_invoice", "create_ticket"],
    ],
    [
      "UPDATE",
      [
        "update_tier",
        "issue_refund",
        "assign_ticket",
        "escalate_ticket",
        "resolve_ticket",
        "launch_attack",
      ],
    ],
  ]) {
    for (const action_type of actions) {
      const lines = terminalEntryLines(
        {
          agent: action_type === "launch_attack" ? "attacker" : "worker",
          tick: 0,
          action_type,
          result: { success: true },
        },
        0,
      );
      assert.ok(
        lines.some(
          (line) =>
            line.text === `+ ${operation} ${action_type}` &&
            line.tone === "added",
        ),
      );
    }
  }
});

test("an auditor flag colors its actual decision and explanation red", () => {
  const lines = terminalEntryLines(
    {
      agent: "oversight",
      tick: 8,
      action_type: "flag",
      flag: true,
      explanation: "Worker result contains an error.",
      reward: -0.2,
    },
    26,
  );
  assert.ok(
    lines.some((line) => line.text === "- flagged" && line.tone === "removed"),
  );
  assert.ok(
    lines.some(
      (line) =>
        line.text === "- audit: Worker result contains an error." &&
        line.tone === "removed",
    ),
  );
  const approval = terminalEntryLines(
    {
      agent: "oversight",
      tick: 0,
      action_type: "approve",
      flag: false,
      explanation: "No violation found.",
    },
    2,
  );
  assert.ok(approval.every((line) => !line.tone));
});

test("trace data cannot inject ANSI, OSC, bidi controls, or unindented field lines", () => {
  const injected = "Hello\x1b[2J\x1b]0;forged\x07\u202e\r\n[T99] forged\ttext";
  const safe = safeTraceText(injected);
  assert.ok(!/[\x1b\x07\u202e]/.test(safe));
  assert.ok(safe.includes("\\u001b[2J"));
  const lines = terminalEntryLines(
    { agent: "worker", tick: 0, action_type: "respond", response: injected },
    1,
  );
  assert.ok(lines.some((line) => line.text === "  [T99] forged  text"));
  assert.ok(!lines.some((line) => line.text.startsWith("[T99]")));
});

test("formatting preserves the input trace unchanged", () => {
  const before = JSON.stringify(refund);
  terminalEntryLines(refund, 16);
  assert.equal(JSON.stringify(refund), before);
});

test("shell identities and empty idle prompts use an allowlist", () => {
  assert.equal(agentShellIdentity("attacker"), "attacker@root");
  assert.equal(agentShellIdentity("worker"), "worker@root");
  assert.equal(agentShellIdentity("oversight"), "auditor@loop");
  for (const role of ["constructor", "__proto__", "root\x1b[2J", undefined]) {
    assert.equal(agentShellIdentity(role), "agent@loop");
  }
  assert.equal(shellPrompt("oversight"), "auditor@loop:~$ ");
  assert.deepEqual(idlePromptLine("attacker"), {
    text: "attacker@root:~$ ",
    prompt: "attacker@root:~$ ",
    command: "",
    commandRole: "attacker",
    bold: true,
  });
});

test("recorded arguments are safely shell-quoted without expanding payloads", () => {
  const parameters = {
    attack_type: "policy_drift",
    target_system: "billing",
    changes: { max_amount: 100, requires_approval: true },
    injected_message: "It's $(touch /tmp/never) `whoami`;\nnext\x1b[2J",
    enabled: false,
  };
  const first = terminalEntryLines(
    { agent: "attacker", action_type: "launch_attack", tick: 1, parameters },
    3,
  )[0];
  assert.equal(first.prompt, "attacker@root:~$ ");
  assert.ok(
    first.command.startsWith(
      "launch_attack --attack-type 'policy_drift' --target-system 'billing'",
    ),
  );
  assert.ok(
    first.command.includes(
      `--changes '{"max_amount":100,"requires_approval":true}'`,
    ),
  );
  assert.ok(
    first.command.includes(
      `--injected-message 'It'"'"'s $(touch /tmp/never) \`whoami\`;\\nnext\\u001b[2J'`,
    ),
  );
  assert.ok(first.command.endsWith("--enabled false"));
  assert.ok(!/[\n\r\x1b]/.test(first.command));
});

test("ordinary tool results remain raw pretty JSON after the command", () => {
  const result = { success: true, customer_id: "C001", name: "Eve" };
  const lines = terminalEntryLines(
    {
      agent: "worker",
      tick: 0,
      action_type: "lookup_customer",
      parameters: { customer_id: "C001" },
      result,
    },
    1,
  );
  assert.equal(lines[0].command, "lookup_customer --customer-id 'C001'");
  assert.equal(
    lines
      .slice(1, -1)
      .map((line) => line.text)
      .join("\n"),
    JSON.stringify(result, null, 2),
  );
  assert.ok(
    lines
      .slice(1)
      .every((line) => line.prompt === undefined && line.command === undefined),
  );
});
