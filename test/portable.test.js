"use strict";
const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { makeTz } = require("../src/tz.js");
const { kvStore, memoryStore } = require("../src/sleep-engine.js");

test("tz: same as Intl, and a fixed offset without it", () => {
  const z = makeTz("Asia/Tokyo"), f = makeTz("Asia/Tokyo", 540);
  for (let i = 0; i < 500; i++) {
    const t = 1.75e12 + Math.random() * 1e11;
    assert.equal(z.time(t), new Date(t).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }));
    assert.equal(z.day(t), new Date(t).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }));
    assert.equal(f.time(t), z.time(t)); assert.equal(f.day(t), z.day(t));
  }
});

test("kvStore keeps the store interface on a key-value backend", () => {
  const m = new Map(); const s = kvStore({ get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) }, { keep: 3 });
  assert.deepEqual(s.load({ a: 1 }), { a: 1 });
  s.save({ status: "asleep" }); assert.equal(s.load({}).status, "asleep");
  for (let i = 0; i < 5; i++) s.appendDream({ id: i });
  assert.deepEqual(s.dreams(10).map((d) => d.id), [2, 3, 4]);
  s.writeDreams([{ id: 9 }]); assert.equal(s.dreams()[0].id, 9);
  assert.equal(memoryStore().nights().length, 0);
});

test("bundle runs without require and without Intl", () => {
  execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "bundle.js")]);
  const ctx = { setTimeout, clearTimeout }; vm.createContext(ctx);
  vm.runInContext("delete globalThis.Intl;", ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "dist", "light-sleeper.js"), "utf8"), ctx);
  const st = vm.runInContext(`(() => {
    const L = LightSleeper;
    const s = L.createSleeper({ store: L.memoryStore(),
      agent: { deliver: async () => {}, busy: () => false, lastTurnEndAt: () => 0, ready: () => true, hush: () => {}, notify: () => {} },
      partner: { liveAt: () => 0, elsewhere: () => ({ at: 0, text: "" }), presenceAt: () => 0, chat: () => [], directSince: () => [], isGoodnight: () => true, isUpset: () => false },
      classify: () => ({ kind: "other" }), dreams: { material: async () => ({}), tone: () => "plain", write: async () => null },
      text: L.textEn.makeText({}), config: { tz: "Asia/Tokyo", utcOffsetMin: 540 } });
    s.startSleep("goodnight"); return s.api.status().status; })()`, ctx);
  assert.equal(st, "asleep");
});
