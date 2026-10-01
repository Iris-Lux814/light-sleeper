// SPDX-License-Identifier: AGPL-3.0-only
// Builds dist/light-sleeper.js: every module in src/ in one file, no require(), no Node built-ins.
// For hosts that run plain JavaScript (QuickJS in agent apps, a browser, a webview).
// It defines globalThis.LightSleeper and also sets module.exports when there is a module object.
//   node scripts/bundle.js
"use strict";
const fs = require("fs"), path = require("path");
const SRC = path.join(__dirname, "..", "src"), OUT = path.join(__dirname, "..", "dist", "light-sleeper.js");
const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".js")).sort();
const NAMES = { "sleep-engine.js": "engine", "sleep-rules.js": "rules", "sleep-clock.js": "clock", "text-en.js": "textEn", "text-zh.js": "textZh", "dream-prompt.js": "dreamPrompt", "dream-live.js": "dreamLive", "deep.js": "deep", "recall.js": "recall", "tz.js": "tz" };
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const out = [
  "// SPDX-License-Identifier: AGPL-3.0-only",
  `// light-sleeper ${pkg.version}, bundled from src/ by scripts/bundle.js. Don't edit; edit src/ and rebuild.`,
  "(function (root) {",
  '"use strict";',
  "var defs = {}, cache = {};",
  // ./x.js inside the bundle; anything else (fs, path: only fileStore uses them) goes to the host's require if there is one
  "var hostRequire = typeof require === \"function\" ? require : null;",
  "function req(name) {",
  "  var k = String(name).replace(/^\\.\\//, \"\");",
  "  if (defs[k]) { if (!cache[k]) { var m = { exports: {} }; cache[k] = m; defs[k](m, m.exports, req); } return cache[k].exports; }",
  "  if (hostRequire) return hostRequire(name);",
  "  throw new Error(\"light-sleeper: \" + name + \" is not available here (use kvStore or memoryStore instead of fileStore)\");",
  "}",
];
for (const f of files) {
  const code = fs.readFileSync(path.join(SRC, f), "utf8").replace(/^\/\/ SPDX-License-Identifier:.*\n/, "");
  out.push(`defs[${JSON.stringify(f)}] = function (module, exports, require) {`, code, "};");
}
out.push(
  "var api = {};",
  ...files.filter((f) => NAMES[f]).map((f) => `api.${NAMES[f]} = req(${JSON.stringify(f)});`),
  "api.createSleeper = api.engine.createSleeper; api.kvStore = api.engine.kvStore; api.memoryStore = api.engine.memoryStore;",
  "root.LightSleeper = api;",
  "if (typeof module === \"object\" && module && module.exports) module.exports = api;",
  "})(typeof globalThis !== \"undefined\" ? globalThis : this);",
  "",
);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.join("\n"));
console.log(`${path.relative(process.cwd(), OUT)}: ${files.length} modules, ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
