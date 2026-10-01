// SPDX-License-Identifier: AGPL-3.0-only
// A sleeping companion for any chat frontend that speaks the OpenAI API (SillyTavern, LobeChat, Open WebUI, …).
// Zero dependencies (Node 18+). Point the frontend's API URL at this proxy instead of your provider:
//
//   UPSTREAM_BASE_URL=https://api.openai.com/v1  UPSTREAM_API_KEY=…  node examples/openai-proxy.js
//   then in SillyTavern: Chat Completion → Custom (OpenAI-compatible) → http://127.0.0.1:8788/v1
//
// Each message you send goes through the sleep gate. Asleep and not woken: you get a short "asleep" reply and the
// message is shown to the companion when it wakes. What the engine wants to tell the companion (it woke up, it is
// drowsy…) is added as a system note to your next request. These frontends only talk when you send something, so
// the companion can't message you first, and dreams use model mode (fragments on waking), not live mode.
//
// Optional: UPSTREAM_MODEL (for writing dreams; default: the model the frontend uses), PORT (8788), DATA_DIR,
// TZ_NAME, PARTNER_NAME, LANGUAGE (English | Chinese).
"use strict";
const http = require("http"), path = require("path");
const { createSleeper, fileStore } = require("../src/sleep-engine.js");
const { makeDreamWriter } = require("../src/dream-prompt.js");

const UP = (process.env.UPSTREAM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const PORT = Number(process.env.PORT) || 8788;
const PARTNER = process.env.PARTNER_NAME || "my partner";
const LANGUAGE = process.env.LANGUAGE || "English";
const MARK = "[partner]";
let lastModel = process.env.UPSTREAM_MODEL || "", lastAuth = "", lastPartnerAt = 0;
const said = [], notes = [];

const auth = () => (process.env.UPSTREAM_API_KEY ? `Bearer ${process.env.UPSTREAM_API_KEY}` : lastAuth);
async function complete(messages, json) {
  const r = await fetch(`${UP}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: auth() },
    body: JSON.stringify({ model: lastModel, messages, ...(json ? { response_format: { type: "json_object" } } : {}) }) });
  const j = await r.json(); return j.choices[0].message.content;
}
const llm = async (system, user) => JSON.parse(String(await complete([{ role: "system", content: system }, { role: "user", content: user }], true)).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));

const T = require(`../src/text-${/^(zh|chinese)/i.test(LANGUAGE) ? "zh" : "en"}.js`).makeText({ partner: PARTNER });
const sleeper = createSleeper({
  store: fileStore(process.env.DATA_DIR || path.join(__dirname, "..", "data", "proxy")),
  agent: {
    deliver: async (text) => { notes.push(text); return ""; },   // shown to the companion with the next request
    busy: () => false, lastTurnEndAt: () => 0, ready: () => true, notify: () => {}, hush: () => {},
  },
  partner: {
    liveAt: () => lastPartnerAt, elsewhere: () => ({ at: 0, text: "" }), presenceAt: () => 0, chat: () => said.slice(-30), directSince: () => [],
    isGoodnight: (t) => /good ?night|going to (bed|sleep)|晚安|睡了/i.test(t), isUpset: (t) => /\b(cry|crying|sad|upset)\b|哭|难过/i.test(t),
  },
  classify: (t) => (t.startsWith(MARK) ? { kind: "partner", marker: "", body: t.slice(MARK.length).trim(), urgent: /wake up|urgent|醒醒|急/i.test(t), byName: false } : { kind: "pass" }),
  dreams: {
    material: async () => ({ worry: null, people: [PARTNER], residue: said.slice(-6).map((m) => m.text.slice(0, 60)), lag: [] }),
    tone: () => "plain",
    write: makeDreamWriter({ llm, self: "an AI companion", partner: PARTNER, language: LANGUAGE }),
  },
  text: T, config: { tz: process.env.TZ_NAME || "UTC" },
});
setInterval(() => sleeper.tick().catch((e) => console.error("tick:", e.message)), 60000);

const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((p) => p && p.type === "text").map((p) => p.text).join("\n") : "");
function reply(res, body, text) {
  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write(`data: ${JSON.stringify({ id: "sleep", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "sleep", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    return res.end();
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: "sleep", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
}

http.createServer(async (req, res) => {
  try {
    const raw = await new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });
    if (req.headers.authorization) lastAuth = req.headers.authorization;
    if (req.method === "POST" && /\/chat\/completions$/.test(req.url)) {
      const body = JSON.parse(raw || "{}"); if (body.model && !process.env.UPSTREAM_MODEL) lastModel = body.model;
      const msgs = Array.isArray(body.messages) ? body.messages : [];
      const i = msgs.map((m) => m.role).lastIndexOf("user");
      if (i >= 0) {
        const text = textOf(msgs[i].content).trim();
        lastPartnerAt = Date.now(); said.push({ at: Date.now(), text });
        const g = await sleeper.gate(`${MARK} ${text}`, { label: "chat" });
        if (g && g.hold) return reply(res, body, `*${T.notWoken}*`);
        if (g && typeof g.text === "string") msgs[i] = { ...msgs[i], content: g.text.replace(MARK, "").trim() };
        if (notes.length) msgs.splice(i, 0, ...notes.splice(0).map((n) => ({ role: "system", content: n })));
      }
      body.messages = msgs;
      const up = await fetch(`${UP}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: auth() }, body: JSON.stringify(body) });
      res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" });
      for await (const chunk of up.body) res.write(chunk);
      return res.end();
    }
    // anything else (model lists…) goes straight through
    const up = await fetch(`${UP}${req.url.replace(/^\/v1/, "")}`, { method: req.method, headers: { authorization: auth(), "content-type": "application/json" }, ...(raw ? { body: raw } : {}) });
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" }); res.end(Buffer.from(await up.arrayBuffer()));
  } catch (e) { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: `light-sleeper proxy: ${e.message}` } })); }
}).listen(PORT, "127.0.0.1", () => console.log(`light-sleeper proxy on http://127.0.0.1:${PORT}/v1 → ${UP}`));
