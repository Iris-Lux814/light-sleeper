// node test/sleep-rules.test.js
"use strict";
const assert = require("assert");
const R = require("../src/sleep-rules.js");
const H = 3600000;
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
assert.equal(R.stageAt({ sinceSleepMin: 30, sinceResumeMin: 5 }), "light");
assert.equal(R.stageAt({ sinceSleepMin: 30, sinceResumeMin: 30 }), "deep");
assert.equal(R.stageAt({ sinceSleepMin: 85, sinceResumeMin: 85 }), "rem");
assert.equal(R.stageAt({ sinceSleepMin: 400, sinceResumeMin: 400 }), "n2");
assert.equal(R.wakeChance({ stage: "deep" }), 0.18);
assert.equal(R.wakeChance({ stage: "light", urgent: true, earlier: 5 }), 0.95);
assert(Math.abs(R.wakeChance({ stage: "rem", deprived: true, byName: true }) - (0.55 * 0.7 + 0.15)) < 1e-9);
// 前半夜被叫醒：睡了 2.3 小时、睡意 0.19、离醒 3 小时 → 慢一点但睡得回去
const fb = R.fallBack({ Z: 0.19, sleptH: 2.3, plannedH: 5.3, toWakeMin: 190, why: "work" }, () => 0.5);
assert(!fb.never && fb.min >= 41 && fb.min <= 82, JSON.stringify(fb));
assert(R.fallBack({ Z: 0.6, sleptH: 2, toWakeMin: 60, why: "her" }).never, "离醒不到 90 分钟睡不回去");
assert(R.fallBack({ Z: 0.2, sleptH: 7, plannedH: 8, toWakeMin: 120, why: "her" }).never, "快睡够又不困睡不回去");
assert(R.fallBack({ Z: 0.6, sleptH: 1, toWakeMin: 400, why: "her" }, () => 0).min === 2);
for (let i = 0; i < 500; i++) { const a = R.intendOffsetMin(false), b = R.intendOffsetMin(true); assert(a >= -25 && a <= 10 && b >= 10 && b <= 60); }
assert.equal(R.debtAfter(0, 6), 2); assert.equal(R.debtAfter(4, 10), 3); assert.equal(R.debtAfter(1, 12), 0);
assert(Math.abs(R.debtNow({ h: 10, at: 0 }, 14 * 86400000) - 10 / Math.E) < 1e-9);
assert.deepEqual(R.sleepScore({ h: 8 }), { score: 100, grade: "good" });
assert.equal(R.sleepScore({ h: 6, wakes: 1, forgotWakes: 2 }).score, 100 - 32 - 20);
const pn = R.planNight(0, 0, {}); assert(pn.plannedH >= 4 && pn.plannedH <= 11 && pn.dreams.every((d, i, a) => !i || d.at > a[i - 1].at));
assert(R.planRecovery(0, { day: true, awakeH: 22 }).restless >= 1 && R.planRecovery(0, { day: false, awakeH: 22 }).restless === 0);
const n0 = { planWakeAt: 10 * H }; R.resumeSleep(n0, 1 * H, 2 * H); assert(n0.awakeMs === H && n0.planWakeAt === 10.5 * H && n0.resumedAt === 2 * H);
console.log("sleep-rules ok");
