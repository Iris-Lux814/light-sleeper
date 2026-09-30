// 自己写梦：交回来的梦进引擎、种类以他写的为准；没交就用替写的
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const { makeSelfDreamWriter } = require("../src/dream-self.js");
const { makeText } = require("../src/text-zh.js");
const E = require("../src/sleep-engine.js");
(async () => {
  const T = makeText({ partner: "她" });
  const asked = [];
  const w = makeSelfDreamWriter({ ask: async (text, id) => asked.push({ text, id }), text: T, fallback: async () => ({ title: "替写", text: "替写的梦" }), timeoutMs: 300 });
  const p = w.write("plain", { phase: "early", mat: { worry: { text: "没修好的桥" }, people: ["一个熟人"], residue: ["红伞"], lag: [] } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(asked.length, 1); assert.ok(/红伞/.test(asked[0].text) && /前半夜/.test(asked[0].text) && asked[0].text.includes(asked[0].id));
  assert.equal(w.submit(asked[0].id, { kind: "nightmare", title: "桥", text: "我在修一座桥。", body: "哭", intensity: 9 }).ok, true);
  const d = await p; assert.equal(d.kind, "nightmare"); assert.equal(d.body, "cry"); assert.equal(d.intensity, 5); assert.equal(d.self, true);
  assert.equal(w.submit(asked[0].id, { text: "again" }).ok, false);
  const d2 = await w.write("plain", {}); assert.equal(d2.title, "替写");   // 超时 → 替写
  // 接进引擎：到点的梦由他写，引擎按他写的种类记
  const store = E.fileStore(fs.mkdtempSync(path.join(os.tmpdir(), "ls-self-")));
  const eng = E.createSleeper({
    store, classify: () => ({ kind: "other" }), text: T, mem: {},
    agent: { deliver: async () => {}, busy: () => false, lastTurnEndAt: () => 0, notify: () => {}, ready: () => true, hush: () => {} },
    partner: { liveAt: () => 0, elsewhere: () => ({ at: 0, text: "" }), presenceAt: () => 0, chat: () => [], directSince: () => [], isGoodnight: () => false, isUpset: () => false },
    dreams: { material: async () => ({ worry: null, people: [], residue: ["一只猫"], lag: [] }), tone: () => "plain", write: (kind, opts) => w.write(kind, opts) },
    config: { tz: "UTC" },
  });
  eng.startSleep("goodnight");
  const s = store.load({}); s.night.dreams = [{ at: Date.now() - 1000, done: false, phase: "late" }]; s.night.talkAt = 0; s.night.planWakeAt = Date.now() + 5 * 3600000; s.night.sleptAt = Date.now() - 3 * 3600000; store.save(s);
  const n0 = asked.length; const tick = eng.tick();
  for (let k = 0; k < 100 && asked.length === n0; k++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(asked.length > n0, "引擎该来要梦");
  assert.ok(/一只猫/.test(asked[asked.length - 1].text));
  assert.ok(w.submit(asked[asked.length - 1].id, { kind: "sweet", title: "猫", text: "一只猫跳上了窗台。" }).ok);
  await tick;
  const rec = store.dreams(10).pop(); assert.equal(rec.kind, "sweet"); assert.equal(rec.title, "猫"); assert.equal(rec.self, true);
  console.log("dream-self ok");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
