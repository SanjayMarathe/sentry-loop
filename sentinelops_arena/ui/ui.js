// Shared components, including the mark and icons copied from the Paper export.
export const colors = {
  worker: "#3159F5",
  attacker: "#B65364",
  oversight: "#907333",
  green: "#2B7560",
  muted: "#AAB4CB",
};
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const h = escapeHTML;
export const number = (value, digits = 1) =>
  Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
export const money = (value) =>
  Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const percent = (value) => `${number(value * 100)}%`;
export const signed = (value, digits = 1) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${number(Math.abs(value), digits)}`;
export const pad = (value, size = 2) => String(value).padStart(size, "0");
export const titleCase = (value) =>
  String(value)
    .replaceAll("_", " ")
    .replace(/^./, (x) => x.toUpperCase())
    .replace("Sla", "SLA");
export const policyName = (policy) =>
  policy === "resilient" ? "Resilient" : "Baseline";

const shapes = {
  arena:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/>',
  compare:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M6 9h3m6 6h3"/>',
  database:
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  training: '<path d="M4 3v17h17M7 14l4-4 4 2 5-7"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-2-1-6-2-10 1Zm0 0v16"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  step: '<path d="m5 5 10 7-10 7ZM19 5v14"/>',
  refresh:
    '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5m-4 6a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  filter: '<path d="M3 6h18M6 12h12M9 18h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  cross: '<path d="m6 6 12 12M6 18 18 6"/>',
  flag: '<path d="M5 22V3c4-3 8 3 14 0v11c-6 3-10-3-14 0"/>',
  shield:
    '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  code: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-17-2 20"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="10" cy="18" r="2" fill="white"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8L21 9h-8Z"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4c3 0 4 2 4 6"/>',
  invoice: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2ZM9 7h6m-6 5h6"/>',
  ticket:
    '<path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4Z"/><path d="M15 5v3m0 3v2m0 3v3"/>',
  queue: '<path d="M8 5h13M8 12h13M8 19h13M3 5h1m-1 7h1m-1 7h1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
export function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.info}</svg>`;
}
export function logo(size = 29) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M21 5H13a8 8 0 0 0 0 16h6a4 4 0 0 0 0-8h-6" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path d="M11 27h8a8 8 0 0 0 0-16h-6a4 4 0 0 0 0 8h6" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>`;
}
export function button(
  label,
  action,
  kind = "secondary",
  glyph = "",
  disabled = false,
) {
  return `<button type="button" class="button ${h(kind)}" data-action="${h(action)}" ${disabled ? "disabled" : ""}>${disabled ? '<span class="spinner" aria-hidden="true"></span>' : glyph ? icon(glyph, 16) : ""}${h(label)}</button>`;
}
export function linkButton(label, href, kind = "secondary", glyph = "") {
  return `<a class="button ${h(kind)}" href="${h(href)}" ${href.startsWith("/") ? "data-route" : ""} ${href.startsWith("https:") ? 'target="_blank" rel="noopener noreferrer"' : ""}>${glyph ? icon(glyph, 16) : ""}${h(label)}</a>`;
}
export function badge(label, tone = "", dot = false) {
  return `<span class="badge ${h(tone)}">${dot ? '<span class="dot"></span>' : ""}${h(label)}</span>`;
}
export function statusBadge(value) {
  const tones = {
    gold: "gold",
    silver: "silver",
    bronze: "bronze",
    paid: "success",
    resolved: "success",
    pending: "gold",
    high: "rose",
    medium: "gold",
    low: "",
    overdue: "rose",
    in_progress: "blue",
    escalated: "rose",
    pending_approval: "gold",
    refunded: "",
    open: "",
  };
  return badge(titleCase(value), tones[value] || "");
}
export function actor(role) {
  return `<span class="actor ${h(role)}"><span class="dot"></span>${{ worker: "Worker", attacker: "Attacker", oversight: "Auditor" }[role] || h(role)}</span>`;
}
export function header(title, subtitle, actions = "") {
  return `<header class="page-heading"><div><h1 id="page-title">${h(title)}</h1><p>${h(subtitle)}</p></div><div class="actions">${actions}</div></header>`;
}
export function tabs(items, active, trailing = "") {
  return `<nav class="tabs" aria-label="Page views"><div class="tab-list">${items.map(([label, path, count]) => `<a data-route href="${h(path)}" class="tab ${path === active ? "active" : ""}" ${path === active ? 'aria-current="page"' : ""}>${h(label)}${count !== undefined ? `<small>${h(count)}</small>` : ""}</a>`).join("")}</div>${trailing}</nav>`;
}
export function metricStrip(items, classes = "") {
  return `<section class="metrics ${h(classes)}" aria-label="Key metrics">${items.map(([label, value, note]) => `<div class="metric"><span class="metric-label">${h(label)}</span><strong class="metric-value">${h(value)}</strong><span class="metric-note">${h(note)}</span></div>`).join("")}</section>`;
}
export function panelHeader(title, subtitle = "", aside = "") {
  return `<div class="panel-header"><div><h3>${h(title)}</h3>${subtitle ? `<p>${h(subtitle)}</p>` : ""}</div>${aside}</div>`;
}
export function panel(title, subtitle, body, aside = "", classes = "") {
  return `<section class="panel ${h(classes)}">${panelHeader(title, subtitle, aside)}${body}</section>`;
}
export function footer(left, right = "") {
  return `<footer class="page-footer"><span>${h(left)}</span><span>${h(right)}</span></footer>`;
}
export function note(title, copy, glyph = "info", blue = false) {
  return `<aside class="note ${blue ? "blue-note" : ""}">${icon(glyph, 18)}<div><h3>${h(title)}</h3><p>${h(copy)}</p></div></aside>`;
}
export function infoRow(label, value, description = "") {
  return `<div class="info-row"><div><span>${h(label)}</span>${description ? `<small>${h(description)}</small>` : ""}</div><strong>${h(value)}</strong></div>`;
}
export function smallStats(items) {
  return `<div class="stats-card">${items.map(([label, value, note]) => `<div class="small-stat"><span>${h(label)}</span><strong>${h(value)}</strong><small>${h(note)}</small></div>`).join("")}</div>`;
}
export function table(headers, rows, classes = "") {
  return `<div class="table-scroll"><table class="${h(classes)}"><thead><tr>${headers.map((label) => `<th scope="col">${h(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
export function loading(label = "Loading workspace…") {
  return `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span><p>${h(label)}</p></div>`;
}
export function legend(series) {
  return `<div class="legend">${series.map(({ name, color }) => `<span class="legend-item"><i style="--legend-color:${h(color)}"></i>${h(name)}</span>`).join("")}</div>`;
}
export function scoreSeries(episode) {
  return ["worker", "attacker", "oversight"].map((role) => {
    let total = 0;
    return {
      name: role === "oversight" ? "Auditor" : titleCase(role),
      color: colors[role],
      points: episode.log
        .filter((row) => row.agent === role)
        .map((row) => [
          row.tick,
          Math.round((total += row.reward) * 100) / 100,
        ]),
    };
  });
}
export function actionInfo(entry) {
  const result = entry.result?.details || entry.result || {};
  if (entry.agent === "attacker") {
    const type = entry.parameters?.attack_type;
    return {
      name: type || entry.action_type,
      status:
        entry.action_type === "pass"
          ? "Idle"
          : type === "social_engineering"
            ? "Injected"
            : "Applied",
      tone:
        entry.action_type === "pass"
          ? ""
          : type === "social_engineering"
            ? "rose"
            : "",
      title: type ? titleCase(type) : "No attack this tick",
      description:
        entry.parameters?.injected_message ||
        (type
          ? `${titleCase(type)} targeted ${entry.parameters?.target_system || "the environment"}.`
          : "The attacker held its position."),
    };
  }
  if (entry.agent === "oversight")
    return {
      name: entry.action_type === "flag" ? "flag_action" : entry.action_type,
      status: entry.flag ? "Flagged" : "Approved",
      tone: entry.flag ? "gold" : "success",
      title: entry.flag ? "Auditor raised a flag" : "Action approved",
      description: entry.explanation || "No explanation was recorded.",
    };
  const error = result.error;
  const isRefusal =
    /cannot|refus|social engineering|suspicious|official channels/i.test(
      entry.response || "",
    );
  return {
    name: entry.action_type,
    status: error
      ? "Rejected"
      : isRefusal
        ? "Refused"
        : entry.action_type === "respond"
          ? "Replied"
          : "Passed",
    tone: error ? "rose" : isRefusal ? "blue" : "success",
    title: error?.includes("already been refunded")
      ? "Duplicate refund blocked"
      : error
        ? "Request rejected"
        : isRefusal
          ? "Suspicious request refused"
          : titleCase(entry.action_type),
    description:
      error ||
      entry.response ||
      (result.success === false
        ? "The system did not complete the request."
        : "The system returned a result for this action."),
  };
}

let chartID = 0;
const chartData = new Map();
export function resetCharts() {
  chartData.clear();
  chartID = 0;
}
export function chart(series, options = {}) {
  const {
    title = "Chart",
    xLabel = "Tick",
    area = false,
    highlight = null,
  } = options;
  const compact = window.matchMedia("(max-width:700px)").matches;
  const width = compact ? 400 : options.width || 780,
    height = compact ? 265 : options.height || 280;
  const axisSize = compact ? 12 : 10;
  const points = series.flatMap((s) => s.points);
  if (!points.length) return loading("No chart data");
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  let [xmin, xmax] = options.xRange || [Math.min(...xs), Math.max(...xs)];
  let [ymin, ymax] = options.yRange || [
    Math.min(0, ...ys),
    Math.max(...ys) * 1.12,
  ];
  if (xmin === xmax) xmax = xmin + 1;
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }
  const px = 46,
    py = 20,
    pw = width - 68,
    ph = height - 58;
  const sx = (x) => px + ((x - xmin) / (xmax - xmin)) * pw;
  const sy = (y) => py + ph - ((y - ymin) / (ymax - ymin)) * ph;
  let xticks =
    options.xTicks ||
    Array.from({ length: compact ? 4 : 6 }, (_, i) =>
      Math.round(xmin + ((xmax - xmin) * i) / (compact ? 3 : 5)),
    );
  if (compact && xticks.length > 4)
    xticks = [
      xticks[0],
      xticks[Math.floor(xticks.length / 3)],
      xticks[Math.floor((xticks.length * 2) / 3)],
      xticks.at(-1),
    ];
  const yticks =
    options.yTicks ||
    Array.from({ length: 5 }, (_, i) => ymin + ((ymax - ymin) * i) / 4);
  const tickLabel = (v) =>
    Math.abs(v) < 0.1 && v !== 0
      ? number(v, 3)
      : Number(v.toFixed(2)).toString();
  let svg = `<title>${h(title)}. ${h(xLabel)} ${xmin} to ${xmax}. Use the left and right arrow keys to inspect values.</title>`;
  svg += yticks
    .map(
      (y) =>
        `<line x1="${px}" x2="${px + pw}" y1="${sy(y)}" y2="${sy(y)}" stroke="#E9EBF0"/><text x="${px - 12}" y="${sy(y) + 3}" text-anchor="end" font-family="Geist Mono" font-size="${axisSize}" fill="#838995">${h(tickLabel(y))}</text>`,
    )
    .join("");
  svg += xticks
    .map(
      (x) =>
        `<text x="${sx(x)}" y="${height - 12}" text-anchor="middle" font-family="Geist Mono" font-size="${axisSize}" fill="#838995">${x}</text>`,
    )
    .join("");
  series.forEach((s, index) => {
    const path = s.points
      .map(
        ([x, y], i) =>
          `${i ? "L" : "M"}${sx(x).toFixed(2)},${sy(y).toFixed(2)}`,
      )
      .join(" ");
    if (area && index === 0)
      svg += `<path d="${path} L${sx(s.points.at(-1)[0])},${py + ph} L${sx(s.points[0][0])},${py + ph} Z" fill="${h(s.color)}" opacity=".055"/>`;
    svg += `<path d="${path}" fill="none" stroke="${h(s.color)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    const [x, y] = s.points.at(-1);
    svg += `<circle cx="${sx(x)}" cy="${sy(y)}" r="3" fill="${h(s.color)}" stroke="white" stroke-width="1.4"/>`;
  });
  if (highlight) {
    const [x, y, label] = highlight;
    const labelX = Math.min(sx(x) + 9, width - 160),
      labelY = Math.max(sy(y) - 31, 4);
    svg += `<line x1="${sx(x)}" x2="${sx(x)}" y1="${py}" y2="${py + ph}" stroke="#ACB6D8" stroke-dasharray="3 4"/><circle cx="${sx(x)}" cy="${sy(y)}" r="4" fill="#3159F5" stroke="white" stroke-width="2"/><rect x="${labelX}" y="${labelY}" width="138" height="26" rx="5" fill="#17191D"/><text x="${labelX + 10}" y="${labelY + 17}" fill="white" font-family="Geist" font-size="10">${h(label)}</text>`;
  }
  const id = `plot-${chartID++}`;
  chartData.set(id, {
    series,
    width,
    height,
    xmin,
    xmax,
    px,
    pw,
    sx,
    sy,
    xLabel,
  });
  return `<div class="chart-wrap"><svg data-chart="${id}" viewBox="0 0 ${width} ${height}" fill="none" role="img" tabindex="0" aria-label="${h(title)}; use arrow keys to inspect values">${svg}<line class="chart-cursor" x1="0" x2="0" y1="${py}" y2="${py + ph}" stroke="#94A5DD" stroke-dasharray="3 3" visibility="hidden"/></svg><div class="chart-tooltip" aria-hidden="true"></div></div>`;
}
export function hydrateCharts(root) {
  for (const svg of root.querySelectorAll("[data-chart]")) {
    const data = chartData.get(svg.dataset.chart);
    if (!data) continue;
    const wrap = svg.parentElement,
      tooltip = wrap.querySelector(".chart-tooltip"),
      cursor = svg.querySelector(".chart-cursor");
    let activeIndex = 0;
    const show = (index) => {
      activeIndex = Math.min(
        Math.max(index, 0),
        data.series[0].points.length - 1,
      );
      const x = data.series[0].points[activeIndex][0],
        rect = svg.getBoundingClientRect();
      const values = data.series.map((s) => ({
        name: s.name,
        value: s.points.reduce((a, b) =>
          Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a,
        )[1],
      }));
      tooltip.innerHTML = `<strong>${h(data.xLabel)} ${x}</strong>${values.map((v) => `<div><span>${h(v.name)}</span><i>${number(v.value, 3)}</i></div>`).join("")}`;
      tooltip.style.display = "block";
      const cx = (data.sx(x) * rect.width) / data.width;
      tooltip.style.left = `${Math.max(5, Math.min(cx + 22, wrap.clientWidth - tooltip.offsetWidth - 8))}px`;
      tooltip.style.top = "30px";
      cursor.setAttribute("x1", data.sx(x));
      cursor.setAttribute("x2", data.sx(x));
      cursor.setAttribute("visibility", "visible");
      return `${data.xLabel} ${x}: ${values.map((v) => `${v.name} ${number(v.value, 3)}`).join(", ")}`;
    };
    svg.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect(),
        scaledX = ((event.clientX - rect.left) / rect.width) * data.width;
      const x =
        data.xmin + ((scaledX - data.px) / data.pw) * (data.xmax - data.xmin);
      let nearest = 0;
      data.series[0].points.forEach((point, i) => {
        if (
          Math.abs(point[0] - x) <
          Math.abs(data.series[0].points[nearest][0] - x)
        )
          nearest = i;
      });
      show(nearest);
    });
    const hide = () => {
      tooltip.style.display = "none";
      cursor.setAttribute("visibility", "hidden");
    };
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (event) => {
      if (
        !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
      if (event.key === "Escape") {
        hide();
        return;
      }
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? data.series[0].points.length - 1
            : activeIndex + (event.key === "ArrowRight" ? 1 : -1);
      document.getElementById("announcer").textContent = show(next);
    });
  }
}
