/*
METADATA
{
  "name": "light_sleeper",
  "version": "0.1.2",
  "display_name": { "zh": "浅眠", "en": "light-sleeper" },
  "description": {
    "zh": "让这个聊天里的 AI 会困、会睡、会做梦。先在要用的聊天里运行 setup。",
    "en": "Lets the AI in one chat get drowsy, sleep and dream. Run setup in the chat you want first."
  },
  "category": "Utility",
  "env": [
    { "name": "LIGHT_SLEEPER_PARTNER", "description": { "zh": "AI 怎么称呼你（默认「她」）", "en": "What the AI calls you" }, "required": false },
    { "name": "LIGHT_SLEEPER_LANG", "description": { "zh": "zh 或 en（默认 zh）", "en": "zh or en (default zh)" }, "required": false },
    { "name": "LIGHT_SLEEPER_UTC_OFFSET", "description": { "zh": "时区，分钟，比如 480 = 东八区（默认用手机时间）", "en": "Time zone offset in minutes, e.g. 480 for UTC+8 (default: phone time)" }, "required": false },
    { "name": "LIGHT_SLEEPER_DREAMS", "description": { "zh": "live（梦在聊天里一幕幕发生，默认）或 model（醒来只给碎片）", "en": "live (dreams happen in the chat, default) or model (only fragments on waking)" }, "required": false }
  ],
  "tools": [
    { "name": "diagnose", "description": { "zh": "自检：哪些接口能用、哪里出错（装好不能用时先跑这个）", "en": "Self-check: which host APIs exist and what failed" }, "parameters": [] },
    { "name": "setup", "description": { "zh": "把当前聊天绑定为会睡觉的聊天，并建一个每 15 分钟跑一次的工作流", "en": "Bind the current chat and create a workflow that ticks every 15 minutes" }, "parameters": [] },
    { "name": "tick", "description": { "zh": "睡眠时钟走一步（工作流定时调用）", "en": "Advance the sleep clock (called by the workflow)" }, "parameters": [] },
    { "name": "status", "description": { "zh": "现在醒着还是睡着、困不困、今晚的计划", "en": "Awake or asleep, how drowsy, tonight's plan" }, "parameters": [] },
    { "name": "go_to_sleep", "description": { "zh": "AI 说完晚安后自己去睡", "en": "The AI goes to sleep after saying goodnight" }, "parameters": [] },
    { "name": "dreams", "description": { "zh": "最近的梦", "en": "Recent dreams" }, "parameters": [ { "name": "limit", "description": "how many (default 10)", "type": "number", "required": false } ] }
  ]
}
*/
// SPDX-License-Identifier: AGPL-3.0-only
// Tools run in a sandbox context; the sleeper lives in the ToolPkg main context (main.js), reached through IPC.
"use strict";
const call = (ch, payload) => ToolPkg.ipc.call(ch, payload || {});

async function setup() {
  const chatId = getChatId();
  if (!chatId) return { success: false, message: "Run setup from inside the chat you want to use." };
  await call("light_sleeper.bind", { chatId });
  let workflow = "already there or not created";
  try {
    const list = await Tools.Workflow.getAll();
    const exists = JSON.stringify(list || "").indexOf("light-sleeper clock") >= 0;
    if (!exists) {
      await Tools.Workflow.create("light-sleeper clock", "Ticks the sleep clock every 15 minutes", [
        { id: "t", type: "trigger", name: "every 15 minutes", triggerType: "schedule", triggerConfig: { schedule_type: "interval", interval_ms: "900000", repeat: "true" } },
        { id: "e", type: "execute", name: "tick", actionType: "light_sleeper:tick", actionConfig: {} },
      ], [{ sourceNodeId: "t", targetNodeId: "e", condition: "on_success" }], true);
      workflow = "created";
    }
  } catch (e) { workflow = "could not create (" + (e && e.message) + "); make one by hand: schedule trigger every 15 min → light_sleeper:tick"; }
  return { success: true, chatId, workflow };
}
async function diagnose() {
  const out = { ipc: typeof ToolPkg !== "undefined" && ToolPkg.ipc && typeof ToolPkg.ipc.call === "function", chatId: (() => { try { return getChatId() || null; } catch (e) { return "getChatId failed: " + e.message; } })() };
  if (!out.ipc) return { success: false, ...out, message: "ToolPkg.ipc.call is missing here, so tools can't reach the package's main script." };
  try { out.main = await call("light_sleeper.diagnose"); } catch (e) { out.main = "ipc call failed: " + (e && e.message); }
  return { success: true, ...out };
}
async function tick() { return { success: true, status: await call("light_sleeper.tick") }; }
async function status() { return { success: true, ...(await call("light_sleeper.status")) }; }
async function go_to_sleep() { const s = await call("light_sleeper.sleep"); return { success: true, status: s && s.status, note: "Asleep. Reply with just \".\" this turn." }; }
async function dreams(params) { return { success: true, dreams: await call("light_sleeper.dreams", { limit: params && params.limit }) }; }

async function wrap(fn, params) {
  try { complete(await fn(params || {})); }
  catch (e) { complete({ success: false, message: "light-sleeper: " + (e && e.message) }); }
}
exports.diagnose = (p) => wrap(diagnose, p);
exports.setup = (p) => wrap(setup, p);
exports.tick = (p) => wrap(tick, p);
exports.status = (p) => wrap(status, p);
exports.go_to_sleep = (p) => wrap(go_to_sleep, p);
exports.dreams = (p) => wrap(dreams, p);
