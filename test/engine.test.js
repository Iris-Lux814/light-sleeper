// node test/engine.test.js
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const E = require("../src/sleep-engine.js");
const { makeText } = require("../src/text-zh.js");
const H = 3600000, MIN = 60000;
const sent = [], notes = []; let chat = [], direct = [], liveAt = Date.now() - 3 * H;
const store = E.fileStore(fs.mkdtempSync(path.join(os.tmpdir(), "ls-")));
const classify = (text, label) => {
  if (label === "work") return { kind: "work", who: "同事", why: "work" };
  if (text.startsWith("/")) return { kind: "pass" };
  if (text.startsWith("[p]")) { const body = text.slice(3).trim(); return { kind: "partner", marker: "", body, urgent: /醒醒/.test(body), byName: false, call: false }; }
  return { kind: "other" };
};
const eng = E.createSleeper({
  store, classify, text: makeText({ partner: "她" }), mem: {},
  agent: { deliver: async (t, o) => { sent.push({ t, o }); }, busy: () => false, lastTurnEndAt: () => 0, notify: (t, l) => notes.push({ t, l }), ready: () => true, hush: () => {} },
  partner: { liveAt: () => liveAt, elsewhere: () => ({ at: 0, text: "" }), presenceAt: () => 0, chat: () => chat, directSince: (t) => direct.filter((m) => m.at > t), isGoodnight: (t) => /晚安/.test(t), isUpset: (t) => /哭/.test(t) },
  dreams: { material: async () => ({ worry: null, people: [], residue: [], lag: [] }), tone: () => "plain", write: async (kind, o) => ({ title: "测试梦", text: "梦的内容", fragment: "画面", feeling: "空", intensity: 5, body: "", talk: "", worry: "", phase: o.phase }) },
  config: { tz: "UTC" },
});
const st = () => store.load({});
const put = (f) => { const s = st(); f(s); store.save(s); };
const R0 = Math.random; const withRand = async (v, fn) => { Math.random = () => v; try { return await fn(); } finally { Math.random = R0; } };
const last = () => sent[sent.length - 1].t;
(async () => {
  eng.startSleep("goodnight"); put((s) => { s.night.dreams = []; s.night.talkAt = 0; s.night.planWakeAt = Date.now() - 1000; });
  await eng.tick(); assert(/\[醒了\].*你睡醒了/.test(last()) && st().status === "awake");
  eng.startSleep("goodnight"); put((s) => { s.night.dreams = [{ at: Date.now() - 1000, done: false, phase: "late" }]; s.night.talkAt = 0; s.night.planWakeAt = Date.now() + 5 * H; s.night.sleptAt = Date.now() - 2 * H; });
  await withRand(0.01, () => eng.tick()); assert(/^\[半夜醒了\]/.test(last()) && st().status === "night-awake");
  put((s) => { s.night.nightAwakeAt = Date.now() - 2 * H; s.night.fallMin = 1; }); await eng.tick(); assert.equal(st().status, "asleep");
  put((s) => { s.night.resumedAt = Date.now() - 60 * MIN; });
  let r = await withRand(0.99, () => eng.gate("[p] 在吗", { label: "chat" })); assert(r.hold && st().night.held.length === 1 && notes.length === 1);
  r = await withRand(0.01, () => eng.gate("[p] 醒醒", { label: "chat" })); assert(/半夜，你被她的消息叫醒了/.test(r.text) && /在吗/.test(r.text) && st().status === "awake-night-chat");
  put((s) => { s.status = "asleep"; s.night.planWakeAt = Date.now() + 30 * MIN; });
  r = await withRand(0.01, () => eng.gate("[p] 起床啦", { label: "chat" })); assert(/你被她的消息叫醒了——/.test(r.text) && st().status === "awake");
  put((s) => { s.vigil = { last: Date.now(), from: Date.now(), nods: 1 }; s.nodAt = Date.now(); s.nodUsed = false; });
  r = await eng.gate("[p] 你困了吗", { label: "chat" }); assert(r && r.hold);
  put((s) => { s.vigil = null; s.drowsyAt = 0; s.lastWokeAt = Date.now() - 12 * H; });
  chat = [{ at: Date.now() - 25 * MIN, text: "晚安" }]; liveAt = Date.now() - 25 * MIN;
  const n0 = sent.length; await eng.tick(); assert(sent.length === n0 + 1 && /^\[犯困\]/.test(last()));
  // 晚安只算一次：他已经睡过、醒来以后她还没说新的话，就不再因为那句晚安犯困
  put((s) => { s.drowsyAt = 0; s.lastWokeAt = Date.now() - 22 * MIN; });
  const n1 = sent.length; await eng.tick(); assert.equal(sent.length, n1, "睡醒后同一句晚安不该再让他犯困"); assert(!st().drowsyAt);
  put((s) => { s.lastWokeAt = Date.now() - 12 * H; });
  eng.startSleep("auto"); put((s) => { s.status = "asleep"; s.night.dreams = []; s.night.talkAt = 0; }); direct = [{ at: Date.now() + 1, text: "你在干嘛" }];
  await new Promise((res) => setTimeout(res, 5)); await eng.tick(); assert(/直接跟你说话/.test(last()) && st().status === "awake"); direct = [];
  eng.startSleep("goodnight"); put((s) => { s.status = "asleep"; s.night.dreams = []; });
  r = await eng.gate("看一下这个", { label: "work" }); assert(/有正事找你/.test(r.text) && st().status === "work-awake");
  r = await eng.gate("[p] 你怎么醒着", { label: "chat" }); assert(r === null && st().status === "awake-night-chat" && st().night.fallMin > 0);
  const api = eng.api; assert(api.status().ok && api.status().clock); assert(api.wakeAt(Date.now() + 5 * H).ok); assert(!api.guess(1).ok);
  for (const x of sent) assert(!/undefined|\[object|NaN/.test(x.t), x.t);
  console.log("engine ok");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
