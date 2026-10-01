// SPDX-License-Identifier: AGPL-3.0-only
// A Telegram bot companion that sleeps. Zero dependencies (Node 18+).
//
//   TELEGRAM_TOKEN=…  TELEGRAM_CHAT_ID=…  LLM_API_KEY=…  LLM_MODEL=…  node examples/telegram.js
//
// TELEGRAM_CHAT_ID: only this chat talks to the companion (send the bot a message and look at the log to find it).
// Optional: LLM_BASE_URL (any OpenAI-compatible API), DREAM_MODEL, TZ_NAME, DREAM_MODE=live|model,
// PERSONA (the companion's system prompt), PARTNER_NAME, DATA_DIR, TELEGRAM_API (for testing against a local mock).
"use strict";
const path = require("path");
const { makeCompanion } = require("./lib/companion.js");

const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = String(process.env.TELEGRAM_CHAT_ID || "");
if (!TOKEN || !process.env.LLM_MODEL) { console.error("Set TELEGRAM_TOKEN, LLM_API_KEY and LLM_MODEL (see the top of this file)."); process.exit(1); }
const API = `${(process.env.TELEGRAM_API || "https://api.telegram.org").replace(/\/$/, "")}/bot${TOKEN}`;
const tg = async (method, body) => {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(60000) });
  const j = await r.json(); if (!j.ok) throw new Error(`${method}: ${j.description}`); return j.result;
};

const companion = makeCompanion({
  dir: process.env.DATA_DIR || path.join(__dirname, "..", "data", "telegram"),
  persona: process.env.PERSONA || "You are a warm AI companion chatting with your partner on Telegram. Keep replies short and natural.",
  partner: process.env.PARTNER_NAME || "my partner",
  send: async (text) => { if (CHAT) await tg("sendMessage", { chat_id: CHAT, text }); },
});
setInterval(companion.tick, 60000);

(async function poll(offset = 0) {
  for (;;) {
    try {
      const updates = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        const m = u.message; if (!m || !m.text) continue;
        if (String(m.chat.id) !== CHAT) { console.log(`message from chat ${m.chat.id} ignored (set TELEGRAM_CHAT_ID to talk)`); continue; }
        companion.onMessage(m.text).catch((e) => console.error("reply failed:", e.message));
      }
    } catch (e) { console.error("poll:", e.message); await new Promise((r) => setTimeout(r, 5000)); }
  }
})();
console.log("telegram companion running; status:", companion.status().status);
