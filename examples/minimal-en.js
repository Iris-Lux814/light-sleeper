// The smallest possible wiring: an agent that lives in a terminal. Run: node examples/minimal-en.js
// For real use: agent.deliver sends a line into your agent, the host awaits sleeper.gate(text, {label}) before every delivery,
// partner reports whether the user is around, dreams.write calls a model (see src/dream-prompt.js), and sleeper.tick() runs once a minute.
"use strict";
const os = require("os"), path = require("path"), fs = require("fs");
const { createSleeper, fileStore } = require("../src/sleep-engine.js");
const { makeText } = require("../src/text-en.js");

const chat = [];   // what the partner said: {at, text}
const sleeper = createSleeper({
  store: fileStore(fs.mkdtempSync(path.join(os.tmpdir(), "light-sleeper-"))),
  agent: {
    deliver: async (text) => console.log("→ agent:", text.split("\n")[0]),
    busy: () => false, lastTurnEndAt: () => 0, ready: () => true, hush: () => {},
    notify: (text, label) => console.log(`→ notify partner [${label}]:`, text),
  },
  partner: {
    liveAt: () => (chat.length ? chat[chat.length - 1].at : 0), elsewhere: () => ({ at: 0, text: "" }), presenceAt: () => 0,
    chat: () => chat, directSince: () => [],
    isGoodnight: (t) => /good ?night|going to bed/i.test(t), isUpset: (t) => /sad|crying/i.test(t),
  },
  // how messages are recognized: here, partner messages start with [partner]
  classify: (text) => (text.startsWith("[partner]") ? { kind: "partner", marker: "", body: text.slice(9).trim(), urgent: /wake up|urgent/i.test(text), byName: false } : text.startsWith("/") ? { kind: "pass" } : { kind: "other" }),
  dreams: {
    material: async () => ({ worry: null, people: [], residue: [], lag: [] }),
    tone: () => "plain",
    write: async (kind, o) => ({ title: "The hallway", text: "I was in a hallway that never ended, looking for a door.", fragment: "the hallway", feeling: "hurried", intensity: 3, body: "", talk: "", worry: "", phase: o.phase }),
  },
  text: makeText({ partner: "Sam", name: "Robin" }),
  config: { tz: "UTC" },
  log: (x) => console.log("  ·", x),
});

(async () => {
  chat.push({ at: Date.now(), text: "good night" });
  sleeper.startSleep("goodnight");
  console.log("status:", sleeper.api.status().status, "| planned wake:", new Date(sleeper.api.status().night.planWakeAt).toISOString());
  for (let i = 0; i < 3; i++) {
    const r = await sleeper.gate("[partner] you still up?", { label: "chat" });
    console.log("partner sends a message →", r && r.hold ? "didn't wake, saved for later" : r && r.text ? "woke up: " + r.text.split("\n")[0] : "passed through");
    if (!r || !r.hold) break;
  }
  process.exit(0);
})();
