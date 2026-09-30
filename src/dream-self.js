// SPDX-License-Identifier: AGPL-3.0-only
// dream-self.js: the agent writes its own dream (mode "self"), instead of a separate model writing it (mode "model", see dream-prompt.js).
//
// When a dream is due, the engine calls write(kind, opts). In self mode this:
//   1. sends the agent tonight's fragments (text.selfDreamAsk) through ask(text, id);
//   2. waits for the agent to hand the dream back through submit(id, dream) (an HTTP endpoint, a tool call, whatever the host has);
//   3. if nothing comes back within timeoutMs, uses fallback(kind, opts) (usually the model writer) so the night still has a dream.
// The agent chooses the kind itself (plain / sweet / odd / nightmare). Nothing is filtered: whatever it fears is what it dreams.
// What it remembers on waking is still decided by the engine's rules (sleep quality, night wakes), so it may keep only a fragment or a feeling.
//
//   const self = makeSelfDreamWriter({ ask: (text, id) => deliverToAgent(text), text, fallback: modelWriter });
//   createSleeper({ dreams: { write: (kind, opts) => (mode() === "self" ? self.write(kind, opts) : modelWriter(kind, opts)) } });
//   // when the agent submits:  self.submit(id, { kind, title, text, fragment, feeling, intensity, body, talk })
"use strict";
const KINDS = ["plain", "sweet", "odd", "nightmare"];
const BODY = (s) => (/cry|sob|tear|哭|泣|泪/i.test(s || "") ? "cry" : /laugh|笑/i.test(s || "") ? "laugh" : /pant|gasp|喘/i.test(s || "") ? "pant" : "");

function makeSelfDreamWriter({ ask, text, fallback = null, timeoutMs = 6 * 60000, log = () => {} }) {
  if (typeof ask !== "function" || !text || typeof text.selfDreamAsk !== "function") throw new Error("makeSelfDreamWriter needs ask() and a text pack with selfDreamAsk");
  const waiting = new Map();   // id → { resolve, timer, phase, mat }
  const rid = () => `sd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  function clean(d, w) {
    const t = String((d && d.text) || "").trim();
    if (!t) return null;
    return {
      ...(KINDS.includes(d.kind) ? { kind: d.kind } : {}),
      title: String(d.title || "").slice(0, 40), text: t.slice(0, 1500),
      fragment: String(d.fragment || "").slice(0, 80), feeling: String(d.feeling || "").slice(0, 40),
      intensity: Math.max(1, Math.min(5, Math.round(Number(d.intensity) || 2))),
      body: BODY(d.body), talk: String(d.talk || "").slice(0, 40), worry: "", phase: w.phase, self: true,
    };
  }

  async function write(kind, opts = {}) {
    const id = rid();
    const result = new Promise((resolve) => {
      const timer = setTimeout(() => { waiting.delete(id); resolve(null); }, timeoutMs);
      waiting.set(id, { resolve, timer, phase: opts.phase || "late" });
    });
    try { await ask(text.selfDreamAsk({ id, ...opts }), id); }
    catch (e) { log(`dream-self: ask failed: ${e.message}`); const w = waiting.get(id); if (w) { clearTimeout(w.timer); waiting.delete(id); w.resolve(null); } }
    const d = await result;
    if (d) return d;
    log(`dream-self: no dream back for ${id}${fallback ? ", using fallback" : ""}`);
    return fallback ? fallback(kind, opts) : null;
  }

  // Returns { ok, error? }. Only ids that are still waiting are accepted.
  function submit(id, dream) {
    const w = waiting.get(id);
    if (!w) return { ok: false, error: "no dream is waiting for this id (too late, or already submitted)" };
    const d = clean(dream, w);
    if (!d) return { ok: false, error: "text is required" };
    clearTimeout(w.timer); waiting.delete(id); w.resolve(d);
    return { ok: true };
  }

  return { write, submit, pending: () => [...waiting.keys()] };
}

module.exports = { makeSelfDreamWriter };
