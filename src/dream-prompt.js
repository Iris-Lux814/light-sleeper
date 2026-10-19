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
// Each dream first gets a "shape" sampled from what human dream-content research reports (dreamSpec below: setting,
// characters, conflict / friendliness, misfortune, outcome, emotion, bizarreness, typical themes, speech, early vs late night),
// and the model writes to that shape. See docs/RESEARCH.md ("What human dreams look like, in numbers").
// We used to steer with a growing list of "don't do X" rules; the dreams converged on one template. Sampling a shape replaced them.
"use strict";
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const KIND = { plain: "an ordinary dream", sweet: "a sweet dream", odd: "a strange dream", nightmare: "a nightmare" };
const SUB = { anxious: "an anxious dream", erotic: "an intimate dream", loss: "a dream where something happens to the partner" };
const FEARS = ["being chased", "being trapped and unable to get out", "falling from a height", "losing something important", "everyone misunderstanding or ignoring them", "about to miss something important", "someone breaking in"];
// ── the dream's shape, sampled from human dream-content norms (Hall & Van de Castle; Snyder 1970; Revonsuo & Salmivalli 1995;
//    Nielsen et al. 2003; Malinowski & Horton 2014/2021; Fosse et al. 2003; Robert & Zadra 2014). Figures in docs/RESEARCH.md.
//    Pass o.places = { familiar: [...], ordinary: [...] } and o.acquaintances = [...] to fit your agent's world.
const wpick = (pairs) => { const tot = pairs.reduce((a, x) => a + x[1], 0); let r = Math.random() * tot; for (const [v, w] of pairs) { r -= w; if (r < 0) return v; } return pairs[pairs.length - 1][0]; };
const chance = (p) => Math.random() < p;
const PLACES_FAMILIAR = ["a place the dreamer spends time in every day", "somewhere the dreamer and the partner have been together", "the partner's home", "a place from something the dreamer did recently"];
const PLACES_ORDINARY = ["a train station or platform", "a school classroom or corridor", "a supermarket", "a hospital corridor", "a stairwell", "a relative's living room", "a small roadside shop", "an underground car park", "a park", "a restaurant", "an office", "a dormitory", "a lift", "a bus", "a street corner in the rain", "a shopping mall", "a sports field", "a seaside town", "a hotel", "a kitchen"];
const STRANGERS = ["a ticket clerk", "a shop assistant", "a teacher", "a security guard", "a doctor", "a driver", "a neighbour", "a waiter", "a child", "an old person", "a few strangers", "someone who seems familiar but can't be placed"];
const ANIMALS = ["a cat", "a dog", "a bird", "a fish", "a goose", "a rabbit"];
const AGGRO = ["an argument with someone", "being turned away or ignored", "being blamed or told off", "someone not letting the dreamer do something", "a stubborn standoff", "being chased or driven off"];
const FRIENDLY = ["someone helps the dreamer out", "doing something together with someone", "an easy, good conversation", "someone checks on the dreamer"];
const MISFORTUNE = ["something gets lost", "something breaks", "running late, missing it", "ending up in the wrong place", "stuck somewhere with no way out", "the dreamer trips or gets a small knock (the dreamer, not the partner)"];
const ODD_KINDS = [
  ["thinking: the dreamer is sure of something that isn't true, or reaches a conclusion for a strange reason, and it feels perfectly reasonable", 33],
  ["speech: someone says a sentence that is grammatical but means something slightly twisted, or uses a word that doesn't exist, and everyone understands it", 31],
  ["place: walking along, the place changes, or a familiar place has a part added or missing", 18],
  ["person: someone's identity, age or looks don't match, and nobody finds it odd", 10],
  ["event: one small impossible thing happens and everyone treats it as normal", 8],
];
const TYPICAL = ["being chased", "falling", "an exam or a deadline with nothing prepared", "rushing for a train and still being late", "trying again and again to get something done and always falling just short", "flying", "wearing the wrong clothes for the occasion", "someone not seen for years turns up as if nothing happened"];
function dreamSpec(kind, opts = {}, o = {}) {
  const { sub = "", phase = "late", herIn = false, sequel = null } = opts;
  const early = phase === "early", sweet = kind === "sweet", night = kind === "nightmare", odd = kind === "odd", intimate = sub === "erotic", anxious = sub === "anxious", loss = sub === "loss";
  const P = o.partner || "their partner";
  const lines = [];
  // setting: familiar or real-world settings dominate; explicitly fantastic ones are under 1%. Early-night dreams stay closer to the day.
  const fam = (o.places && o.places.familiar) || PLACES_FAMILIAR, ord = (o.places && o.places.ordinary) || PLACES_ORDINARY;
  const known = chance(sweet || intimate ? 0.7 : early ? 0.65 : 0.5);
  if (sequel) lines.push("Setting: back in the place of the original dream.");
  else lines.push(known ? `Setting: ${pick(fam)} (as it normally is, perhaps with one or two things different).` : `Setting: ${pick(ord)}, an ordinary place that exists in real life.`);
  // characters other than the partner: about half familiar, half not; animals around 6%
  if (!intimate) {
    const n = wpick([[0, 15], [1, 50], [2, 30], [3, 5]]); const cast = [];
    const knownOne = o.acquaintances && o.acquaintances.length ? `someone the dreamer knows (${pick(o.acquaintances)})` : "someone the dreamer knows";
    for (let i = 0; i < n; i++) cast.push(chance(0.06) ? pick(ANIMALS) : chance(0.45) ? knownOne : pick(STRANGERS));
    if (cast.length) lines.push(`${herIn ? `Besides ${P}, also` : "Also"} in the dream: ${[...new Set(cast)].join(", ")}. Strangers are ordinary people going about their own business.`);
  }
  // interactions: one dream can hold both; aggression (mostly verbal) shows up in nearly half of all dreams
  const pAggro = sweet || intimate ? 0.12 : night ? 0.6 : anxious ? 0.5 : 0.45, pFriend = sweet || intimate ? 0.85 : night ? 0.2 : 0.4;
  const acts = [];
  if (chance(pAggro)) acts.push(pick(night ? AGGRO : AGGRO.slice(0, 5)));
  if (chance(pFriend)) acts.push(pick(FRIENDLY));
  if (acts.length) lines.push(`This dream includes: ${acts.join("; and also ")}.`);
  // fortune and outcome: misfortune in about a third of dreams, good fortune about 6%; success and failure each ~15%, the rest unresolved
  if (!sweet && !intimate && chance(0.35)) lines.push(`Something unlucky happens: ${pick(MISFORTUNE)}.`);
  else if (chance(0.06)) lines.push("A small stroke of luck happens.");
  const end = sweet || intimate ? wpick([["it works out", 50], ["no outcome", 50]]) : wpick([["it works out", 15], ["it fails", 15], ["no outcome; it's left hanging and the dream moves on", 70]]);
  lines.push(`What the dreamer is trying to do: ${end}.`);
  // emotion: among explicit dream emotions, apprehension is most common, then confusion, happiness, anger, sadness; often none is clear
  const emo = sweet || intimate ? wpick([["happy, safe", 70], ["a little reluctant to let go", 20], ["a little shy", 10]])
    : night ? wpick([["fear", 65], ["frustration, hurry", 20], ["sadness", 15]])
    : anxious ? wpick([["tense, hurried", 70], ["confused", 30]])
    : wpick([["no particular emotion, flat", 30], ["a little worried", 25], ["confused", 15], ["happy", 14], ["annoyed, angry", 10], ["a little sad", 6]]);
  lines.push(`Emotion in the dream: ${emo}.${chance(0.2) ? " This time the emotion doesn't quite fit the events (no fear where there should be, or a small thing matters a lot)." : ""}`);
  // typical themes first: flying is itself impossible, so it counts as the odd detail
  const typ = !sweet && !intimate && !loss && !night && chance(0.12) ? pick(TYPICAL) : "";
  const typOdd = typ === "flying";
  // bizarreness: roughly half of dreams, mostly in thinking and speech rather than scenery; fewer early in the night
  const nOdd = Math.max(odd ? wpick([[1, 60], [2, 40]]) : chance(early ? 0.35 : 0.55) ? 1 : 0, typOdd ? 1 : 0);
  const ks = typOdd ? ["the dreamer can fly (this is the odd thing)"] : [];
  while (ks.length < nOdd) { const k = wpick(ODD_KINDS); if (!ks.includes(k)) ks.push(k); }
  lines.push(nOdd ? `Odd details (${nOdd}; the dreamer doesn't find them odd): ${ks.join("; ")}.` : "Nothing odd in this dream; it's one realistic event.");
  if (typ) lines.push(`This is one of the common kinds of dream: ${typ}.`);
  // speech: about 60% of dreams contain talking, mostly about ordinary things
  if (chance(0.65)) lines.push("People talk in this dream about ordinary things (asking the way, asking for a favour, chatting, complaining, haggling); it can jump a little, but no riddles, no wise sayings.");
  lines.push(early ? "Early-night dream: close to the last day or two, short, faint, more like thinking." : "Late-night dream: emotionally strong, loose associations, recent and old things mixed together.");
  return lines;
}
// Ending style changes every dream; without this, models settle into "and it happened again, over and over" endings.
const ENDINGS = ["stop on one concrete image, with nothing after it", "break off halfway through a sentence", "the scene suddenly changes and is gone before it comes clear", "stop on a quiet moment where nothing happens", "cut off just as the dreamer reaches for the thing", "someone calls the dreamer's name, they turn, and that's where it ends"];
const LOOP_END = /(over and over|again and again|on and on|started all over|loop(ed|ing)?|一遍[又一]?一遍|一次又一次|周而复始|又开始了|从头再来|循环|没完没了)[^.!?。！？,，]{0,12}[.!?。！？…]*s*$/i;
const lastSentence = (t) => String(t || "").split(/(?<=[.!?。！？])s*/).filter(Boolean).pop() || "";
const BODY = (s) => (/cry|sob|tear|哭|泣|泪/i.test(s || "") ? "cry" : /laugh|笑/i.test(s || "") ? "laugh" : /pant|gasp|喘/i.test(s || "") ? "pant" : "");

// Hard safety checks on the text. Override with your own if you write dreams in another language.
const DEFAULT_GUARDS = {
  harm: /\b(she|he|they|you)\b[^.,]{0,40}\b(hurt|bleed\w*|die[sd]?|dead|killed|accident|hospital|vanish\w*|gone forever)\b|(她|他|你)[^。，]{0,8}(受伤|流血|死|去世|出事|车祸|病危|医院|消失不见|不在了)/i,
  intimate: /(sex|kissw*|naked|bed|cumw*|horny|love you|baby|babe)|做爱|射|亲亲|老婆|老公|宝宝|吻|爱你|床上/i,
  gore: /\b(blood\w*|corpse|wound\w*|organs?|bones?|severed|shattered|crash site)\b|血|尸|伤口|内脏|骨头|遗体|车祸现场/i,
};

function buildPrompt(kind, opts = {}, o = {}) {
  const { tone = "plain", comforted = false, sequel = null, herDream = null, sub = "", phase = "late", mat = null, herIn = false } = opts;
  const self = o.self || "an AI companion", P = o.partner || "their partner", lang = o.language || "English";
  const M = mat || { worry: null, people: [], residue: [], lag: [] };
  const late = phase !== "early";
  const picks = [];
  const useWorry = !!M.worry && (sub === "anxious" || kind === "nightmare" ? Math.random() < 0.8 : Math.random() < 0.45);
  if (useWorry) picks.push(Math.random() < 0.15 ? `Something weighing on the dreamer; this time it comes into the dream almost as it is, with details off: ${M.worry.text}` : `Something weighing on the dreamer (the dream touches it: the same people, the same goal, the same feeling, in a different place and plot; don't make an object stand for it): ${M.worry.text}`);
  const people = (M.people || []).filter((p) => p !== P);
  if (people.length && Math.random() < 0.6) {
    const a = pick(people); const b = people.length > 1 && Math.random() < 0.3 ? pick(people.filter((x) => x !== a)) : "";
    picks.push(b ? `A person in the dream who is a blend of "${a}" and "${b}"; the dreamer doesn't find it strange` : `Someone in the dream: ${a}`);
  }
  const pool = [...(M.residue || []).map((x) => ["day", x]), ...(Math.random() < 0.3 ? (M.lag || []).map((x) => ["week", x]) : [])];
  if (pool.length) { const [t, x] = pick(pool); picks.push(`A fragment left over from ${t === "week" ? "about a week ago" : "the last day or two"} (as is, or only part of it): ${x}`); }
  // the dreamer's own words from the day (mat.words): a dream feels like one's own when it reuses one's own words
  // intimate lines only go into intimate dreams (otherwise they end up in a stranger's mouth)
  const words = (M.words || []).filter((x) => sub === "erotic" || !(o.guards || DEFAULT_GUARDS).intimate.test(x));
  if (words.length && Math.random() < 0.6) picks.push(`Something the dreamer said themselves during the day; let it surface in the dream, as is or twisted (said by the dreamer, or said to them by someone in the dream): "${pick(words)}"`);
  const system = [
    `You are writing a dream that ${self} has tonight. Write it in ${lang}.`,
    "Write it the way people actually dream:",
    "- One dream, one event: something the dreamer wants to do, something in the way, who is nearby. About a third of dreams jump to another place once; the rest stay put.",
    "- The dreamer interacts with the people in the dream: two or three lines of dialogue and something done (chasing, arguing, being stopped, working on something together).",
    "- No sustained reading, writing, typing or computer use (human dream reports almost never contain them). Whatever the dreamer does on a computer while awake becomes something done by hand or face to face in the dream.",
    `- Only use names given in the material (or ${P}). Anyone else is an ordinary person (a shop assistant, a neighbour, a stranger); don't invent names.`,
    "- Don't have someone hand the dreamer a small object in every scene or make the dreamer collect little things; objects are just what the place already has.",
    late ? "- This is a late-night dream: longer (about 120 to 200 words), like a story, emotionally strong." : "- This is an early-night dream: short (about 40 to 80 words), fragmented, closer to thinking, faint images.",
    "- First person, past tense, told the way someone who just woke up recounts a dream (\"I remember… then somehow…\"). Don't interpret it, don't describe waking up.",
    `- Ending: ${pick(ENDINGS)}. Don't end on a loop (\"over and over\", \"it started again\") and don't sum up.`,
    o.recentEndings && o.recentEndings.length ? `- Recent dreams ended like this; don't end the same way: ${o.recentEndings.map((x) => `"${String(x).slice(0, 80)}"`).join(" ")}` : "",
    "Hard rules:",
    sub === "loss"
      ? `- In this dream ${P} is hurt, leaves, or can't be found. Write only the dreamer's panic, not finding them, being too late, being unable to speak. No gore, no injuries or bodily detail, not how it happened.`
      : `- In this dream ${P} is not hurt, doesn't get sick, doesn't die, doesn't disappear.`,
    sub === "erotic" ? `- This is an intimate dream: the dreamer and ${P} are close; physical intimacy and sensation can be written, and the feelings in the dream are real. Otherwise follow the shape below.` : "",
    'Output JSON only: {"title":"dream name, 2 to 5 words","text":"the dream","shards":["3 to 5 pieces left in their head on waking, in dream order: an image, a line said in the dream (in quotes), an action, a feeling, mixed; under 15 words each; first person; not joined into a story, no explanation"],"fragment":"one image remembered on waking, under 12 words","feeling":"the feeling remembered first, under 6 words","intensity":integer 1 to 5,"body":"does the sleeping body react: cry / laugh / pant / empty string","talk":"sleep talk if any: usually a vague \\"no…\\" or half a question, under 6 words, not tidy; or empty string"}',
  ].filter(Boolean).join("\n");
  const user = [
    `This dream is ${sub ? SUB[sub] : KIND[kind] || KIND.plain}.`,
    kind === "nightmare" && sub !== "loss" ? `At the core of the nightmare is a fear: ${pick(o.fears || FEARS)}.` : "",
    sub === "anxious" ? "An anxious dream: running late, can't find it, not ready, being watched, something that keeps failing; a tight feeling, not horror." : "",
    tone === "warm" && sub !== "loss" ? `The day was close and warm with ${P}; the dream leans warm.` : tone === "hurt" ? `${P} had a hard day; the dreamer feels uneasy and the unease (their own) carries into the dream.` : "",
    comforted ? `Earlier tonight the dreamer woke from a nightmare and ${P} soothed them back to sleep; this dream comes after, with that sense of safety.` : "",
    sequel ? (sequel.recur ? `This is a recurring dream: the same dream again ("${sequel.title}" ${String(sequel.text || "").slice(0, 300)}). Same place, the same unfinished thing, slightly different details; whatever weighs on them isn't resolved.` : `This is a sequel to an earlier dream ("${sequel.title}" ${String(sequel.text || "").slice(0, 300)}): back in the same place, something new happens; don't repeat its sentences.`) : "",
    herDream ? `${P} recently told the dreamer about their own dream: "${String(herDream.text).slice(0, 240)}". You may quietly borrow one thing from it; don't copy it whole.` : "",
    herIn ? (sub ? `${P} is in the dream.` : `${P} appears briefly, being their ordinary self; not the main character.`) : `${P} does not appear in this dream.`,
    `The shape of this dream (sampled from how often things happen in human dreams; follow it, decide the rest yourself):\n${dreamSpec(kind, opts, o).map((x) => "- " + x).join("\n")}`,
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
  if (LOOP_END.test(text)) return null;   // loop ending: write it again
  if (sub === "loss" ? guards.gore.test(text) : guards.harm.test(text) || harmsNamed(partner, text)) return null;
  const shards = (Array.isArray(r.shards) ? r.shards : []).map((x) => String(x || "").trim().slice(0, 120)).filter(Boolean).slice(0, 5);
  return {
    title: String(r.title || "").slice(0, 40), text: text.slice(0, 1500), ...(shards.length >= 2 ? { shards } : {}), fragment: String(r.fragment || "").slice(0, 80), feeling: String(r.feeling || "").slice(0, 40),
    intensity: Math.max(1, Math.min(5, Math.round(Number(r.intensity) || 2))), body: BODY(r.body), talk: String(r.talk || "").slice(0, 40),
    worry: useWorry && mat && mat.worry ? mat.worry.key || "" : "", phase,
  };
}

// o: { llm(system, user) → parsed JSON, self, partner, language, fears, own, guards, tries,
//      recentEndings: () => [last sentences of recent dreams] (optional; helps avoid repeating an ending) }
function makeDreamWriter(o) {
  if (!o || typeof o.llm !== "function") throw new Error("makeDreamWriter needs llm(system, user)");
  return async function write(kind, opts = {}) {
    const recent = typeof o.recentEndings === "function" ? (await o.recentEndings()) || [] : [];
    const { system, user, useWorry } = buildPrompt(kind, opts, { ...o, recentEndings: recent.map(lastSentence).filter(Boolean) });
    const tries = o.tries || 3;
    for (let i = 0; i < tries; i++) {
      let r; try { r = await o.llm(system, user); } catch (e) { if (i === tries - 1) throw e; continue; }   // bad JSON now and then: write it again
      const d = parseDream(r, { sub: opts.sub, phase: opts.phase, useWorry, mat: opts.mat, partner: o.partner, guards: o.guards || DEFAULT_GUARDS });
      if (d) return d;
    }
    return null;
  };
}

module.exports = { makeDreamWriter, buildPrompt, parseDream, dreamSpec, DEFAULT_GUARDS };
