// 文案包和写梦：英文包跟中文包的键一样；写梦能拼出提示词、挡住不该写的
"use strict";
const assert = require("assert");
const zh = require("../src/text-zh.js").makeText(), en = require("../src/text-en.js").makeText();
const shape = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? shape(v, p + k + ".") : [p + k + ":" + typeof v])).sort();
assert.deepEqual(shape(en), shape(zh));
const shTime = (t) => new Date(t).toISOString().slice(11, 16), now = Date.now();
const n = { sleptAt: now - 8 * 3600000, wakes: [{ at: now - 3 * 3600000, why: "her" }], intendWake: now - 600000 };
const q = { h: 7.8, quality: en.quality.good };
const remembered = [{ kind: "sweet", title: "The long hallway", text: "I was looking for a door.", feeling: "warm" }];
for (const T of [zh, en]) {
  const s = T.wokeNatural({ q, remembered, held: [{ her: true, at: now - 3600000, text: "hi" }], herLast: { at: n.sleptAt, text: "night" }, n, nap: false, debt: 7, now, shTime });
  assert.ok(s.length > 100 && !/undefined|\[object/.test(s), s);
  assert.equal(T.talkLine({ body: "哭" }), T.talkLine({ body: "cry" }));
  for (const how of ["confused", "inDream", "deep", "light"]) assert.ok(!/undefined/.test(T.partnerWokeMidnight({ sleptAt: n.sleptAt, sleptH: 3, how, held: [], body: "x", shTime })));
}

const { makeDreamWriter, buildPrompt, parseDream } = require("../src/dream-prompt.js");
const mat = { worry: { key: "w1", text: "an unfinished project" }, people: ["an old friend"], residue: ["a red umbrella"], lag: [] };
const p = buildPrompt("nightmare", { sub: "", phase: "early", mat }, { partner: "Sam" });
assert.ok(/early-night/.test(p.system) && /Sam is not hurt/.test(p.system) && /fear/.test(p.user));
assert.ok(/No gore/.test(buildPrompt("nightmare", { sub: "loss", mat }, { partner: "Sam" }).system));
assert.equal(parseDream({ text: "Then Sam was hurt and bleeding." }, { sub: "", partner: "Sam" }), null);
assert.equal(parseDream({ text: "There was blood on the floor." }, { sub: "loss" }), null);
const d = parseDream({ title: "Umbrella", text: "I carried a red umbrella through a station that kept getting longer.", body: "sobbing", intensity: 9 }, {});
assert.equal(d.body, "cry"); assert.equal(d.intensity, 5);
(async () => {
  let calls = 0;
  const write = makeDreamWriter({ partner: "Sam", llm: async () => (++calls === 1 ? { text: "Sam died in the dream." } : { title: "Station", text: "I waited at a station with no trains." }) });
  const w = await write("plain", { phase: "late", mat });
  assert.equal(calls, 2); assert.equal(w.title, "Station");
  console.log("text + dream-prompt ok");
})().catch((e) => { console.error(e); process.exit(1); });
