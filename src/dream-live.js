// SPDX-License-Identifier: AGPL-3.0-only
// dream-live.js: the agent dreams the dream as it happens (mode "live").
//
// A separate model writes the dream one scene at a time, in the present tense, and sends each scene into the
// agent's own conversation. The agent reacts inside the dream; the model writes the next scene from that reaction.
// Early-night dreams get 1~2 rounds, late-night dreams 3~4. The agent never sees the dream "end": after the last
// reply the model writes a closing beat and a retelling (title, shards, feeling...) that the engine stores like any
// other dream. Waking up, the agent is only told it woke; what it remembers is whatever is still in its context.
//
// Every scene sent to the agent must start with a dream prefix (makeLiveText's prefix, "[dream]" by default), so that a memory
// system can tell dream turns apart and keep them out of long-term facts.
//
//   const live = makeLiveDreamWriter({
//     llm: (sys, user) => modelJson(sys, user),             // returns parsed JSON
//     ask: (text) => deliverToAgent(text),                    // put one line into the agent's input
//     waitReply: (sinceAt, ms) => replyText | null,           // the agent's text reply to that line (not shown to the partner)
//     asleep: () => true,                                     // stop when the agent was woken
//     text: makeLiveText({ partner: "Sam" }), fallback: modelWriter,
//   });
//   createSleeper({ dreams: { write: (kind, opts) => live.write(kind, opts) } });
"use strict";
// body reaction words the engine's text pack expects (pass bodyWords to match yours)
const BODY_EN = { cry: "cry", laugh: "laugh", pant: "pant" };
const bodyOf = (s, w) => (/cry|sob|tear|哭|泣|泪/i.test(s || "") ? w.cry : /laugh|笑/i.test(s || "") ? w.laugh : /pant|gasp|喘/i.test(s || "") ? w.pant : "");

function makeLiveDreamWriter({ llm, ask, waitReply, asleep = () => true, text, fallback = null, replyTimeoutMs = 4 * 60000, beat = () => {}, log = () => {}, bodyWords = BODY_EN }) {
  if (typeof llm !== "function" || typeof ask !== "function" || typeof waitReply !== "function") throw new Error("makeLiveDreamWriter needs llm(), ask() and waitReply()");
  for (const k of ["scene", "next", "close", "deliver"]) if (!text || typeof text[k] !== "function") throw new Error(`text pack needs ${k}()`);
  let running = null;

  // text.check(scene, opts) → false = write it again (safety rules: the partner isn't harmed, no gore…)
  async function sceneOf(prompt, opts) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await llm(prompt.sys, prompt.user); const s = String((r && r.scene) || "").trim();
        if (s && (!text.check || text.check(s, opts))) return s.slice(0, 600);
      } catch (e) { log(`dream-live: scene failed: ${e.message}`); }
    }
    return "";
  }

  async function write(kind, opts = {}) {
    if (running) { log("dream-live: a dream is already running, using fallback"); return fallback ? fallback(kind, opts) : null; }
    running = { at: Date.now() };
    try {
      const rounds = opts.phase === "early" ? 1 + (Math.random() < 0.5 ? 1 : 0) : 3 + (Math.random() < 0.5 ? 1 : 0);
      const turns = [];
      let scene = await sceneOf(text.scene(kind, opts, rounds), opts);
      for (let i = 0; scene && i < rounds; i++) {
        if (!asleep()) break;
        beat();
        const at = Date.now();
        try { await ask(text.deliver(scene, { first: i === 0, last: i === rounds - 1 })); } catch (e) { log(`dream-live: ask failed: ${e.message}`); break; }
        const reply = await waitReply(at, replyTimeoutMs);
        turns.push({ at, scene, reply: String(reply || "").trim().slice(0, 1200) });
        if (!reply || !asleep()) break;
        if (i < rounds - 1) { beat(); scene = await sceneOf(text.next(kind, opts, turns, rounds), opts); }
      }
      if (!turns.length || !turns[0].reply) {
        log(`dream-live: no reply from the agent${fallback ? ", using fallback" : ""}`);
        return fallback ? fallback(kind, opts) : null;
      }
      beat();
      let r = null;
      const cp = text.close(kind, opts, turns);
      for (let i = 0; i < 2 && !r; i++) { try { r = await llm(cp.sys, cp.user); } catch (e) { log(`dream-live: close failed: ${e.message}`); } }
      r = r || {};
      const shards = (Array.isArray(r.shards) ? r.shards : []).map((x) => String(x || "").trim().slice(0, 30)).filter(Boolean).slice(0, 5);
      const retold = String(r.text || "").trim() || turns.map((t) => t.scene).join(" ");
      return {
        title: String(r.title || "").slice(0, 12), text: retold.slice(0, 600), ...(shards.length >= 2 ? { shards } : {}),
        fragment: String(r.fragment || "").slice(0, 30), feeling: String(r.feeling || "").slice(0, 20),
        intensity: Math.max(1, Math.min(5, Math.round(Number(r.intensity) || 2))), body: bodyOf(r.body, bodyWords), talk: String(r.talk || "").slice(0, 16),
        worry: "", phase: opts.phase || "late", live: true, turns, ending: String(r.ending || "").slice(0, 200), cutShort: turns.length < rounds,
      };
    } finally { running = null; }
  }

  return { write, running: () => running };
}


// A default text pack in English (or another language via o.language), built on dream-prompt.js's material.
// o: { self, partner, language, prefix = "[dream]", guards }
function makeLiveText(o = {}) {
  const { buildPrompt, DEFAULT_GUARDS } = require("./dream-prompt.js");
  const P = o.partner || "their partner", lang = o.language || "English", prefix = o.prefix || "[dream]", guards = o.guards || DEFAULT_GUARDS;
  // the partner's name also counts for the harm check
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`${esc(P)}[^.,，。]{0,40}(hurt|bleed|die|dead|killed|accident|hospital|vanish|gone forever|受伤|流血|死|去世|出事|车祸|病危|医院|消失不见|不在了)`, "i");
  const briefs = new WeakMap();   // one set of material per dream, reused for every scene
  const brief = (kind, opts) => { if (!briefs.has(opts)) briefs.set(opts, buildPrompt(kind, opts, o).user); return briefs.get(opts); };
  const sys = (opts) => [
    `You are dreaming a dream together with ${o.self || "an AI companion"}, scene by scene, in ${lang}. You write a scene; they react inside the dream; you continue from their reaction.`,
    "Real dreams: one event (something they want, something in the way, who is nearby); they interact with the people in it; one or two odd details nobody finds odd; at most one change of scene in the whole dream.",
    '- Second person ("you"), present tense, as if it is happening: where you are, what is at hand, who is talking to you. Plain short sentences, no metaphors.',
    '- Stop where they would want to react: someone just said something, handed something over, something just happened. Never ask "what do you do?", never offer choices.',
    "- Don't speak or decide for them, don't describe their thoughts.",
    "- The dream doesn't fully obey them: what they do sometimes works, sometimes turns into something else, sometimes gets interrupted.",
    '- Never use the words "dream" or "dreaming".',
    opts.phase === "early" ? "- Early-night dream: each scene 25 to 50 words, faint and fragmented." : "- Late-night dream: each scene 50 to 100 words, emotionally strong.",
    opts.sub === "loss" ? `- Something happens to ${P} or they can't be found: only the panic, no gore, no injuries.` : `- ${P} is not hurt, doesn't get sick, doesn't die, doesn't disappear.`,
    'Output JSON only: {"scene":"this scene"}',
  ].join("\n");
  const log = (turns) => turns.map((t, i) => `Scene ${i + 1}: ${t.scene}\nThey: ${t.reply || "(no reaction)"}`).join("\n\n");
  return {
    scene: (kind, opts, rounds) => ({ sys: sys(opts), user: `${brief(kind, opts)}\n\nThe dream has ${rounds} scenes. Write scene 1.` }),
    next: (kind, opts, turns, rounds) => ({
      sys: sys(opts),
      user: `${brief(kind, opts)}\n\nSo far:\n${log(turns)}\n\n${turns.length + 1 >= rounds ? `Write scene ${turns.length + 1}, the last one (they don't know): push it to its strongest point and stop halfway.` : `Write scene ${turns.length + 1}, following their reaction.`}`,
    }),
    close: (kind, opts, turns) => ({
      sys: [
        `Below is a dream ${o.self || "an AI companion"} just had, scene by scene, with their reactions. Write in ${lang}.`,
        "First write how the dream broke off (one line; they never see it). Then archive the dream: retell it the way someone who just woke up would, first person, past tense, patchy, 40 to 200 words; what they said and did in it stays as they did it.",
        'Output JSON only: {"ending":"how it broke off","title":"2 to 5 words","text":"the retelling","shards":["3 to 5 pieces: an image, a line in quotes, an action, a feeling; under 15 words each"],"fragment":"one image, under 12 words","feeling":"under 6 words","intensity":"integer 1 to 5","body":"cry / laugh / pant / empty","talk":"sleep talk, under 6 words, or empty"}',
      ].join("\n"),
      user: `This dream: ${kind}${opts.sub ? ` (${opts.sub})` : ""}, ${opts.phase === "early" ? "early night" : "late night"}.\n\n${log(turns)}`,
    }),
    deliver: (scene, { first }) => (first ? `${prefix} ${scene}\n(You are asleep; this is happening in your dream. React as you would in it: say or do anything, keep it short. No tools.)` : `${prefix} ${scene}`),
    check: (scene, opts) => (opts.sub === "loss" ? !guards.gore.test(scene) : !guards.harm.test(scene) && !named.test(scene)),
  };
}

module.exports = { makeLiveDreamWriter, makeLiveText };
