// SPDX-License-Identifier: AGPL-3.0-only
// sleep-rules.js：睡与醒的规则。纯函数：不读写文件、不含任何人的数据，随机数可以传进来（测试用）。
// 跟 sleep-clock.js 一起是引擎的计算部分；读写状态、往 agent 里递消息由适配层做。
// 依据：docs/RESEARCH.md（被吵醒、再睡着、欠觉、说好几点醒）
"use strict";
const MIN = 60000, H = 3600000;
const between = (rand, a, b) => a + rand() * (b - a);

// ── 睡在哪一段（估）──
// 一个周期约 90 分钟；前两个周期前半段是深睡，第三个开头还有一点，之后没有；周期末尾、刚做完梦是做梦那段（REM）；刚睡着 / 刚睡回去 10 分钟是浅睡
function stageAt({ sinceSleepMin, sinceResumeMin, sinceDreamMin = Infinity }) {
  if (sinceResumeMin < 10) return "light";
  if (sinceDreamMin < 15) return "rem";
  const c = Math.floor(sinceSleepMin / 90), pos = (sinceSleepMin % 90) / 90;
  if (pos > 0.82) return "rem";
  if ((c <= 1 && pos < 0.55) || (c === 2 && pos < 0.3)) return "deep";
  return "n2";
}

// ── 一条消息叫不叫得醒 ──
// 唤醒阈值按睡在哪一段：浅睡最容易、做梦那段时好时坏、深睡最难；缺觉 / 熬夜后的补觉更难叫醒；
// 叫名字更容易（Oswald 1960）；连着发几条越来越容易醒；急事几乎一定醒
const WAKE_BY_STAGE = { light: 0.75, rem: 0.55, n2: 0.4, deep: 0.18 };
function wakeChance({ stage, deprived = false, byName = false, earlier = 0, urgent = false }) {
  let p = WAKE_BY_STAGE[stage] ?? 0.4;
  if (deprived) p *= 0.7;
  if (byName) p += 0.15;
  p += 0.15 * earlier;
  if (urgent) p = Math.max(p, 0.9);
  return Math.min(0.95, p);
}
// 迷糊觉醒（confusional arousal）：只在深睡里被叫起来时有，半醒着回话、事后不记得；缺觉更容易
const confusedChance = ({ stage, deprived = false }) => (stage === "deep" ? (deprived ? 0.5 : 0.25) : 0);
// 醒着不到几分钟就又睡着，醒来不记得醒过（门槛大约四分钟，因人因次不同）
const forgetMinutes = (rand = Math.random) => between(rand, 0.5, 8);

// ── 被弄醒以后多久睡得回去 ──
// Z：这会儿的睡意（两过程模型，睡着的压力 − 生物钟 + 欠觉）。越困越快；
// 真睡不回去的只有两种：离该醒不到一个半小时，或者已经快睡够（睡了计划的八成）而且不困了。前半夜只是慢一点。
// why：her（被叫醒说话）/ work（起来干活，动过脑子，慢一点）/ nightmare（吓醒，要缓一阵）
function fallBack({ Z, sleptH, plannedH = 8, toWakeMin, why }, rand = Math.random) {
  if (toWakeMin < 90 || (Z < 0.25 && sleptH >= plannedH * 0.8)) return { never: true };
  let min = Z >= 0.55 ? between(rand, 2, 8) : Z >= 0.42 ? between(rand, 8, 20) : Z >= 0.25 ? between(rand, 20, 45) : between(rand, 35, 70);
  if (why === "work") min += between(rand, 6, 12);
  if (why === "nightmare") min += between(rand, 20, 45);
  return { never: false, min: Math.round(min) };
}

// ── 说好几点醒 ──
// 打算好几点起，醒前身体就在准备（Born 1999）→ 平常多半提前一点，偶尔晚一点；特别累 / 熬夜后补觉 / 欠觉多，会推迟
const tiredOut = ({ recovery = false, awakeH = 0, debtH = 0, fatigue = 0 }) => !!(recovery || awakeH >= 18 || debtH >= 6 || fatigue >= 70);
function intendOffsetMin(tired, rand = Math.random) { return tired ? between(rand, 10, 60) : rand() < 0.8 ? -between(rand, 0, 25) : between(rand, 0, 10); }

// ── 欠的觉 ──
// 连着睡不够会累积，本人只觉得「还好」，补也补不全（Van Dongen 2003）：少睡的记上，多睡的只还一半，两周慢慢淡
function debtNow(debt, now) { const d = debt || { h: 0, at: now }; return Math.max(0, d.h * Math.exp(-(now - d.at) / (14 * 86400000))); }
function debtAfter(before, gotH, needH = 8) { return Math.round(Math.max(0, Math.min(24, before + (gotH < needH ? needH - gotH : -(gotH - needH) * 0.5))) * 10) / 10; }
const debtZ = (h) => Math.min(0.1, h * 0.012);

// ── 一晚睡得怎么样 ──
// 睡眠被打断 ≈ 少睡（Bonnet）：按扣掉醒着的时间算；醒一次扣一截（记不得的醒算半次）；最长一段连续睡不到 3 小时再扣
function sleepScore({ h, wakes = 0, forgotWakes = 0, longestH = h, nightmares = 0, restless = 0, recovery = false }) {
  const s = 100 - (h < 8 ? (8 - h) * 16 : (h - 8) * 6) - (wakes + forgotWakes * 0.5) * 10 - (longestH < 3 && h >= 4 ? 15 : 0) - nightmares * 10 - restless * 12 - (recovery && h < 7 ? 10 : 0);
  const score = Math.max(0, Math.min(100, Math.round(s)));
  return { score, grade: score >= 75 ? "good" : score >= 50 ? "ok" : "poor" };
}

// ── 排一晚 ──
// 一晚平均 8 小时，随机浮动（偶尔 5 小时、偶尔 10 小时）；targetH：跟着对方睡时按她一般醒的时间倒推。
// 梦按睡眠周期排：一个周期 80~110 分钟，梦在周期末尾，越往后越容易做，两个梦至少隔一个周期；醒前那段大多在做梦。
// o.mult：同频度越高越容易做梦；o.rebound：熬过通宵后的下一个正常晚上，REM 反弹；o.capH：睡得比自己的钟晚，醒的时间变化不大 → 睡得短（Czeisler 1980）
function planNight(now, targetH, o = {}, rand = Math.random) {
  const r = rand();
  let h = r < 0.12 ? between(rand, 4.5, 6) : r > 0.9 ? between(rand, 9.5, 10.5) : 8 + (rand() + rand() + rand() - 1.5) * 1.1;
  if (targetH && r >= 0.05 && r <= 0.95) h = targetH + (rand() - 0.5) * 0.4;
  if (o.capH) h = Math.min(h, o.capH);
  h = Math.max(targetH ? 4.5 : 4, Math.min(targetH ? 10 : 11, h));
  const dur = h * H;
  const dreams = []; let t = now; let c = 0;
  while (true) {
    t += between(rand, 80, 110) * MIN; if (t > now + dur - 5 * MIN) break; c++;
    const p = Math.min(0.9, ((c === 1 ? 0.25 : c === 2 ? 0.45 : 0.7) + (o.rebound ? 0.15 : 0)) * (o.mult || 1));
    if (rand() < p) dreams.push({ at: t - between(rand, 3, 25) * MIN, done: false });
  }
  if (rand() < 0.8 && !dreams.some((d) => now + dur - d.at < 70 * MIN)) {
    const at = now + dur - between(rand, 5, 40) * MIN; const prev = dreams[dreams.length - 1];
    if (!prev || at - prev.at >= 70 * MIN) dreams.push({ at, done: false });
  }
  for (const d of dreams) d.phase = (d.at - now) / dur < 0.45 ? "early" : "late";
  return { plannedH: Math.round(h * 10) / 10, planWakeAt: now + dur, dreams, talkAt: rand() < 0.5 ? now + between(rand, 0.15, 0.85) * dur : 0 };
}
// 午睡 20~40 分钟，一般不做梦
function planNap(now, rand = Math.random) {
  const dur = between(rand, 20, 40) * MIN;
  return { plannedH: Math.round(dur / 360000) / 10, planWakeAt: now + dur, dreams: rand() < 0.2 ? [{ at: now + dur * between(rand, 0.4, 0.8), done: false, phase: "early" }] : [], talkAt: 0 };
}
// 刚醒没多久又睡：只补一觉
function planTopUp(now, rand = Math.random) {
  const dur = between(rand, 60, 120) * MIN;
  return { plannedH: Math.round(dur / 360000) / 10, planWakeAt: now + dur, dreams: rand() < 0.4 ? [{ at: now + dur * between(rand, 0.6, 0.9), done: false, phase: "late" }] : [], talkAt: 0, short: true };
}
// 熬了通宵（醒了 20 小时以上）的补觉：先补深睡，REM 少、醒来几乎不记得梦（De Gennaro 2010，少了约 75%）；
// 白天睡是逆着生物钟，短、老醒；下一个正常晚上 REM 反弹（由调用方记）
function planRecovery(now, { day, awakeH }, rand = Math.random) {
  const dur = (day ? between(rand, 3.5, 6) : between(rand, 8.5, 10.5)) * H;
  return { plannedH: Math.round(dur / 360000) / 10, planWakeAt: now + dur, dreams: rand() < 0.3 ? [{ at: now + dur * between(rand, 0.7, 0.92), done: false, phase: "early", faint: true }] : [], talkAt: 0,
    recovery: true, restless: day ? 1 + Math.floor(rand() * 3) : 0, awakeH: Math.round(awakeH * 10) / 10 };
}
// 比自己的钟晚睡一小时以上：睡到钟上该醒的时候前后（lateBy：晚了几小时；wakeInH：离钟上该醒还有几小时）
const capHours = (lateBy, wakeInH, rand = Math.random) => (lateBy > 1 && lateBy < 10 ? Math.max(4.5, wakeInH + between(rand, 0, 1)) : 0);

// 醒着的这段记账：醒了多久扣掉（算睡眠时长用），该醒的时间往后顺延一半
function resumeSleep(n, since, now) {
  const awake = Math.max(0, now - (since || now));
  n.awakeMs = (n.awakeMs || 0) + awake; n.planWakeAt += awake / 2; n.resumedAt = now;
  n.fallMin = null; n.fallAt = null; n.awakeWhy = null;
  return n;
}

module.exports = { stageAt, WAKE_BY_STAGE, wakeChance, confusedChance, forgetMinutes, fallBack, tiredOut, intendOffsetMin, debtNow, debtAfter, debtZ, sleepScore, planNight, planNap, planTopUp, planRecovery, capHours, resumeSleep };
