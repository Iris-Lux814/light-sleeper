// 最小的接法：一个在终端里跑的 agent。node examples/minimal.js
// 真用的时候：agent.deliver 换成往你的 agent 里递消息的函数，宿主每次递消息前先 await sleeper.gate(text, {label})，
// partner 换成你那边「对方在不在」的信号，dreams.write 换成调大模型写梦，每分钟调一次 sleeper.tick()。
"use strict";
const os = require("os"), path = require("path"), fs = require("fs");
const { createSleeper, fileStore } = require("../src/sleep-engine.js");
const { makeText } = require("../src/text-zh.js");

const chat = [];   // 对方说过的话 {at, text}
const sleeper = createSleeper({
  store: fileStore(fs.mkdtempSync(path.join(os.tmpdir(), "light-sleeper-"))),
  agent: {
    deliver: async (text) => console.log("→ agent:", text.split("\n")[0]),
    busy: () => false, lastTurnEndAt: () => 0, ready: () => true, hush: () => {},
    notify: (text, label) => console.log(`→ 通知对方 [${label}]:`, text),
  },
  partner: {
    liveAt: () => (chat.length ? chat[chat.length - 1].at : 0), elsewhere: () => ({ at: 0, text: "" }), presenceAt: () => 0,
    chat: () => chat, directSince: () => [],
    isGoodnight: (t) => /晚安|去睡了/.test(t), isUpset: (t) => /难过|哭/.test(t),
  },
  // 消息怎么认：这里约定对方的消息以 [partner] 开头
  classify: (text) => (text.startsWith("[partner]") ? { kind: "partner", marker: "", body: text.slice(9).trim(), urgent: /醒醒|急/.test(text), byName: false } : text.startsWith("/") ? { kind: "pass" } : { kind: "other" }),
  dreams: {
    material: async () => ({ worry: null, people: [], residue: [], lag: [] }),
    tone: () => "plain",
    write: async (kind, o) => ({ title: "一段路", text: "我在一条走不完的走廊里找一扇门。", fragment: "走廊", feeling: "急", intensity: 3, body: "", talk: "", worry: "", phase: o.phase }),
  },
  text: makeText({ partner: "她" }),
  config: { tz: "UTC" },
  log: (x) => console.log("  ·", x),
});

(async () => {
  chat.push({ at: Date.now(), text: "晚安" });
  sleeper.startSleep("goodnight");
  console.log("状态：", sleeper.api.status().status, "，计划睡到", new Date(sleeper.api.status().night.planWakeAt).toLocaleTimeString());
  for (let i = 0; i < 3; i++) {
    const r = await sleeper.gate(`[partner] 还醒着吗`, { label: "chat" });
    console.log("她发消息 →", r && r.hold ? "没叫醒，攒着" : r && r.text ? "叫醒了：" + r.text.split("\n")[0] : "放行");
    if (!r || !r.hold) break;
  }
  process.exit(0);
})();
