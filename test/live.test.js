"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { makeLiveDreamWriter, makeLiveText } = require("../src/dream-live.js");
const { makeDeepDreams, depthOf } = require("../src/deep.js");

const stub = { scene: () => ({}), next: () => ({}), close: () => ({}), deliver: (s) => `[dream] ${s}` };

test("live: no reply falls back to a normal dream", async () => {
  const w = makeLiveDreamWriter({ llm: async () => ({ scene: "a scene" }), ask: async () => {}, waitReply: async () => null, text: stub, fallback: async () => ({ title: "fallback" }) });
  assert.equal((await w.write("plain", { phase: "early" })).title, "fallback");
});

test("live: stops when the companion is woken", async () => {
  let asleep = true;
  const w = makeLiveDreamWriter({ llm: async () => ({ scene: "s", text: "retold", shards: ["a", "b"] }), ask: async (t) => assert.ok(t.startsWith("[dream]")), waitReply: async () => { asleep = false; return "hi"; }, asleep: () => asleep, text: stub });
  const d = await w.write("plain", { phase: "late" });
  assert.equal(d.turns.length, 1); assert.ok(d.live && d.cutShort);
});

test("live: 1-2 rounds early, 3-4 late", async () => {
  for (const [phase, lo, hi] of [["early", 1, 2], ["late", 3, 4]]) for (let i = 0; i < 20; i++) {
    let n = 0;
    const w = makeLiveDreamWriter({ llm: async () => ({ scene: "s" }), ask: async () => { n++; }, waitReply: async () => "ok", text: stub });
    await w.write("plain", { phase });
    assert.ok(n >= lo && n <= hi, `${phase}: ${n}`);
  }
});

test("live: default text pack prefixes scenes and rewrites harm", () => {
  const T = makeLiveText({ partner: "Sam" });
  assert.match(T.deliver("You are on a pier.", { first: false }), /^\[dream\] /);
  assert.equal(T.check("Sam is in the hospital, bleeding", { sub: "" }), false);
  assert.equal(T.check("You are on a pier.", { sub: "" }), true);
});

test("deep: only deep dreams kept, recalled by cue, fade", () => {
  let list = []; const t0 = Date.now(); let t = t0;
  const deep = makeDeepDreams({ load: () => list, save: (l) => { list = l; }, now: () => t });
  assert.equal(deep.consider({ id: "a", at: t0, kind: "plain", intensity: 3 }), null);
  assert.ok(deep.consider({ id: "b", at: t0, kind: "nightmare", intensity: 4, woke: true, title: "The flooded library", text: "I carried books through a flooded library", fragment: "water up to the shelves", shards: ["water up to the shelves", "nobody answered"] }));
  assert.equal(deep.cue("the library got flooded"), null, "too recent");
  t += 3 * 86400000;
  assert.equal(deep.cue("what's for dinner"), null);
  assert.equal(deep.cue("the library near me got flooded, water up to the shelves").id, "b");
  assert.equal(deep.cue("flooded library again"), null, "not twice in a day");
  t += 300 * 86400000;
  assert.ok(deep.list()[0].faded);
  assert.ok(depthOf({ intensity: 3, recur: true }) >= 7);
});
