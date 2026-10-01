"use strict";
// Runs adapters/operit/main.js + the subpackage in a fake Operit runtime (no Intl, no require except the bundle).
const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");

function runtime() {
  const files = new Map(), sent = [], ipc = {}, hooks = [];
  const ctx = {
    console: { log() {}, error() {} }, setTimeout, clearTimeout,
    getEnv: (k) => ({ LIGHT_SLEEPER_LANG: "en", LIGHT_SLEEPER_PARTNER: "Sam", LIGHT_SLEEPER_UTC_OFFSET: "480" })[k],
    getPluginConfigDir: () => "/plugins/light_sleeper", getChatId: () => "chat1",
    Tools: {
      Files: { read: async (p) => { if (!files.has(p)) throw new Error("no file"); return { content: files.get(p) }; }, write: async (p, c) => { files.set(p, c); return {}; }, mkdir: async () => ({}) },
      Chat: {
        sendMessage: async (message, chatId, a, b, opts) => { sent.push({ message, chatId, opts }); return { aiResponse: /^\[dream\]/.test(message) ? "I walk toward it." : "." }; },
        call: async () => ({ text: JSON.stringify({ scene: "You are on a pier.", title: "Pier", text: "I was on a pier.", shards: ["a pier", "wind"], fragment: "a pier", feeling: "calm", intensity: 3 }) }),
      },
      Workflow: { getAll: async () => [], create: async () => ({ ok: true }) },
    },
    ToolPkg: { ipc: { on: (ch, fn) => { ipc[ch] = fn; }, call: (ch, p) => ipc[ch](p) }, registerChatInputHook: (d) => hooks.push(d) },
    complete: (r) => { ctx.__done = r; },
  };
  vm.createContext(ctx); vm.runInContext("delete globalThis.Intl;", ctx);
  const dir = path.join(__dirname, "..", "adapters", "operit");
  const load = (file) => {
    const module = { exports: {} };
    const req = (p) => { if (p === "./lib/light-sleeper.js") return load(path.join(dir, "lib", "light-sleeper.js")); throw new Error("unexpected require " + p); };
    vm.runInContext(`(function (module, exports, require) {${fs.readFileSync(file, "utf8")}\n})`, ctx)(module, module.exports, req);
    return module.exports;
  };
  return { ctx, files, sent, ipc, hooks, main: load(path.join(dir, "main.js")), pkg: load(path.join(dir, "packages", "light_sleeper.js")) };
}

test("operit adapter: setup, gate, sleep, live dream, saved state", async () => {
  execFileSync(process.execPath, [path.join(__dirname, "..", "adapters", "operit", "build.js")]);
  const R = runtime();
  assert.equal(R.main.registerToolPkg(), true); assert.equal(R.hooks.length, 1);
  await R.pkg.setup({}); assert.equal(R.ctx.__done.success, true); assert.equal(R.ctx.__done.chatId, "chat1");
  const submit = (text, chatId = "chat1") => R.hooks[0].function({ eventName: "submit_requested", eventPayload: { text, chatId } });
  assert.equal(await submit("hello"), null, "awake: message passes");
  assert.equal(await submit("hi", "other"), null, "other chats untouched");
  await R.ipc["light_sleeper.sleep"]();
  assert.equal((await R.ipc["light_sleeper.status"]()).status.status, "asleep");
  // asleep: each message either wakes it (replace) or is held (consume)
  const r = await submit("are you up?");
  assert.ok(r && (r.action === "consume" || r.action === "replace"));
  if (r.action === "replace") return;   // woke up this time; the dream part needs it asleep
  // make the first dream due and tick
  const data = JSON.parse(R.files.get("/plugins/light_sleeper/data.json"));
  const st = JSON.parse(data.state); assert.ok(st.night, "asleep with a night planned");
  if (!st.night.dreams.length) return;   // a short night can have no dreams planned
  st.night.dreams[0].at = 0; st.night.dreams[0].phase = "early"; data.state = JSON.stringify(st);
  R.files.set("/plugins/light_sleeper/data.json", JSON.stringify(data));
  const R2 = runtime(); R2.files.set("/plugins/light_sleeper/data.json", JSON.stringify(data));   // fresh process: state comes from the file
  R2.main.registerToolPkg();
  await R2.pkg.tick({});
  const dreams = await R2.ipc["light_sleeper.dreams"]({});
  assert.ok(dreams.length >= 1 && dreams[0].live, "a live dream was dreamt");
  assert.ok(R2.sent.length >= 1 && R2.sent.every((s) => /^\[dream\]/.test(s.message) && s.chatId === "chat1" && s.opts.hide_user_message));
  assert.ok(JSON.parse(JSON.parse(R2.files.get("/plugins/light_sleeper/data.json")).dreams).length >= 1, "saved to the file");
});

test("operit manifest: the bundle id differs from every subpackage id", () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "adapters", "operit", "manifest.json"), "utf8"));
  assert.ok(m.subpackages.length && m.subpackages.every((s) => s.id !== m.toolpkg_id), "Operit refuses to activate a subpackage that shares the bundle's id");
});
