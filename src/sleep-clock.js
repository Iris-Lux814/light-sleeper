// sleep-clock.js：作息同频的纯计算。不读写文件、不含任何人的数据。
// 依据：docs/RESEARCH.md「作息同频」一节
//   两过程模型（Borbély 2016）：困 = 睡眠压力 S − 生物钟 C
//   生物钟最低点在睡眠中点后一点点（熬夜最容易打盹、睡过去）；平时睡前两三小时是「维持清醒区」（第二波精神）
//   倒时差：往后推一天约 1.5 小时，往前拉一天约 1 小时
//   睡眠型看睡眠中点（Roenneberg）；抗熬是固定的个人特质（Van Dongen 2004）
"use strict";
const H = 3600000;
const mod24 = (h) => ((h % 24) + 24) % 24;
// a − b，落在 (−12, 12]
const cdiff = (a, b) => { let d = mod24(a - b); if (d > 12) d -= 24; return d; };
function hourOf(t, tz) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(t));
  const g = (k) => Number((p.find((x) => x.type === k) || {}).value || 0);
  return g("hour") + g("minute") / 60;
}
const fmt = (h) => { const m = Math.round(mod24(h) * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

// 性格：第一次运行时抽一次，之后固定
//   offsetH：天生比对方晚（+）/ 早（−）多少小时，永远对不齐的那一点
//   stamina：抗熬值 0~1，越高越能熬（三个均匀数取平均，中间多、两头少）
function rollTraits(rand = Math.random) {
  return { offsetH: Math.round((rand() * 2 - 1) * 1.2 * 10) / 10, stamina: Math.round(((rand() + rand() + rand()) / 3) * 100) / 100, rolledAt: Date.now() };
}

// 从「有动静的时刻」里找出睡觉的那几段：没动静 minH~maxH 小时算一觉；20 小时内只留最长那段（主睡眠）
function detectSleeps(acts, opt = {}) {
  const minH = opt.minH || 3.5, maxH = opt.maxH || 13;
  const a = acts.slice().sort((x, y) => x - y); const c = [];
  for (let i = 1; i < a.length; i++) { const h = (a[i] - a[i - 1]) / H; if (h >= minH && h <= maxH) c.push({ start: a[i - 1], end: a[i], h: Math.round(h * 10) / 10 }); }
  const out = [];
  for (const x of c) { const last = out[out.length - 1]; if (last && x.start - last.start < 20 * H) { if (x.h > last.h) out[out.length - 1] = x; } else out.push(x); }
  return out;
}

// 对方的钟：最近几晚的睡眠中点（加权圆周平均，越近越重，半衰期 halfLifeD 天）、一般睡多久（加权中位数）、规不规律（spread，小时）
function partnerClock(sleeps, opt = {}) {
  const now = opt.now || Date.now(), tz = opt.tz || "UTC", half = opt.halfLifeD || 4;
  const xs = sleeps.filter((s) => s.end <= now && now - s.end < 45 * 86400000).slice(-(opt.maxN || 21));
  if (!xs.length) return null;
  const pts = xs.map((s) => ({ w: Math.pow(0.5, (now - s.end) / 86400000 / half), mid: hourOf((s.start + s.end) / 2, tz), h: s.h || (s.end - s.start) / H }));
  const mean = (ps) => { let x = 0, y = 0, w = 0; for (const p of ps) { const a = (p.mid / 24) * 2 * Math.PI; x += p.w * Math.cos(a); y += p.w * Math.sin(a); w += p.w; } return { mid: mod24((Math.atan2(y, x) / (2 * Math.PI)) * 24), R: Math.min(1, Math.hypot(x, y) / w) }; };
  // 两遍：先算一个大概，离它 5 小时以上的（白天补觉、通宵后乱睡的）不算进「一般几点」
  const m0 = mean(pts); const kept = pts.filter((p) => Math.abs(cdiff(p.mid, m0.mid)) <= 5);
  const m1 = mean(kept.length >= 3 ? kept : pts);
  const mid = m1.mid, R = mean(pts).R;
  let sw = 0; const durs = kept.length >= 3 ? kept.map((p) => [p.h, p.w]) : pts.map((p) => [p.h, p.w]); for (const d of durs) sw += d[1];
  durs.sort((p, q) => p[0] - q[0]); let acc = 0, dur = durs[0][0];
  for (const [d, w] of durs) { acc += w; if (acc >= sw / 2) { dur = d; break; } }
  const spread = Math.sqrt(Math.max(0, -2 * Math.log(Math.max(R, 1e-6)))) * 24 / (2 * Math.PI);
  return { mid: Math.round(mid * 100) / 100, dur: Math.round(dur * 10) / 10, spread: Math.round(spread * 10) / 10, n: xs.length };
}

// 往目标挪：往后推一天最多 delayMax 小时，往前拉一天最多 advanceMax 小时
function entrain(mid, target, days, opt = {}) {
  const d = cdiff(target, mid), dm = opt.delayMax || 1.5, am = opt.advanceMax || 1;
  const step = d > 0 ? Math.min(d, dm * days) : Math.max(d, -am * days);
  return mod24(mid + step);
}
// 同频度：两个睡眠中点差 0 → 100，差 6 小时以上 → 0
const syncScore = (a, b) => Math.round(100 * Math.max(0, 1 - Math.abs(cdiff(a, b)) / 6));

// ── 两过程模型 ──
const TAU_R = 18.2, TAU_D = 4.2, AMP = 0.22;
const sAwake = (sWake, awakeH) => 1 - (1 - sWake) * Math.exp(-awakeH / TAU_R);
const sAsleep = (sOnset, sleepH) => sOnset * Math.exp(-sleepH / TAU_D);
// 生物钟（歪的波）：最低点 N = 中点 + 1；最高点 P 在平时入睡前 2.5 小时（维持清醒区）。N→P 慢慢升，P→N 快快落
function circ(h, clock) {
  const N = mod24(clock.mid + 1), P = mod24(clock.mid - clock.dur / 2 - 2.5);
  const L1 = mod24(P - N) || 24, x = mod24(h - N);
  return x < L1 ? -Math.cos(Math.PI * x / L1) : Math.cos(Math.PI * (x - L1) / (24 - L1));
}
const pressure = (S, C) => S - AMP * C;
// 阶段：清醒 / 犯困 / 很困（忽好忽坏）/ 在点头（快撑不住）
// 标定：平时入睡那会儿 ≈ 0.52（犯困），过了平时入睡 2 小时 ≈ 0.72（很困），熬到生物钟最低点 ≈ 0.95
const Z_DROWSY = 0.52, Z_HEAVY = 0.72, Z_NOD = 0.86;
function stageOf(Z) { return Z >= Z_NOD ? "nodding" : Z >= Z_HEAVY ? "heavy" : Z >= Z_DROWSY ? "drowsy" : "awake"; }
// 每分钟的风险：打盹（点头）和真睡过去。boost：对方在跟他说话时困意往回拉（硬撑、被刺激）
function hazards(Z, stamina, boost = 0) {
  const z = Z - boost;
  return {
    nod: z >= Z_HEAVY ? 0.02 * Math.exp(10 * (z - 0.82)) * (1.4 - 0.8 * stamina) : 0,
    crash: z >= Z_HEAVY ? 0.0025 * Math.exp(12 * (z - 0.88)) * (1.6 - 1.2 * stamina) : 0,
  };
}
// 平时几点睡 / 几点醒、维持清醒区（黄金时段）
function sleepWindow(clock) {
  const bed = mod24(clock.mid - clock.dur / 2), wake = mod24(clock.mid + clock.dur / 2);
  return { bed, wake, goldenFrom: mod24(bed - 3), goldenTo: mod24(bed - 0.5) };
}
const inRange = (h, a, b) => mod24(h - a) < mod24(b - a);
// 往前推，几点压力到 z0（醒着一直不睡的话）。找不到返回 0
function etaTo(z0, t0, sWakeAt, wokeAt, clock, tz, maxH = 20) {
  for (let m = 0; m <= maxH * 60; m += 5) {
    const t = t0 + m * 60000; const Z = pressure(sAwake(sWakeAt, (t - wokeAt) / H), circ(hourOf(t, tz), clock));
    if (Z >= z0) return t;
  }
  return 0;
}

module.exports = { H, mod24, cdiff, hourOf, fmt, rollTraits, detectSleeps, partnerClock, entrain, syncScore, sAwake, sAsleep, circ, pressure, stageOf, hazards, sleepWindow, inRange, etaTo, TAU_R, TAU_D, AMP, Z_DROWSY, Z_HEAVY, Z_NOD };
