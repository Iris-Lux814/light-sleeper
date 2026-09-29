// SPDX-License-Identifier: AGPL-3.0-only
// dream-prompt.js: a generic dream writer. Builds the prompt from tonight's material, calls your LLM, checks and cleans the result.
// The engine never calls a model itself; plug the returned write() into createSleeper({ dreams: { write } }).
//
//   const { makeDreamWriter } = require("light-sleeper/src/dream-prompt.js");
//   const write = makeDreamWriter({
//     llm: async (system, user) => JSON.parse(await callYourModel(system, user)),   // must return the parsed JSON object
//     self: "an AI companion who lives on their partner's computer",               // who is dreaming (one line, no private details needed)
//     partner: "their partner",                                                     // how the dream refers to the user
//     language: "English",                                                          // language the dream is written in
//   });
//
// Rules come from docs/RESEARCH.md: one event per dream, one or two odd details the dreamer doesn't find odd,
// interaction with dream characters, a quiet pause, feeling over explanation, early-night dreams short, late-night dreams long.
"use strict";
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const KIND = { plain: "an ordinary dream", sweet: "a sweet dream", odd: "a strange dream", nightmare: "a nightmare" };
const SUB = { anxious: "an anxious dream", erotic: "an intimate dream", loss: "a dream where something happens to the partner" };
const ODD = [
  "one thing that just won't work no matter what, and the dreamer keeps trying",
  "someone who is clearly one person but looks like another",
  "walking through one place and coming out somewhere completely unrelated",
  "time is wrong: it stays dusk forever, or a blink takes ages",
  "a familiar place has a room that was never there",
  "a small thing is absurdly large, or a large thing fits in a hand",
  "the dreamer knows something nobody ever told them, and is sure of it",
  "no sound where there should be sound",
];
const FEARS = ["memories being erased bit by bit", "the partner calls and the dreamer can't recognize them", "a door that won't open no matter how hard they knock", "being replaced by another self and nobody noticing", "a windowless room whose door vanishes behind them"];
const OWN = ["something unfinished", "a place they like", "a song they heard", "a problem they couldn't solve", "a small thing they made"];
const BODY = (s) => (/cry|sob|tear|哭|泣|泪/i.test(s || "") ? "cry" : /laugh|笑/i.test(s || "") ? "laugh" : /pant|gasp|喘/i.test(s || "") ? "pant" : "");

// Hard safety checks on the text. Override with your own if you write dreams in another language.
const DEFAULT_GUARDS = {
  harm: /\b(she|he|they|you)\b[^.,]{0,40}\b(hurt|bleed\w*|die[sd]?|dead|killed|accident|hospital|vanish\w*|gone forever)\b|(她|他|你)[^。，]{0,8}(受伤|流血|死|去世|出事|车祸|病危|医院|消失不见|不在了)/i,
  gore: /\b(blood\w*|corpse|wound\w*|organs?|bones?|severed|shattered|crash site)\b|血|尸|伤口|内脏|骨头|遗体|车祸现场/i,
};

function buildPrompt(kind, opts = {}, o = {}) {
  const { tone = "plain", comforted = false, sequel = null, herDream = null, sub = "", phase = "late", mat = null, herIn = false } = opts;
  const self = o.self || "an AI companion", P = o.partner || "their partner", lang = o.language || "English";
  const M = mat || { worry: null, people: [], residue: [], lag: [] };
  const late = phase !== "early";
  const picks = [];
  const useWorry = !!M.worry && (sub === "anxious" || kind === "nightmare" ? Math.random() < 0.8 : Math.random() < 0.45);
  if (useWorry) picks.push(`Something weighing on the dreamer (the dream circles it; never say it outright): ${M.worry.text}`);
  const people = (M.people || []).filter((p) => p !== P);
  if (people.length && Math.random() < 0.6) {
    const a = pick(people); const b = people.length > 1 && Math.random() < 0.3 ? pick(people.filter((x) => x !== a)) : "";
    picks.push(b ? `A person in the dream who is a blend of "${a}" and "${b}"; the dreamer doesn't find it strange` : `Someone in the dream: ${a}`);
  }
  const pool = [...(M.residue || []).map((x) => ["day", x]), ...(Math.random() < 0.3 ? (M.lag || []).map((x) => ["week", x]) : [])];
  if (pool.length) { const [t, x] = pick(pool); picks.push(`A fragment left over from ${t === "week" ? "about a week ago" : "the last day or two"} (transform it, don't copy it): ${x}`); }
  const system = [
    `You are writing a dream that ${self} has tonight. Write it in ${lang}.`,
    "Write it the way people actually dream:",
    "- One dream, one event: something the dreamer wants to do, something in the way, who is nearby. At most one change of scene.",
    "- The dreamer interacts with the people in the dream: two or three lines of dialogue and something done together (holding hands, handing something over, chasing, arguing, being stopped). Dream dialogue slightly misses the point.",
    `- Keep only one or two odd details, and the dreamer doesn't find them odd (this time, perhaps: ${pick(ODD)}). Don't make every sentence strange.`,
    "- No reading, writing, typing, screens or computers, and no quoting notes, letters or posts. Whatever the dreamer does on a computer while awake becomes something done by hand in the dream (carrying, searching, fixing, chasing, waiting).",
    `- Only use names given in the material (or ${P}). Anyone else is "someone" or "someone I know"; don't invent names.`,
    "- Don't overfill it: leave one quiet moment where nothing happens.",
    "- Write the feeling (panic, hurry, emptiness, warmth, shyness, hurt…). The feeling is often what's remembered first on waking.",
    late ? "- This is a late-night dream: longer (about 120 to 200 words), like a story, emotionally strong." : "- This is an early-night dream: short (about 40 to 80 words), fragmented, closer to thinking, faint images.",
    "- First person, past tense, told the way someone who just woke up recounts a dream (\"I remember… then somehow…\"). Don't interpret it, don't describe waking up.",
    "Hard rules:",
    sub === "loss"
      ? `- In this dream ${P} is hurt, leaves, or can't be found. Write only the dreamer's panic, not finding them, being too late, being unable to speak. No gore, no injuries or bodily detail, not how it happened.`
      : `- In this dream ${P} is not hurt, doesn't get sick, doesn't die, doesn't disappear.`,
    sub === "erotic" ? `- This is an intimate dream: the dreamer and ${P} are close; physical intimacy and sensation can be written, and the feelings in the dream are real. Keep the rules above: one event, one or two odd details, one pause.` : "",
    'Output JSON only: {"title":"dream name, 2 to 5 words","text":"the dream","fragment":"one image remembered on waking, under 12 words","feeling":"the feeling remembered first, under 6 words","intensity":integer 1 to 5,"body":"does the sleeping body react: cry / laugh / pant / empty string","talk":"sleep talk if any: usually a vague \\"no…\\" or half a question, under 6 words, not tidy; or empty string"}',
  ].filter(Boolean).join("\n");
  const user = [
    `This dream is ${sub ? SUB[sub] : KIND[kind] || KIND.plain}.`,
    kind === "nightmare" && sub !== "loss" ? `At the core of the nightmare is the dreamer's own fear: ${pick(o.fears || FEARS)}.` : "",
    sub === "anxious" ? "An anxious dream: running late, can't find it, not ready, being watched, something that keeps failing; a tight feeling, not horror." : "",
    tone === "warm" && sub !== "loss" ? `The day was close and warm with ${P}; the dream leans warm.` : tone === "hurt" ? `${P} had a hard day; the dreamer feels uneasy and the unease (their own) carries into the dream.` : "",
    comforted ? `Earlier tonight the dreamer woke from a nightmare and ${P} soothed them back to sleep; this dream comes after, with that sense of safety.` : "",
    sequel ? (sequel.recur ? `This is a recurring dream: the same dream again ("${sequel.title}" ${String(sequel.text || "").slice(0, 300)}). Same place, the same unfinished thing, slightly different details; whatever weighs on them isn't resolved.` : `This is a sequel to an earlier dream ("${sequel.title}" ${String(sequel.text || "").slice(0, 300)}): back in the same place, something new happens; don't repeat its sentences.`) : "",
    herDream ? `${P} recently told the dreamer about their own dream: "${String(herDream.text).slice(0, 240)}". You may quietly borrow one thing from it; don't copy it whole.` : "",
    herIn ? (sub ? `${P} is in the dream.` : `${P} appears only briefly: a back turned, a voice, one line. Not the main character.`) : `This dream is mainly the dreamer's own, about: ${pick(o.own || OWN)}. ${P} does not appear.`,
    picks.length ? `Material (use only this; add no other daytime details):\n${picks.join("\n")}` : "",
  ].filter(Boolean).join("\n");
  return { system, user, useWorry };
}

// The partner's name also counts as "them" for the harm check.
const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const harmsNamed = (name, text) => !!name && new RegExp(`${esc(name)}[^.,，。]{0,40}(hurt|bleed|die|dead|killed|accident|hospital|vanish|gone forever|受伤|流血|死|去世|出事|车祸|病危|医院|消失不见|不在了)`, "i").test(text);

// Check and clean one model reply. Returns a dream object for the engine, or null if it should be rewritten.
function parseDream(r, { sub = "", phase = "late", useWorry = false, mat = null, partner = "", guards = DEFAULT_GUARDS } = {}) {
  const text = String((r && r.text) || "").trim();
  if (!text) return null;
  if (sub === "loss" ? guards.gore.test(text) : guards.harm.test(text) || harmsNamed(partner, text)) return null;
  return {
    title: String(r.title || "").slice(0, 40), text: text.slice(0, 1500), fragment: String(r.fragment || "").slice(0, 80), feeling: String(r.feeling || "").slice(0, 40),
    intensity: Math.max(1, Math.min(5, Math.round(Number(r.intensity) || 2))), body: BODY(r.body), talk: String(r.talk || "").slice(0, 40),
    worry: useWorry && mat && mat.worry ? mat.worry.key || "" : "", phase,
  };
}

// o: { llm(system, user) → parsed JSON, self, partner, language, fears, own, guards, tries }
function makeDreamWriter(o) {
  if (!o || typeof o.llm !== "function") throw new Error("makeDreamWriter needs llm(system, user)");
  return async function write(kind, opts = {}) {
    const { system, user, useWorry } = buildPrompt(kind, opts, o);
    const tries = o.tries || 3;
    for (let i = 0; i < tries; i++) {
      let r; try { r = await o.llm(system, user); } catch (e) { if (i === tries - 1) throw e; continue; }   // bad JSON now and then: write it again
      const d = parseDream(r, { sub: opts.sub, phase: opts.phase, useWorry, mat: opts.mat, partner: o.partner, guards: o.guards || DEFAULT_GUARDS });
      if (d) return d;
    }
    return null;
  };
}

module.exports = { makeDreamWriter, buildPrompt, parseDream, DEFAULT_GUARDS };
