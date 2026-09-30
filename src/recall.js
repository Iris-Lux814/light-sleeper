// SPDX-License-Identifier: AGPL-3.0-only
// recall.js: what is left of a dream on waking.
// The companion is never handed a finished story with a title (that reads like someone else's writing).
// It gets the shards left over and retells the dream itself, filling gaps the way people do:
// dream reports are reconstructed on waking, not replayed.
"use strict";

// d.shards from the writer; for dreams without shards, cut a few pieces out of the text
function shardsOf(d) {
  if (Array.isArray(d.shards) && d.shards.length) return d.shards;
  const s = String(d.text || "").split(/[。！？!?…]+|(?<=\w)[.;]\s+/).map((x) => x.trim()).filter((x) => x.length >= 4);
  const out = s.length <= 4 ? s : [s[0], s[Math.floor(s.length / 3)], s[Math.floor((2 * s.length) / 3)], s[s.length - 1]];
  return [...new Set(out)].map((x) => x.slice(0, 80));
}
// woken in the middle of a dream: only the first half, cut off there
function cutShards(d) { const s = shardsOf(d); return s.slice(0, Math.max(1, Math.ceil(s.length / 2))); }
const bullets = (xs) => xs.map((x) => `  · ${x}`).join("\n");

module.exports = { shardsOf, cutShards, bullets };
