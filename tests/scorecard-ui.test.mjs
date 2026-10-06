import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resultsPage, comparePage, replayEntryIndex } from "../sentinelops_arena/ui/compare.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/scorecard-example.json", import.meta.url)));
const episode = (policy, scorecard = fixture.expected) => ({
  seed: 42,
  policy,
  ticks: 30,
  scorecard,
  log: fixture.log,
  legacy: { oversight_accuracy: 0.9876, benign_task_success: 0.1234 },
});
const state = (scorecard = fixture.expected) => ({
  seed: 42,
  pending: { compare: false },
  errors: {},
  config: { max_seed: 2147483647, presets: [{ seed: 42, label: "Balanced attack mix" }] },
  comparison: { seed: 42, baseline: episode("baseline", scorecard), resilient: episode("resilient", scorecard) },
});

test("Results renders scorecard values and attack links for both policies", () => {
  const html = resultsPage(state());
  assert.match(html, /Attack success/);
  assert.match(html, /50\.0% → 50\.0%/);
  assert.match(html, /Benign completion/);
  assert.match(html, /Social engineering resisted/);
  assert.match(html, /data-action="open-scorecard-attack" data-policy="baseline" data-tick="0"/);
  assert.match(html, /data-action="open-scorecard-attack" data-policy="resilient" data-tick="5"/);
  assert.match(html, /Policy drift · Succeeded/);
  assert.match(html, /Social engineering · Blocked/);
  assert.doesNotMatch(html, /98\.8%|12\.3%|Oversight accuracy|proxy/i);
});

test("Missing detection and empty attacks remain readable", () => {
  const scorecard = {
    ...fixture.expected,
    mean_time_to_detect: null,
    totals: { attacks: 0, benign_tasks: 0 },
    per_attack: [],
  };
  const html = resultsPage(state(scorecard));
  assert.match(html, /No attacks were launched/);
  assert.match(html, /Mean time to detect/);
  assert.doesNotMatch(html, /NaN|undefined|data-action="open-scorecard-attack"/);
});

test("Development Compare view also uses scorecard and links worker ticks", () => {
  const html = comparePage(state(), "replays");
  assert.match(html, /data-policy="baseline" data-tick="4" data-agent="worker"/);
  assert.doesNotMatch(html, /98\.8%|12\.3%|Oversight accuracy/);
});

test("Replay lookup resolves the launch row at a tick", () => {
  const run = episode("baseline");
  assert.equal(replayEntryIndex(run, 0), 0);
  assert.equal(replayEntryIndex(run, 5), 4);
  assert.equal(replayEntryIndex(run, 6, "worker"), 5);
  assert.equal(replayEntryIndex(run, 20), -1);
});

test("Attack fields are escaped in Results", () => {
  const scorecard = {
    ...fixture.expected,
    per_attack: [{ ...fixture.expected.per_attack[0], target: '<img src=x onerror=alert(1)>' }],
  };
  const html = resultsPage(state(scorecard));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});
