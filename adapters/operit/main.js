// SPDX-License-Identifier: AGPL-3.0-only
// light-sleeper for Operit (ToolPkg main context).
//
// - Every message you send in the bound chat goes through the sleep gate (chat input hook). Asleep and not woken:
//   the message is held and shown when it wakes. Woken: the message is sent with a short note on how it woke.
// - The engine talks to the AI (waking up, drowsy, a nightmare, a live dream scene) with send_message_to_ai.
// - Dreams are written by the chat model configured in Operit (Tools.Chat.call), so no extra API key is needed.
// - The clock: the "tick" tool, run by a workflow every 15 minutes (the shortest Operit allows) and on every message.
// - State is one JSON file in the plugin config folder (/sdcard/Download/Operit/plugins/light_sleeper/).
//
// Settings (environment, all optional): LIGHT_SLEEPER_PARTNER (what the AI calls you), LIGHT_SLEEPER_LANG (zh | en),
// LIGHT_SLEEPER_UTC_OFFSET (minutes, e.g. 480 for UTC+8; default: the phone's time), LIGHT_SLEEPER_DREAMS (live | model).
"use strict";
const L = require("./lib/light-sleeper.js");

const ID = "light_sleeper";
const MARK = "[partner]";
const env = (k, d) => { try { const v = getEnv(k); return v == null || v === "" ? d : v; } catch { return d; } };
const LANG = /^zh/i.test(env("LIGHT_SLEEPER_LANG", "zh")) ? "zh" : "en";
const PARTNER = env("LIGHT_SLEEPER_PARTNER", LANG === "zh" ? "她" : "my partner");
const OFFSET = env("LIGHT_SLEEPER_UTC_OFFSET", "") === "" ? null : Number(env("LIGHT_SLEEPER_UTC_OFFSET"));
const DREAMS = env("LIGHT_SLEEPER_DREAMS", "live");

// ── storage: one JSON file, loaded once into memory, written back after changes ──
const DIR = (() => { try { return getPluginConfigDir(ID); } catch { return "/sdcard/Download/Operit/plugins/" + ID; } })();
const FILE = DIR + "/data.json";
let data = null, dirty = false, writing = Promise.resolve();
async function ensure() {
  if (data) return;
  try { const r = await Tools.Files.read(FILE); data = JSON.parse((r && r.content) || "{}") || {}; } catch (e) { data = {}; }
}
function flush() {
  if (!dirty) return writing;
  dirty = false; const text = JSON.stringify(data);
  writing = writing.then(() => Tools.Files.mkdir(DIR, true).catch(() => null)).then(() => Tools.Files.write(FILE, text)).catch((e) => console.error("light-sleeper: save failed", e && e.message));
  return writing;
}
const store = L.kvStore({ get: (k) => (data && k in data ? data[k] : null), set: (k, v) => { data[k] = v; dirty = true; } }, { prefix: "" });
const meta = (k, v) => { if (v === undefined) return data && data["meta:" + k]; data["meta:" + k] = v; dirty = true; return v; };

// ── talking to the AI ──
let busy = false, lastEnd = 0, delivering = 0;
async function deliver(text) {
  const chatId = meta("chatId"); if (!chatId) return null;
  busy = true; delivering++;
  try {
    const r = await Tools.Chat.sendMessage(text, chatId, undefined, undefined, { runtime: "main", persist_turn: true, hide_user_message: true, timeout_ms: 300000 });
    return (r && r.aiResponse) || "";
  } finally { busy = false; delivering--; lastEnd = Date.now(); }
}
async function llmJson(system, user) {
  const r = await Tools.Chat.call({ functionType: "CHAT", turns: [{ kind: "SYSTEM", content: system }, { kind: "USER", content: user }] });
  return JSON.parse(String((r && r.text) || "").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
}

const T = (LANG === "zh" ? L.textZh : L.textEn).makeText({ partner: PARTNER });
const language = LANG === "zh" ? "Chinese" : "English";
const modelWriter = L.dreamPrompt.makeDreamWriter({ llm: llmJson, self: "an AI companion who chats with their partner on a phone", partner: PARTNER, language });
let pendingReply = null;
const live = L.dreamLive.makeLiveDreamWriter({
  llm: llmJson,
  ask: (t) => { pendingReply = deliver(t); return Promise.resolve(); },
  waitReply: (at, ms) => new Promise((res) => {
    const timer = setTimeout(() => res(null), ms);
    pendingReply.then((x) => { clearTimeout(timer); res(x && x.trim() !== "." ? x : null); }, () => { clearTimeout(timer); res(null); });
  }),
  asleep: () => sleeper.api.status().status === "asleep",
  text: L.dreamLive.makeLiveText({ self: "an AI companion", partner: PARTNER, language, prefix: "[dream]" }),
  fallback: modelWriter,
  log: (x) => console.log("light-sleeper:", x),
});
const partnerLog = () => (data && data["meta:said"]) || [];

const sleeper = L.createSleeper({
  store,
  agent: {
    deliver: (text) => deliver(text),
    busy: () => busy, lastTurnEndAt: () => lastEnd, ready: () => true,
    notify: (text) => console.log("light-sleeper notice:", text),   // sleep talk etc.; Operit has no plain "post as AI" call
    hush: () => {},
  },
  partner: {
    liveAt: () => meta("lastPartnerAt") || 0, elsewhere: () => ({ at: 0, text: "" }), presenceAt: () => 0,
    chat: partnerLog, directSince: () => [],
    isGoodnight: (t) => /晚安|睡了|去睡|good ?night|going to (bed|sleep)/i.test(t),
    isUpset: (t) => /哭|难过|伤心|委屈|\b(cry|crying|sad|upset)\b/i.test(t),
  },
  classify: (text) => (text.indexOf(MARK) === 0
    ? { kind: "partner", marker: "", body: text.slice(MARK.length).trim(), urgent: /醒醒|急|快醒|wake up|urgent/i.test(text), byName: false }
    : { kind: "pass" }),
  dreams: {
    material: async () => ({ worry: null, people: [PARTNER], residue: partnerLog().slice(-6).map((m) => String(m.text).slice(0, 60)), lag: [] }),
    tone: () => "plain",
    write: (kind, opts) => (DREAMS === "live" ? live.write(kind, opts) : modelWriter(kind, opts)),
  },
  text: T,
  config: { tz: "UTC", utcOffsetMin: OFFSET },
  log: (x) => console.log(x),
});

let ticking = null;
async function tick() {
  await ensure();
  if (!ticking) ticking = sleeper.tick().catch((e) => console.error("light-sleeper tick:", e && e.message)).then(() => { ticking = null; return flush(); });
  return ticking;
}

// ── the gate: every message she sends in the bound chat ──
async function onChatInput(event) {
  if (!event || event.eventName !== "submit_requested") return null;
  const p = event.eventPayload || {}; const text = String(p.text || "").trim();
  await ensure();
  if (!text || delivering || !meta("chatId") || p.chatId !== meta("chatId") || text.indexOf("/") === 0) return null;
  meta("lastPartnerAt", Date.now());
  meta("said", partnerLog().concat({ at: Date.now(), text: text.slice(0, 500) }).slice(-30));
  const g = await sleeper.gate(MARK + " " + text, { label: "chat" });
  await flush();
  setTimeout(() => { tick(); }, 0);
  if (g && g.hold) return { action: "consume", message: T.notWoken, clearInput: true };
  if (g && typeof g.text === "string") return { action: "replace", text: g.text.replace(MARK, "").trim() };
  return null;
}

ToolPkg.ipc.on("light_sleeper.tick", async () => { await tick(); return sleeper.api.status(); });
ToolPkg.ipc.on("light_sleeper.status", async () => { await ensure(); return { chatId: meta("chatId") || null, status: sleeper.api.status() }; });
ToolPkg.ipc.on("light_sleeper.bind", async (payload) => { await ensure(); meta("chatId", payload && payload.chatId); await flush(); return { chatId: meta("chatId") }; });
ToolPkg.ipc.on("light_sleeper.sleep", async () => { await ensure(); sleeper.startSleep("goodnight"); await flush(); return sleeper.api.status(); });
ToolPkg.ipc.on("light_sleeper.dreams", async (payload) => { await ensure(); return sleeper.api.dreams({ limit: Math.min(Number(payload && payload.limit) || 10, 50) }); });

function registerToolPkg() {
  ToolPkg.registerChatInputHook({ id: "light_sleeper_gate", function: onChatInput });
  return true;
}

exports.registerToolPkg = registerToolPkg;
exports.onChatInput = onChatInput;
