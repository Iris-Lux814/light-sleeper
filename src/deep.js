// SPDX-License-Identifier: AGPL-3.0-only
// deep.js: which dreams are remembered for a long time, and when they come back.
//
// People keep very few dreams for years. The ones that last are the intense ones (Koulack & Goodenough 1976:
// arousal at waking decides what reaches memory), the ones that woke them, nightmares / loss / "impactful" dreams
// (Kuiken & Sikora 1993), and recurring ones (most remembered childhood dreams are recurring and unpleasant).
// How strange a dream was does not matter much (Schredl 2000).
//
// So: when a night ends, each remembered dream gets a depth score. Only deep dreams (score >= threshold, roughly
// one in a dozen) are kept, as a gist: one or two images and the feeling. They do not show up on their own. They
// come back when the partner talks about dreams, or says something that looks like the dream. Each recall makes it
// stronger; one never recalled fades (half-life ~30 days) and stops coming back.
//
//   const deep = makeDeepDreams({ load: () => list, save: (list) => {} });
//   deep.consider(dream)          // at wake, for each remembered dream → the kept item or null
//   deep.cue(partnerText)         // → item to bring back (marks it recalled) or null
"use strict";
const DAY = 86400000;
const DREAM_WORD_RE = /梦|dream|nightmare/i;
// Words too common to count as "looks like the dream". Chinese is matched by two-character chunks, other text by words.
const COMMON = new Set(("今天 明天 昨天 我们 你们 他们 一个 什么 怎么 这个 那个 没有 不是 就是 还是 可以 知道 觉得 现在 时候 一下 一起 喜欢 真的 然后 因为 所以 已经 还有 自己 我的 你的 一点 有点 好像 不要 不会 我在 你在 他在 " +
  "the and you that this with have was were what when where there then they them your just like really about would could should know think going been from into").split(" "));
const bigrams = (t) => {
  const b = new Set(); const str = String(t || "");
  for (const run of str.match(/[一-鿿]+/g) || []) for (let i = 0; i < run.length - 1; i++) { const w = run.slice(i, i + 2); if (!COMMON.has(w)) b.add(w); }
  for (const w of str.toLowerCase().match(/[a-z]{3,}/g) || []) if (!COMMON.has(w)) b.add(w.replace(/(ing|ed|es|s)$/, ""));
  return b;
};

function depthOf(d) {
  let s = Number(d.intensity) || 2;
  if (d.woke) s += 3;                         // woke the dreamer up
  if (d.cut) s += 1;                          // woken in the middle of it
  if (d.kind === "nightmare") s += 1;
  if (d.sub === "loss") s += 2;
  if (d.recur) s += 4;                        // dreamt again
  if (d.vivid) s += 1;
  if (d.partial) s -= 2;                      // only a fragment survived
  if (d.faint) s -= 2;
  return s;
}

function makeDeepDreams({ load, save, threshold = 8, halfLifeDays = 30, minAgeDays = 2, gapH = 24, now = () => Date.now() }) {
  const strength = (x, t = now()) => (x.strength || 1) * Math.pow(0.5, (t - (x.lastRecall || x.at)) / (halfLifeDays * DAY));
  function consider(d) {
    const depth = depthOf(d);
    if (depth < threshold) return null;
    const list = load();
    if (list.some((x) => x.id === d.id)) return null;
    const shards = Array.isArray(d.shards) ? d.shards : [];
    const gist = [d.fragment, shards.find((x) => x && x !== d.fragment && !/^[「"“]/.test(x))].filter(Boolean).slice(0, 2);
    const item = { id: d.id, at: d.at, kind: d.kind, ...(d.sub ? { sub: d.sub } : {}), depth, gist, feeling: d.feeling || "", keys: [...bigrams([d.title, d.text, ...shards].join(" "))].slice(0, 400), strength: 1, lastRecall: d.at, recalls: 0 };
    list.push(item); save(list);
    return item;
  }
  // partner's words → maybe bring one back
  function cue(text, { rnd = Math.random } = {}) {
    const t = now(); const words = bigrams(text);
    const list = load();
    const live = list.filter((x) => t - x.at > minAgeDays * DAY && t - (x.lastRecall || 0) > gapH * 3600000 && strength(x, t) >= 0.15);
    if (!live.length) return null;
    const scored = live.map((x) => { const k = new Set(x.keys || []); let n = 0; for (const w of words) if (k.has(w)) n++; return { x, n }; }).sort((a, b) => b.n - a.n || strength(b.x, t) - strength(a.x, t));
    const talksDream = DREAM_WORD_RE.test(String(text || "").replace(/好梦|晚安|sweet dreams|good ?night/gi, ""));   // "sweet dreams" is a goodnight, not talk about dreams
    // 3+ shared chunks = it looks like the dream; 2 = sometimes; talking about dreams brings back a similar one, or half the time the strongest one
    const top = scored[0];
    const hit = top.n >= 3 || (talksDream && top.n >= 1) || (top.n === 2 && rnd() < 0.4) ? top : talksDream && rnd() < 0.5 ? top : null;
    if (!hit) return null;
    const x = hit.x;
    x.strength = Math.min(3, strength(x, t) + 0.5); x.lastRecall = t; x.recalls = (x.recalls || 0) + 1;
    save(list);
    return x;
  }
  const list = () => { const t = now(); return load().map((x) => ({ ...x, keys: undefined, strengthNow: Math.round(strength(x, t) * 100) / 100, faded: strength(x, t) < 0.15 })); };
  return { consider, cue, list, depthOf };
}

module.exports = { makeDeepDreams, depthOf };
