// SPDX-License-Identifier: AGPL-3.0-only
// companion.js: a small chat companion with light-sleeper wired in. The transport examples (telegram.js, discord.js)
// only move messages; everything about sleeping lives here.
//
// It keeps the conversation, calls an OpenAI-compatible chat API for replies and dreams, and puts every message from
// the partner through the sleep gate. Lines the engine sends to the companion (waking up, a nightmare, drowsiness…)
// become turns too; the companion's answer goes to the partner unless it is just ".".
//
//   const c = makeCompanion({ dir, send: async (text) => {...}, persona: "…", partner: "Sam", language: "English" });
//   await c.onMessage("hi");            // a message from the partner
//   setInterval(c.tick, 60000);         // once a minute
//
// Environment: LLM_BASE_URL (default https://api.openai.com/v1), LLM_API_KEY, LLM_MODEL, DREAM_MODEL (optional),
// TZ_NAME (default UTC), DREAM_MODE=live|model (default live).
"use strict";
const fs = require("fs"), path = require("path");
const { createSleeper, fileStore } = require("../../src/sleep-engine.js");
const { makeDreamWriter } = require("../../src/dream-prompt.js");
const { makeLiveDreamWriter, makeLiveText } = require("../../src/dream-live.js");

const MARK = "[partner]";

async function chat(messages, { model, json = false } = {}) {
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LLM_API_KEY || ""}` },
    body: JSON.stringify({ model: model || process.env.LLM_MODEL, messages, ...(json ? { response_format: { type: "json_object" } } : {}) }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json(); const t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!t) throw new Error("LLM: empty reply");
  return t;
}
const jsonLLM = async (system, user) => JSON.parse(String(await chat([{ role: "system", content: system }, { role: "user", content: user }], { model: process.env.DREAM_MODEL, json: true })).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));

function makeCompanion({ dir, send, persona, partner = "my partner", language = "English", text: textPack, isGoodnight, isUpset, log = console.log }) {
  fs.mkdirSync(dir, { recursive: true });
  const histFile = path.join(dir, "history.jsonl");
  let history = []; try { history = fs.readFileSync(histFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* new */ }
  const remember = (m) => { history.push(m); fs.appendFileSync(histFile, JSON.stringify(m) + "\n"); };
  let busy = false, lastEnd = 0, lastPartnerAt = 0, hushAt = 0;
  let queue = Promise.resolve();

  // one turn of the companion: input → reply. quiet: don't send the reply to the partner (dream scenes)
  function turn(input, { quiet = false, partnerSaid = "" } = {}) {
    const run = async () => {
      busy = true;
      try {
        remember({ role: "user", content: input, at: Date.now(), ...(partnerSaid ? { partner: partnerSaid } : {}) });
        const msgs = [{ role: "system", content: persona }, ...history.slice(-40).map(({ role, content }) => ({ role, content }))];
        const reply = String(await chat(msgs)).trim();
        remember({ role: "assistant", content: reply, at: Date.now(), ...(quiet ? { quiet: true } : {}) });
        if (!quiet && reply && reply !== "." && !hushAt) await send(reply);
        return reply;
      } finally { busy = false; lastEnd = Date.now(); }
    };
    const p = queue.then(run, run); queue = p.catch(() => {}); return p;
  }

  const T = textPack || require(`../../src/text-${/^zh|chinese|中文/i.test(language) ? "zh" : "en"}.js`).makeText({ partner });
  const modelWriter = makeDreamWriter({ llm: jsonLLM, self: "an AI companion who chats with their partner", partner, language });
  const live = makeLiveDreamWriter({
    llm: jsonLLM,
    ask: (t) => { live._pending = turn(t, { quiet: true }); return Promise.resolve(); },
    waitReply: (at, ms) => new Promise((res) => {
      const t = setTimeout(() => res(null), ms);
      live._pending.then((x) => { clearTimeout(t); res(x && x !== "." ? x : null); }, () => { clearTimeout(t); res(null); });
    }),
    asleep: () => sleeper.api.status().status === "asleep",
    text: makeLiveText({ self: "an AI companion", partner, language }),
    fallback: modelWriter, log,
  });
  const recentPartner = () => history.filter((m) => m.partner).map((m) => ({ at: m.at, text: m.partner }));

  const sleeper = createSleeper({
    store: fileStore(dir),
    agent: {
      deliver: (t) => turn(t),
      busy: () => busy, lastTurnEndAt: () => lastEnd, ready: () => true,
      notify: (t) => (/^\{/.test(t) ? null : send(t)),   // sleep talk etc.; JSON notices are for app UIs
      hush: (at) => { hushAt = at || 0; },
    },
    partner: {
      liveAt: () => lastPartnerAt, elsewhere: () => ({ at: 0, text: "" }), presenceAt: () => 0,
      chat: recentPartner, directSince: () => [],
      isGoodnight: isGoodnight || ((t) => /good ?night|going to (bed|sleep)|晚安|睡了/i.test(t)),
      isUpset: isUpset || ((t) => /\b(cry|crying|sad|upset)\b|哭|难过/i.test(t)),
    },
    classify: (t, label) => (t.startsWith(MARK) ? { kind: "partner", marker: "", body: t.slice(MARK.length).trim(), urgent: /wake up|urgent|醒醒|急/i.test(t), byName: false }
      : label === "dream" ? { kind: "pass" } : t.startsWith("/") ? { kind: "pass" } : { kind: "other" }),
    dreams: {
      material: async () => ({ worry: null, people: [partner], residue: recentPartner().slice(-6).map((m) => m.text.slice(0, 60)), lag: [] }),
      tone: () => "plain",
      write: (kind, opts) => ((process.env.DREAM_MODE || "live") === "live" ? live.write(kind, opts) : modelWriter(kind, opts)),
    },
    text: T, log,
    config: { tz: process.env.TZ_NAME || "UTC" },
  });

  return {
    sleeper,
    // a message from the partner
    async onMessage(body) {
      lastPartnerAt = Date.now();
      const g = await sleeper.gate(`${MARK} ${body}`, { label: "chat" });
      if (g && g.hold) return null;                         // asleep and not woken: it is saved and shown on waking
      return turn(g && typeof g.text === "string" ? g.text.replace(MARK, "").trim() : body, { partnerSaid: body });
    },
    tick: () => sleeper.tick().catch((e) => log(`tick: ${e.message}`)),
    status: () => sleeper.api.status(),
  };
}

module.exports = { makeCompanion, chat };
