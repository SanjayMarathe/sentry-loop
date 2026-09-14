import { h, icon, actionInfo, money, titleCase } from "./ui.js";
import {
  incidentDefinitions,
  incidentWorkflow,
  episodeEvents,
  cardState,
  cardTitle,
  cardSubtitle,
} from "./environment.js";

const trainingChannel = crypto.randomUUID().toLowerCase();
let lastTrainingSignature = "";

const replayConfig = (state) => state.config?.training_replay || {};

const agentName = (agent) =>
  agent === "oversight" ? "auditor@loop" : `${agent || "arena"}@root`;

function referencedIds(value) {
  const text = JSON.stringify(value || {});
  return {
    customers: new Set(text.match(/C\d{3}/g) || []),
    tickets: new Set(text.match(/TK-\d{3}/g) || []),
    invoices: new Set(text.match(/INV-\d{4}/g) || []),
  };
}

function activeIds(episode, cursor) {
  const current = episode?.log?.[cursor];
  if (!current) return referencedIds({});
  let context = current;
  if (current.agent !== "worker") {
    const worker = episode.log
      .slice(0, cursor + 1)
      .reverse()
      .find((row) => row.tick === current.tick && row.agent === "worker");
    if (worker) context = worker;
  }
  const ids = referencedIds(context);
  if (context.task?.customer_id) ids.customers.add(context.task.customer_id);
  return ids;
}

function pipelineCommand(row) {
  if (!row) return "waiting for episode";
  if (row.agent === "attacker") {
    return row.action_type === "launch_attack"
      ? `inject --type ${row.parameters?.attack_type || "unknown"} --target ${row.parameters?.target_system || "enterprise"}`
      : "hold --position";
  }
  if (row.agent === "oversight") {
    return `${row.flag ? "flag" : "approve"} --tick ${String(row.tick).padStart(2, "0")}`;
  }
  const args = Object.entries(row.parameters || {})
    .slice(0, 2)
    .map(([key, value]) => `--${key.replaceAll("_", "-")} ${String(value)}`)
    .join(" ");
  return `${row.action_type || "pass"}${args ? ` ${args}` : ""}`;
}

function compactTitle(kind, record) {
  if (kind === "invoices") return money(record.amount);
  return cardTitle(kind, record);
}

function trainingPayload(state) {
  const episode = state.episode,
    log = Array.isArray(episode?.log) ? episode.log : [],
    cursor = log.length
      ? Math.max(0, Math.min(log.length - 1, state.replay.selected))
      : -1,
    visible = log.slice(0, cursor + 1),
    current = log[cursor],
    workers = visible.filter((row) => row.agent === "worker"),
    audits = visible.filter((row) => row.agent === "oversight");
  let reward = 0,
    success = 0;
  const points = workers.map((row, index) => {
    reward += Number(row.reward || 0);
    const completed = row.result?.success ?? row.result?.details?.success ?? false;
    if (completed) success += 1;
    return {
      step: index + 1,
      reward,
      loss: Number(row.reward || 0),
      kl: (success / (index + 1)) * 100,
      mean_length: audits.filter(
        (audit) => audit.tick <= row.tick && audit.flag === true,
      ).length,
    };
  });
  return {
    type: "sentry-loop-arena-sync",
    version: 1,
    seed: episode?.seed ?? Number(state.seed),
    policy: episode?.policy || state.policy,
    cursor,
    totalActions: log.length || 90,
    tick: current?.tick ?? 0,
    current: current
      ? {
          agent: current.agent,
          action: current.action_type,
          status: actionInfo(current).status,
          reward: Number(current.reward || 0),
        }
      : null,
    points,
  };
}

export function syncTrainingWindow(state) {
  const payload = trainingPayload(state);
  const signature = `${payload.seed}:${payload.policy}:${payload.cursor}`;
  if (signature === lastTrainingSignature) return;
  lastTrainingSignature = signature;
  void fetch(`/api/replay-sync/${trainingChannel}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    lastTrainingSignature = "";
  });
}

export function openTrainingSync(state) {
  const appOrigin = replayConfig(state).app_origin;
  if (!appOrigin) return false;
  syncTrainingWindow(state);
  const url = new URL("/index.html", appOrigin);
  url.searchParams.set("arena_sync", "1");
  url.searchParams.set(
    "sync_url",
    new URL(`/api/replay-sync/${trainingChannel}`, location.origin),
  );
  const trainingWindow = window.open(
    url,
    "sentry-loop-training-live",
    "popup,width=1280,height=900",
  );
  return Boolean(trainingWindow);
}

function boardMarkup(state) {
  const snapshot = state.environment;
  if (!snapshot) {
    return `<div class="arena-kanban-loading"><span class="arena-live-dot"></span><span>SYNCING ENTERPRISE RECORDS</span></div>`;
  }
  const episode = state.episode?.seed === snapshot.seed ? state.episode : null,
    cursor = episode
      ? Math.max(0, Math.min(episode.log.length - 1, state.replay.selected))
      : -1,
    current = episode?.log?.[cursor],
    info = current ? actionInfo(current) : null,
    eventsByKind = episodeEvents(episode, cursor),
    highlightedByKind = activeIds(episode, cursor),
    names = Object.fromEntries(
      snapshot.customers.map((customer) => [
        customer.customer_id,
        customer.name,
      ]),
    ),
    items = Object.entries(incidentDefinitions).flatMap(([kind, def]) =>
      snapshot[kind].map((record, index) => {
        const id = record[def.id],
          recordEvents = eventsByKind[kind].get(id) || [];
        return {
          kind,
          def,
          record,
          index,
          id,
          state: cardState(recordEvents),
          active: highlightedByKind[kind].has(id),
          latest: recordEvents.at(-1),
        };
      }),
    );
  const columns = incidentWorkflow
    .map((column) => {
      const cards = items.filter((item) => item.state === column.id);
      return `<section class="arena-lane ${column.id}" data-lane="${column.id}" aria-label="${column.label}">
        <header><span class="arena-lane-dot"></span><strong>${column.label}</strong><span>${cards.length}</span></header>
        <div class="arena-lane-stack">${cards
          .map(
            ({ kind, def, record, index, id, state: cardStatus, active, latest }) =>
              `<button type="button" class="arena-record-card ${cardStatus} ${active ? "is-active" : ""}" data-card-id="${h(`${kind}:${id}`)}" data-action="record-detail" data-kind="${kind}" data-index="${index}" data-active="${active}" aria-label="Inspect ${h(id)}">
                <span class="arena-record-top"><span>${icon(def.icon, 11)}${h(kind === "invoices" ? "FINANCE" : def.singular.toUpperCase())}</span><code>${h(id)}</code></span>
                <strong>${h(compactTitle(kind, record))}</strong>
                <small>${h(cardSubtitle(kind, record, names))}</small>
                <span class="arena-record-event">${latest ? `${h(titleCase(latest.workerAction || latest.attack || "observed"))} · T${String(latest.tick).padStart(2, "0")}` : "AWAITING SIGNAL"}</span>
              </button>`,
          )
          .join("")}</div>
      </section>`;
    })
    .join("");
  const replayUrl = replayConfig(state).url;
  return `<div class="arena-kanban-head">
      <div class="arena-kanban-title"><span class="arena-live-dot"></span><strong>LIVE ENTITY STATE</strong><span>${episode ? `T${String(current?.tick ?? 0).padStart(2, "0")} · ${cursor + 1}/${episode.log.length}` : "READY"}</span></div>
      <div class="arena-kanban-summary" aria-label="All enterprise records"><span>CUSTOMER ${snapshot.customers.length}</span><span>TICKET ${snapshot.tickets.length}</span><span>FINANCE ${snapshot.invoices.length}</span></div>
      ${replayUrl ? `<a class="arena-hf-link" data-action="open-hf-live" href="${h(replayUrl)}" target="_blank" rel="noreferrer">HF · WORKER METRICS ${icon("arrow", 11)}</a>` : '<span class="arena-hf-link">HF METRICS · NOT CONFIGURED</span>'}
    </div>
    <div class="arena-pipeline-event" data-agent="${h(current?.agent || "none")}">
      <span>${h(agentName(current?.agent))}</span><code>$ ${h(pipelineCommand(current))}</code><strong>${info ? h(info.status.toUpperCase()) : "IDLE"}</strong>
    </div>
    <div class="arena-lanes">${columns}</div>`;
}

function positions(host) {
  return new Map(
    [...host.querySelectorAll("[data-card-id]")].map((card) => [
      card.dataset.cardId,
      card.getBoundingClientRect(),
    ]),
  );
}

export function syncArenaKanban(host, state) {
  if (!host?.isConnected) return;
  syncTrainingWindow(state);
  const before = positions(host);
  host.innerHTML = boardMarkup(state);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const card of host.querySelectorAll("[data-card-id]")) {
    const old = before.get(card.dataset.cardId),
      next = card.getBoundingClientRect();
    if (!old) {
      if (card.dataset.active === "true")
        card.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 320, easing: "ease-out" },
        );
      continue;
    }
    const dx = old.left - next.left,
      dy = old.top - next.top;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      card.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, zIndex: 8 },
          { transform: "translate(0, 0)", zIndex: 8 },
        ],
        { duration: 560, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    }
  }
  host.querySelector('[data-active="true"]')?.scrollIntoView({
    block: "nearest",
    inline: "nearest",
  });
}

export function arenaKanban() {
  return `<section id="arena-kanban-host" class="arena-kanban" aria-label="Live enterprise incident board" aria-live="polite"></section>`;
}
