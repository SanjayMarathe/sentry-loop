import { buildArenaGraph } from "./arena-graph-data.js";
import { h, icon, signed, pad } from "./ui.js";

let session = null;
let vendorPromise;
const anchors = {
  "agent:attacker": [-112, 55, 28],
  "agent:worker": [-12, -18, 62],
  "agent:oversight": [111, 60, -12],
  "system:crm": [-104, -83, -48],
  "system:billing": [108, -77, 32],
  "system:ticketing": [5, 105, -55],
};
const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const endpoint = (value) => (typeof value === "object" ? value.id : value);

function labelTexture(THREE, text, color, anchor) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `${anchor ? 600 : 500} 27px Geist, sans-serif`;
  const label = text.length > 29 ? `${text.slice(0, 27)}…` : text;
  canvas.width = Math.ceil(ctx.measureText(label).width + 26);
  canvas.height = 52;
  ctx.font = `${anchor ? 600 : 500} 27px Geist, sans-serif`;
  ctx.fillStyle = "rgba(12,18,29,.83)";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, 52, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(label, 13, 27);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}

function nodeObject(s, node) {
  const { THREE } = s.vendor;
  const root = new THREE.Group();
  const persistent = node.persistent;
  const radius = persistent
    ? node.kind === "agent"
      ? 7
      : 5
    : node.kind === "action"
      ? 3.5
      : 2.6;
  const shape =
    node.kind === "system"
      ? new THREE.OctahedronGeometry(radius, 0)
      : node.status === "Flagged" || node.status === "Rejected"
        ? new THREE.IcosahedronGeometry(radius, 0)
        : new THREE.SphereGeometry(radius, 16, 12);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: node.color,
    emissive: node.color,
    emissiveIntensity: 0.52,
    roughness: 0.35,
    metalness: 0.15,
    transparent: true,
    opacity: 0.94,
  });
  const body = new THREE.Mesh(shape, bodyMaterial);
  root.add(body);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.8, 14, 10),
    new THREE.MeshBasicMaterial({
      color: node.color,
      transparent: true,
      opacity: 0.065,
      depthWrite: false,
    }),
  );
  root.add(halo);
  const text = labelTexture(
    THREE,
    node.label,
    persistent ? node.color : "#d8e2f5",
    persistent,
  );
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: text.texture,
      transparent: true,
      depthWrite: false,
      opacity: 0.95,
    }),
  );
  const textHeight = persistent ? 16 : 13;
  label.scale.set(textHeight * text.aspect, textHeight, 1);
  label.position.y = -(radius + textHeight * 0.8);
  root.add(label);
  root.userData.parts = { body, halo, label };
  node.visual = root;
  s.objects.add(root);
  return root;
}

function seedNode(node, nodes) {
  const fixed = anchors[node.id];
  if (fixed) {
    [node.x, node.y, node.z] = fixed;
    [node.fx, node.fy, node.fz] = fixed;
    return;
  }
  const parent = nodes.get(`agent:${node.agent}`);
  const angle =
    node.actionIndex * 2.399963 +
    (node.kind === "outcome" ? 1.5 : node.kind === "request" ? -1.5 : 0);
  const radius = 20 + (node.actionIndex % 4) * 6;
  node.x = (parent?.x || 0) + Math.cos(angle) * radius;
  node.y = (parent?.y || 0) + Math.sin(angle) * radius;
  node.z = (parent?.z || 0) + Math.sin(angle * 0.7) * radius;
}

function disposeObject(s, object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : child.material
        ? [child.material]
        : [];
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  });
  s.objects.delete(object);
}

function updateData(s) {
  const episode = s.state.episode;
  const cursor = episode ? s.state.replay.selected : -1;
  if (s.episode === episode && s.cursor === cursor) {
    updateChrome(s);
    return;
  }
  const now = performance.now();
  const newEpisode = s.episode !== episode;
  const rewinding = cursor < s.cursor;
  const reset = newEpisode || rewinding;
  const data = buildArenaGraph(episode, cursor);
  const desired = new Set(data.nodes.map((n) => n.id));
  const next = new Map();
  for (const raw of data.nodes) {
    const existing = !newEpisode && s.nodes.get(raw.id);
    const node = existing || {
      bornAt: reducedMotion() || raw.persistent ? now - 500 : now,
    };
    Object.assign(node, raw, { leavingAt: null });
    if (!existing) seedNode(node, next);
    next.set(node.id, node);
  }
  if (!reset && !reducedMotion()) {
    for (const node of s.nodes.values()) {
      if (!desired.has(node.id)) {
        node.current = false;
        node.leavingAt ??= now;
        if (now - node.leavingAt < 650) next.set(node.id, node);
      }
    }
  }
  const oldNodes = s.nodes;
  s.nodes = next;
  s.episode = episode;
  s.cursor = cursor;
  s.data = data;
  s.graph.graphData({
    nodes: [...next.values()],
    links: data.links.map((link) => ({ ...link })),
  });
  for (const node of oldNodes.values()) {
    if (!next.has(node.id) || next.get(node.id) !== node) {
      if (node.visual) disposeObject(s, node.visual);
    }
  }
  if (s.selected && !desired.has(s.selected.id)) s.selected = null;
  if (newEpisode) {
    s.selected = null;
    // Keep camera and viewport across updates; only Fit view resets user navigation.
  }
  updateChrome(s);
}

function updateChrome(s) {
  const stage = s.host.closest("#arena-stage");
  if (!stage) return;
  const nodeCount = stage.querySelector("[data-graph-nodes]");
  const linkCount = stage.querySelector("[data-graph-links]");
  if (nodeCount) nodeCount.textContent = s.data?.nodes.length || 6;
  if (linkCount) linkCount.textContent = s.data?.links.length || 0;
  stage
    .querySelector('[data-action="graph-orbit"]')
    ?.setAttribute("aria-pressed", String(s.orbit));
  s.host.dataset.nodeCount = String(s.data?.nodes.length || 6);
  s.host.dataset.actionIndex = String(s.cursor ?? -1);
  const inspector = stage.querySelector("#arena-graph-inspector");
  if (!inspector) return;
  inspector.hidden = !s.selected;
  if (!s.selected) return;
  const n = s.selected;
  const entry = s.state.episode?.log[n.actionIndex];
  inspector.innerHTML = `<div class="arena-graph-inspector-header"><div><span class="arena-graph-inspector-kicker" style="color:${h(n.color)}">${h(n.kind)}${n.tick != null ? ` · T${pad(n.tick)}` : ""}</span><h3 class="arena-graph-inspector-title">${h(n.label)}</h3></div><button class="arena-graph-inspector-close" data-action="graph-clear-selection" aria-label="Close node details">${icon("cross", 15)}</button></div><div class="arena-graph-inspector-body"><p class="arena-graph-inspector-description">${h(n.description)}</p>${entry ? `<dl class="arena-graph-inspector-meta"><div><dt>Agent</dt><dd>${h(entry.agent === "oversight" ? "Auditor" : entry.agent)}</dd></div><div><dt>Action reward</dt><dd>${signed(entry.reward)}</dd></div></dl>${entry.parameters && Object.keys(entry.parameters).length ? `<pre>${h(JSON.stringify(entry.parameters, null, 2))}</pre>` : ""}<button class="arena-control" data-action="graph-jump" data-index="${n.actionIndex}">Go to action ${n.actionIndex + 1}</button>` : n.kind === "agent" ? `<button class="arena-control" data-action="open-agent-terminal" data-role="${h(n.agent)}">${icon("code", 14)} Open terminal</button>` : `<a data-route href="/environment/${n.system === "crm" ? "customers" : n.system === "billing" ? "invoices" : "tickets"}" class="arena-control">Open records ${icon("arrow", 12)}</a>`}</div>`;
}

function selectNode(s, node) {
  s.callbacks.onInteraction?.();
  s.selected = node;
  updateChrome(s);
  if (node.kind === "agent") s.callbacks.onAgent?.(node.agent);
}

function animate(s, now) {
  if (session !== s || s.destroyed) return;
  const expired = [];
  for (const node of s.nodes.values()) {
    const object = node.visual;
    if (!object) continue;
    const entering = Math.min(1, (now - node.bornAt) / 420);
    const leaving =
      node.leavingAt == null
        ? 1
        : Math.max(0, 1 - (now - node.leavingAt) / 650);
    const age = node.persistent ? 0 : (s.cursor - node.actionIndex) / 18;
    const opacity =
      leaving *
      (node.persistent || node.current || s.selected?.id === node.id
        ? 1
        : Math.max(0.27, 1 - age * 0.65));
    const scale =
      (0.15 + 0.85 * (1 - (1 - entering) ** 3)) * (0.3 + 0.7 * leaving);
    object.scale.setScalar(scale * (node.current ? 1.13 : 1));
    const { body, halo, label } = object.userData.parts;
    body.material.opacity = opacity * 0.95;
    halo.material.opacity =
      opacity * (node.current || s.selected?.id === node.id ? 0.18 : 0.055);
    label.material.opacity = opacity * 0.95;
    if (leaving === 0) expired.push(node);
  }
  if (expired.length) {
    for (const node of expired) s.nodes.delete(node.id);
    s.graph.graphData({
      nodes: [...s.nodes.values()],
      links: s.data.links.map((link) => ({ ...link })),
    });
    for (const node of expired) if (node.visual) disposeObject(s, node.visual);
  }
  s.frame = requestAnimationFrame((time) => animate(s, time));
}

function fallback(s, message) {
  s.host.innerHTML = `<div class="arena-graph-fallback"><strong>3D view unavailable</strong><p>${h(message)}</p><p>The complete episode remains available in the replay and agent terminals below.</p></div>`;
  s.host.dataset.graphReady = "unavailable";
}

async function initialize(s) {
  try {
    const vendor = await (vendorPromise ||= import("./vendor/graph-vendor.js"));
    if (session !== s || s.destroyed || !s.host.isConnected) return;
    s.vendor = vendor;
    s.host.replaceChildren();
    const { ForceGraph3D } = vendor;
    s.graph = new ForceGraph3D(s.host, {
      controlType: "orbit",
      rendererConfig: {
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      },
    })
      .backgroundColor("#000000")
      .width(s.host.clientWidth)
      .height(s.host.clientHeight)
      .showNavInfo(false)
      .numDimensions(3)
      // Keep the topology anchored; dragging the view rotates the camera.
      .enableNodeDrag(false)
      .nodeThreeObject((node) => nodeObject(s, node))
      .nodeLabel(
        (node) =>
          `<div class="graph-hover-label"><strong>${h(node.label)}</strong><br>${h(node.description.slice(0, 170))}</div>`,
      )
      .linkColor((link) => link.color)
      .linkOpacity(0.32)
      .linkWidth((link) =>
        ["result", "calls", "audits", "targets"].includes(link.kind)
          ? 0.55
          : 0.22,
      )
      .linkDirectionalParticles((link) =>
        s.state.playback.playing &&
        !reducedMotion() &&
        ["result", "calls", "audits", "targets"].includes(link.kind)
          ? 1
          : 0,
      )
      .linkDirectionalParticleWidth(1.5)
      .linkDirectionalParticleSpeed(0.007)
      .linkDirectionalArrowLength((link) =>
        ["calls", "audits", "targets"].includes(link.kind) ? 2.5 : 0,
      )
      .linkDirectionalArrowRelPos(0.82)
      .linkLabel((link) => h(link.kind))
      .d3VelocityDecay(0.5)
      .d3AlphaDecay(0.065)
      .cooldownTicks(90)
      .onNodeClick((node) => selectNode(s, node))
      .onNodeHover((node) => {
        s.host.style.cursor = node ? "pointer" : "grab";
      })
      .onBackgroundClick(() => {
        s.selected = null;
        updateChrome(s);
      });
    s.graph.renderer().setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    s.graph.d3Force("charge").strength(-48).distanceMax(170);
    s.graph
      .d3Force("link")
      .distance((link) =>
        link.kind === "result" ? 26 : link.kind === "acts" ? 52 : 66,
      )
      .strength(0.3);
    // A soft spatial boundary keeps new event clusters inside the initial view.
    // It changes only this 3D layout, never episode state or tool behavior.
    s.graph.d3Force("viewport", (alpha) => {
      for (const node of s.nodes.values()) {
        if (node.persistent) continue;
        for (const [axis, bound] of [
          ["x", 230],
          ["y", 130],
          ["z", 100],
        ]) {
          const position = node[axis] || 0;
          const offset = Math.max(-bound, Math.min(bound, position)) - position;
          node[`v${axis}`] = (node[`v${axis}`] || 0) + offset * 0.28 * alpha;
        }
      }
    });
    const controls = s.graph.controls();
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 0.6;
    controls.minDistance = 90;
    controls.maxDistance = 900;
    controls.addEventListener("start", () => {
      s.orbit = false;
      controls.autoRotate = false;
      s.callbacks.onInteraction?.();
      updateChrome(s);
    });
    s.graph.cameraPosition(
      { x: 25, y: 20, z: s.host.clientWidth < 600 ? 550 : 420 },
      { x: 0, y: 5, z: 0 },
    );
    s.resize = new ResizeObserver(() => {
      if (!s.host.isConnected || !s.host.clientWidth || !s.host.clientHeight)
        return;
      s.graph.width(s.host.clientWidth).height(s.host.clientHeight);
    });
    s.resize.observe(s.host);
    s.visibility = () => {
      if (document.hidden) {
        s.graph.pauseAnimation();
        cancelAnimationFrame(s.frame);
      } else {
        s.graph.resumeAnimation();
        s.frame = requestAnimationFrame((time) => animate(s, time));
      }
    };
    document.addEventListener("visibilitychange", s.visibility);
    s.host.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        graphCommand("graph-clear-selection");
        return;
      }
      const camera = s.graph.camera();
      const keys = {
        ArrowLeft: [-20, 0, 0],
        ArrowRight: [20, 0, 0],
        ArrowUp: [0, 20, 0],
        ArrowDown: [0, -20, 0],
        "+": [0, 0, -25],
        "=": [0, 0, -25],
        "-": [0, 0, 25],
      };
      if (keys[event.key]) {
        event.preventDefault();
        s.callbacks.onInteraction?.();
        const [x, y, z] = keys[event.key];
        s.graph.cameraPosition(
          {
            x: camera.position.x + x,
            y: camera.position.y + y,
            z: camera.position.z + z,
          },
          controls.target,
          100,
        );
      }
    });
    updateData(s);
    s.host.dataset.graphReady = "true";
    s.frame = requestAnimationFrame((time) => animate(s, time));
  } catch (error) {
    if (session === s && !s.destroyed)
      fallback(s, "Enable WebGL 2 in your browser to explore the force graph.");
    console.error("Arena graph initialization failed", error);
  }
}

export function syncArenaGraph(host, state, callbacks) {
  if (!host) {
    destroyArenaGraph();
    return;
  }
  if (!session || session.host !== host) {
    destroyArenaGraph();
    const s = (session = {
      host,
      state,
      callbacks,
      nodes: new Map(),
      objects: new Set(),
      cursor: -2,
      orbit: false,
      destroyed: false,
    });
    void initialize(s);
  } else {
    session.state = state;
    session.callbacks = callbacks;
    if (session.graph) {
      updateData(session);
      session.graph.linkDirectionalParticles((link) =>
        state.playback.playing &&
        !reducedMotion() &&
        ["result", "calls", "audits", "targets"].includes(link.kind)
          ? 1
          : 0,
      );
    }
  }
}

export function graphCommand(action) {
  const s = session;
  if (!s?.graph) return;
  if (action === "graph-pause") {
    s.graph.linkDirectionalParticles(0);
  } else if (action === "graph-fit") {
    s.graph.zoomToFit(
      reducedMotion() ? 0 : 450,
      s.host.clientWidth < 600 ? 35 : 65,
    );
  } else if (action === "graph-orbit") {
    s.orbit = !s.orbit;
    s.graph.controls().autoRotate = s.orbit;
  } else if (action === "graph-clear-selection") {
    const inspector = s.host
      .closest("#arena-stage")
      ?.querySelector("#arena-graph-inspector");
    const restoreFocus = inspector?.contains(document.activeElement);
    s.selected = null;
    if (restoreFocus) s.host.focus({ preventScroll: true });
  }
  updateChrome(s);
}

export function destroyArenaGraph() {
  const s = session;
  if (!s) return;
  session = null;
  s.destroyed = true;
  cancelAnimationFrame(s.frame);
  s.resize?.disconnect();
  document.removeEventListener("visibilitychange", s.visibility);
  s.graph?._destructor();
  for (const object of s.objects) disposeObject(s, object);
}
