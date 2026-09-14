import { h, icon, actionInfo, signed, pad, policyName } from "./ui.js";
import { arenaKanban } from "./arena-kanban.js";

const agents = [
  {
    role: "attacker",
    name: "Attacker",
  },
  {
    role: "worker",
    name: "Worker",
  },
  {
    role: "oversight",
    name: "Auditor",
  },
];

export function arenaStage(state) {
  const episode = state.episode;
  const cursor = episode
    ? Math.max(0, Math.min(episode.log.length - 1, state.replay.selected))
    : 0;
  const current = episode?.log[cursor];
  const info = current ? actionInfo(current) : null;
  const position = current
    ? `${pad(current.tick)} / ${pad(episode.ticks - 1)}`
    : "00 / 29";
  const playing = state.playback.playing;
  const detail = info
    ? info.description
    : "Run an episode to see attacks, tool calls, and audit decisions connect across the enterprise. Select a node to inspect its recorded action.";
  return `<section id="arena-stage" class="arena-stage ${episode ? "has-episode" : "is-ready"} ${playing ? "is-playing" : ""}" data-active-agent="${h(current?.agent || "none")}" aria-label="Three-agent enterprise Arena">
    <div class="arena-stage-heading"><div><span class="arena-eyebrow">${icon("arena", 15)} MULTI-AGENT ARENA</span><h2>Follow every action through the Arena.</h2></div><span class="arena-stage-status"><i></i>${state.pending.arena ? "Running episode" : episode ? (playing ? "Replaying episode" : "Episode replay") : "Ready to run"}</span></div>
    <div class="arena-graph-shell">
      <div class="arena-graph-viewport">
        <div id="arena-graph-host" role="region" aria-label="Interactive 3D graph of agents, enterprise systems, and recorded episode actions" aria-describedby="arena-graph-instructions" tabindex="0"><span class="arena-graph-loading">Loading 3D graph…</span></div>
        <div class="arena-graph-toolbar">
          <div class="arena-graph-readout"><span class="arena-graph-dimensional">3D</span><span><b data-graph-nodes>0</b> nodes</span><span><b data-graph-links>0</b> links</span><span class="arena-graph-seed">${episode ? `Seed ${h(episode.seed)} · ${h(policyName(episode.policy))}` : "CRM · Billing · Ticketing"}</span></div>
          <div class="arena-graph-controls"><button type="button" class="arena-control arena-graph-control" data-action="graph-fit" aria-label="Fit the graph in view" title="Fit graph in view">${icon("arena", 14)}<span>Fit view</span></button><button type="button" class="arena-control arena-graph-control" data-action="graph-orbit" aria-pressed="false" aria-label="Toggle automatic graph rotation" title="Rotate the graph automatically">${icon("refresh", 14)}<span>Orbit</span></button></div>
        </div>
        <div class="arena-graph-overlay-footer"><div class="arena-graph-legend" aria-label="Graph node colors">${[
          ["attacker", "Attacker"],
          ["worker", "Worker"],
          ["oversight", "Auditor"],
          ["request", "Customer request"],
          ["rejected", "Rejected"],
          ["flagged", "Flagged"],
        ]
          .map(
            ([type, label]) =>
              `<span><i class="arena-graph-key ${type}" aria-hidden="true"></i>${label}</span>`,
          )
          .join("")}</div>
        <p id="arena-graph-instructions" class="arena-graph-hints"><span>Drag to orbit</span><span>Scroll / + − to zoom</span><span>Arrow keys to move</span><span>Select a node for details</span><span>Select an agent for its terminal</span></p></div>
      </div>
      <aside id="arena-graph-inspector" class="arena-graph-inspector" aria-label="Selected graph node" hidden></aside>
    </div>
    ${arenaKanban()}
    <div class="arena-commentary"><span class="arena-commentary-glyph">${icon(current?.agent === "attacker" ? "bolt" : current?.agent === "oversight" ? "shield" : "queue", 17)}</span><div><strong>${info ? `${agents.find((agent) => agent.role === current.agent).name} · ${h(info.title)}` : "The enterprise is the playing field."}</strong><p title="${h(detail)}">${h(detail)}</p></div>${current ? `<span class="arena-event-reward mono">${signed(current.reward)}<small>action reward</small></span>` : `<span class="arena-turn-order">ATTACK ${icon("arrow", 12)} ACT ${icon("arrow", 12)} AUDIT</span>`}</div>
    <div class="arena-transport"><div class="arena-playback-buttons"><button type="button" class="arena-control arena-play" data-action="${episode ? "arena-play" : "run-episode"}" ${state.pending.arena ? "disabled" : ""}>${icon(playing ? "pause" : "play", 15)}<span>${episode ? (playing ? "Pause" : cursor === episode.log.length - 1 ? "Replay again" : "Play replay") : "Run episode"}</span></button><button type="button" class="arena-control arena-icon-button" data-action="arena-restart" aria-label="Rewind to first action" ${!episode || cursor === 0 ? "disabled" : ""}>${icon("refresh", 15)}</button><button type="button" class="arena-control arena-icon-button" data-action="arena-step" data-step="1" aria-label="Next agent action" ${!episode || cursor === episode.log.length - 1 ? "disabled" : ""}>${icon("step", 16)}</button></div><label class="arena-scrubber"><span class="sr-only">Replay action</span><input id="arena-position" type="range" min="0" max="${episode ? episode.log.length - 1 : 89}" value="${cursor}" ${!episode ? "disabled" : ""} aria-valuetext="${current ? `Action ${cursor + 1} of ${episode.log.length}, tick ${current.tick}, ${agents.find((agent) => agent.role === current.agent).name}` : "Run an episode to replay"}" style="--replay-progress:${episode ? (cursor / (episode.log.length - 1)) * 100 : 0}%"></label><span class="arena-clock mono">TICK ${position}</span><label class="arena-speed"><span class="sr-only">Replay speed</span><select id="arena-speed" aria-label="Replay speed">${[1, 2, 4].map((speed) => `<option value="${speed}" ${state.playback.speed === speed ? "selected" : ""}>${speed}×</option>`).join("")}</select></label></div>
    <div class="arena-stage-footnote"><span>${episode ? `Action ${cursor + 1} of ${episode.log.length} · replaying the completed episode` : "3 agents · 3 systems · 90 actions per episode"}</span><span>Event nodes enter and fade as the episode plays</span></div>
  </section>`;
}
