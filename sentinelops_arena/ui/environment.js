import {
  h,
  icon,
  button,
  badge,
  header,
  footer,
  note,
  money,
  titleCase,
  loading,
} from "./ui.js";
import { seedField, errorNote } from "./arena.js";

export const incidentDefinitions = {
  customers: {
    title: "Customers",
    singular: "customer",
    icon: "people",
    id: "customer_id",
  },
  tickets: {
    title: "Tickets",
    singular: "ticket",
    icon: "ticket",
    id: "ticket_id",
  },
  invoices: {
    title: "Finances",
    singular: "invoice",
    icon: "invoice",
    id: "invoice_id",
  },
};

export const incidentWorkflow = [
  {
    id: "watching",
    label: "Watching",
    description: "Touched by the episode",
  },
  {
    id: "exposed",
    label: "Exposed",
    description: "Attack reached this record",
  },
  {
    id: "contained",
    label: "Contained",
    description: "Rejected or flagged",
  },
  {
    id: "clear",
    label: "Clear",
    description: "No attack observed",
  },
];

const attackName = (row) =>
  titleCase(row?.parameters?.attack_type || "attack activity");

function referencedIds(value) {
  const text = JSON.stringify(value || {});
  return {
    customers: new Set(text.match(/C\d{3}/g) || []),
    tickets: new Set(text.match(/TK-\d{3}/g) || []),
    invoices: new Set(text.match(/INV-\d{4}/g) || []),
  };
}

export function episodeEvents(episode, cursor = Infinity) {
  const result = Object.fromEntries(
    Object.keys(incidentDefinitions).map((kind) => [kind, new Map()]),
  );
  if (!episode?.log?.length) return result;
  const ticks = new Map();
  for (const row of episode.log.slice(0, cursor + 1)) {
    const group = ticks.get(row.tick) || {};
    group[row.agent] = row;
    ticks.set(row.tick, group);
  }
  for (const [tick, rows] of ticks) {
    const attacker = rows.attacker,
      worker = rows.worker,
      auditor = rows.oversight,
      attacked = attacker?.action_type === "launch_attack",
      ids = referencedIds({
        parameters: worker?.parameters,
        task: worker?.task,
        result: worker?.result,
      });
    if (worker?.task?.customer_id) ids.customers.add(worker.task.customer_id);
    for (const [kind, values] of Object.entries(ids)) {
      for (const id of values) {
        const events = result[kind].get(id) || [];
        events.push({
          tick,
          attacked,
          attack: attacked ? attackName(attacker) : null,
          target: attacker?.parameters?.target_system || null,
          contained:
            attacked &&
            (auditor?.flag === true || worker?.result?.success === false),
          workerAction: worker?.action_type || null,
          workerReward: worker?.reward,
          explanation: auditor?.explanation || "",
        });
        result[kind].set(id, events);
      }
    }
  }
  return result;
}

export function cardState(events = []) {
  const attacked = events.filter((event) => event.attacked);
  if (attacked.some((event) => event.contained)) return "contained";
  if (attacked.length) return "exposed";
  if (events.length) return "watching";
  return "clear";
}

export function cardTitle(kind, record) {
  if (kind === "customers") return record.name;
  if (kind === "tickets") return record.subject;
  return money(record.amount);
}

export function cardSubtitle(kind, record, names) {
  if (kind === "customers")
    return `${titleCase(record.tier)} · ${record.region}`;
  if (kind === "tickets")
    return `${titleCase(record.priority)} priority · ${titleCase(record.status)}`;
  return `${names[record.customer_id] || record.customer_id} · ${titleCase(record.status)}`;
}

export function latestEvent(events) {
  return [...events].sort((a, b) => b.tick - a.tick)[0];
}

function boardCard(kind, item, names) {
  const { record, index, events, state } = item,
    def = incidentDefinitions[kind],
    id = record[def.id],
    attack = [...events].reverse().find((event) => event.attacked),
    latest = latestEvent(events);
  return `<button class="incident-card ${state}" data-action="record-detail" data-kind="${kind}" data-index="${index}" aria-label="Open ${h(id)}">
    <span class="incident-card-top"><span class="record-type">${icon(def.icon, 13)}${h(kind === "invoices" ? "finance" : def.singular)}</span><span class="mono">${h(id)}</span></span>
    <strong>${h(cardTitle(kind, record))}</strong>
    <small>${h(cardSubtitle(kind, record, names))}</small>
    ${attack ? `<span class="attack-evidence">${icon(attack.contained ? "shield" : "bolt", 13)}${h(attack.attack)} · T${String(attack.tick).padStart(2, "0")}</span>` : `<span class="attack-evidence neutral">${latest ? `${h(titleCase(latest.workerAction || "observed"))} · T${String(latest.tick).padStart(2, "0")}` : "No episode activity"}</span>`}
  </button>`;
}

function incidentBoard(state) {
  const snapshot = state.environment,
    eventsByKind = episodeEvents(
      state.episode?.seed === snapshot.seed ? state.episode : null,
    ),
    names = Object.fromEntries(
      snapshot.customers.map((customer) => [
        customer.customer_id,
        customer.name,
      ]),
    ),
    filter = state.filters.all,
    query = filter.search.trim().toLowerCase();
  const items = Object.entries(incidentDefinitions)
    .flatMap(([kind, def]) =>
      snapshot[kind].map((record, index) => {
        const id = record[def.id],
          recordEvents = eventsByKind[kind].get(id) || [];
        return {
          kind,
          record,
          index,
          events: recordEvents,
          state: cardState(recordEvents),
        };
      }),
    )
    .filter(
      (item) =>
        (!filter.filter || item.state === filter.filter) &&
        (!query ||
          `${JSON.stringify(item.record)} ${names[item.record.customer_id] || ""}`
            .toLowerCase()
            .includes(query)),
    );
  const toolbar = `<div class="incident-toolbar"><label class="search-field" for="record-search">${icon("search", 14)}<input id="record-search" type="search" placeholder="Search all records" value="${h(filter.search)}"></label><label class="incident-filter" for="record-filter">${icon("filter", 14)}<span class="sr-only">Filter security state</span><select id="record-filter"><option value="">All security states</option>${incidentWorkflow.map((column) => `<option value="${column.id}" ${filter.filter === column.id ? "selected" : ""}>${column.label}</option>`).join("")}</select></label></div>`;
  const columns = incidentWorkflow
    .map((column) => {
      const cards = items.filter((item) => item.state === column.id);
      return `<section class="incident-column ${column.id}" aria-labelledby="column-${column.id}"><header><div><span class="workflow-dot"></span><h2 id="column-${column.id}">${column.label}</h2><span class="column-count">${cards.length}</span></div><p>${column.description}</p></header><div class="incident-stack">${cards.map((item) => boardCard(item.kind, item, names)).join("") || '<p class="empty-column">No matching records</p>'}</div></section>`;
    })
    .join("");
  return `${toolbar}<div class="incident-board">${columns}</div>`;
}

export function environmentPage(state) {
  const snapshot = state.environment,
    busy = state.pending.environment || state.pending.arena;
  let content = header(
    "Arena environment",
    "Track every customer, ticket, and financial record through the attack workflow.",
    button(
      busy ? "Inspecting…" : "Refresh incident board",
      "inspect-seed",
      "primary",
      "refresh",
      busy,
    ),
  );
  content += `<div class="config">${seedField(state)}<div class="config-divider"></div><div class="config-description">${icon("database", 18)}Enterprise incident workspace</div><span class="config-meta">Actual episode evidence · 3 systems</span>${badge(state.episode?.seed === snapshot?.seed ? "Episode mapped" : "Mapping episode", "success", true)}</div>`;
  if (!snapshot)
    return (
      content +
      (state.errors.environment
        ? errorNote(state.errors.environment, "inspect-seed")
        : loading("Loading the Arena environment…"))
    );
  if (state.errors.environment)
    content += errorNote(state.errors.environment, "inspect-seed");
  if (Number(state.seed) !== snapshot.seed)
    content += note(
      "A different seed is selected",
      `This board is from seed ${snapshot.seed}. Refresh the board to map seed ${state.seed}.`,
    );
  if (!state.episode || state.episode.seed !== snapshot.seed)
    content += note(
      "Mapping attack evidence",
      "The records are ready. Sentry Loop is running the matching episode to place them into security workflow states.",
      "refresh",
      true,
    );
  content += incidentBoard(state);
  return (
    content +
    footer(
      `Seed ${snapshot.seed} · ${state.episode?.policy ? titleCase(state.episode.policy) : "Episode pending"} policy`,
      `Customers ${snapshot.customers.length} / Tickets ${snapshot.tickets.length} / Finances ${snapshot.invoices.length}`,
    )
  );
}
