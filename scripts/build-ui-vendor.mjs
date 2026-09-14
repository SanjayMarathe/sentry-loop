// Build checked-in, same-origin browser libraries. The Python app needs no Node runtime.
import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";

const out = new URL("../sentinelops_arena/ui/vendor/", import.meta.url);
await mkdir(out, { recursive: true });
await build({
  stdin: {
    contents:
      'export { default as ForceGraph3D } from "3d-force-graph"; export * as THREE from "three";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  outfile: new URL("graph-vendor.js", out).pathname,
  legalComments: "eof",
});
await build({
  stdin: {
    contents:
      'export { Terminal } from "@xterm/xterm"; export { FitAddon } from "@xterm/addon-fit";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  outfile: new URL("terminal-vendor.js", out).pathname,
  legalComments: "eof",
});
await copyFile(
  "node_modules/@xterm/xterm/css/xterm.css",
  new URL("xterm.css", out),
);
const notices = [];
for (const name of [
  "3d-force-graph",
  "three",
  "@xterm/xterm",
  "@xterm/addon-fit",
]) {
  const pkg = JSON.parse(
    await readFile(`node_modules/${name}/package.json`, "utf8"),
  );
  const license = await readFile(`node_modules/${name}/LICENSE`, "utf8");
  notices.push(`${name} ${pkg.version}\n${license}`);
}
await writeFile(new URL("LICENSES.txt", out), notices.join("\n\n"));
console.log("Bundled 3d-force-graph, Three.js, and xterm.js locally.");
