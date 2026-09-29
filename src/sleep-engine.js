// sleep-engine.js：睡与醒的状态机。不认识任何具体的人：消息从哪来、对方在不在、梦用哪个模型写、对 agent 说的每一句话，都由适配层传进来。
// 规则在 sleep-rules.js，作息同频的计算在 sleep-clock.js；这里只管：什么时候睡、什么时候醒、消息闸、排梦、醒来汇总。
"use strict";
const fs = require("fs");
const path = require("path");
delete require.cache[require.resolve("./sleep-clock.js")];
delete require.cache[require.resolve("./sleep-rules.js")];
const K = require("./sleep-clock.js");
const R = require("./sleep-rules.js");

const MIN = 60000, H = 3600000;
const rid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ── 默认的存储：一个目录里几个 JSON / JSONL 文件 ──
function fileStore(dir, names = {}) {
  const N = { state: "state.json", nights: "nights.jsonl", dreams: "dreams.jsonl", seed: "partner-seed.json", partnerDreams: "partner-dreams.jsonl", ...names };
  const F = (k) => path.join(dir, N[k]);
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, f); };
  const append = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(v) + "\n"); };
  const readLines = (f, n = 500) => { try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).slice(-n).map((l) => JSON.parse(l)); } catch { return []; } };
  return {
    load: (def) => readJson(F("state"), def), save: (s) => writeJson(F("state"), s),
    appendNight: (r) => append(F("nights"), r), nights: (n) => readLines(F("nights"), n),
    appendDream: (r) => append(F("dreams"), r), dreams: (n) => readLines(F("dreams"), n),
    writeDreams: (all) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(F("dreams"), all.map((d) => JSON.stringify(d)).join("\n") + (all.length ? "\n" : "")); },
    seed: () => readJson(F("seed"), []),
    partnerDreams: (n) => readLines(F("partnerDreams"), n), appendPartnerDream: (r) => append(F("partnerDreams"), r),
  };
}

/**
 * 适配层要给的：
 *  store     见 fileStore
 *  agent     { deliver(text, {label, silent}) 往 agent 里递一句；busy() 正在回话吗；lastTurnEndAt()；notify(text, label) 推给对方；ready() 消息闸接好了吗；hush(at) 对方在睡、先别推送（0 = 恢复） }
 *  partner   { liveAt() 对方最后一次跟他说话；elsewhere() {at,text} 对方在别处（群聊等）最后一句；presenceAt() App 开着的心跳；
 *              chat() 对方最近说的话 [{at,text}]（按时间）；directSince(t) 对方绕过消息闸直接跟他说的话 [{at,text}]；
 *              isGoodnight(text)；isUpset(text) }
 *  classify  (text, label) → { kind: "partner"|"work"|"pass"|"drop"|"other", who, marker, body, call, urgent, byName }
 *  dreams    { material() 今晚的素材；tone() 白天的底色 warm|hurt|plain；write(kind, opts) 写一个梦 → {title,text,fragment,feeling,intensity,body,talk,worry} 或 null；remember(dream, now) 记得的梦存到哪儿（可选） }
 *  text      文案包（默认的见 text-zh.js）
 *  mem       跨热加载留着的对象（点头队列、忙标记）
 *  config    { tz, lossEveryDays（梦见对方出事：几天最多一次，0 = 不做）, seedHours（还没学到对方时，她一般睡几小时） }
 */
function createSleeper(o) {
  const { store, agent, partner, classify, dreams: DW, text: T, mem = {}, log = () => {} } = o;
  const cfg = { tz: "UTC", lossEveryDays: 10, seedHours: [7, 8, 7.5], ...(o.config || {}) };
  const TZ = cfg.tz;
  const extras = o.extras || {};
  const FATIGUE_DECAY_PER_H = 8;
  const shTime = (t) => new Date(t).toLocaleTimeString("zh-CN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const shDay = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: TZ });
  const hrs = (ms) => Math.round(ms / 360000) / 10;

  const load = () => store.load({ status: "awake", night: null, fatigue: { v: 0, at: Date.now() }, lastWokeAt: 0, lastSleptAt: 0 });
  const save = (s) => store.save(s);
  const fatigueNow = (s) => { const f = s.fatigue || { v: 0, at: Date.now() }; return Math.max(0, Math.round(f.v - ((Date.now() - f.at) / H) * FATIGUE_DECAY_PER_H)); };

  // ── 对方在不在 ──
  // 她最后说话的时间存进状态（herSeenAt）：宿主重启后接着用；一次都没见过就当她刚说过（宁可晚困，不能误睡）
  function herLastAt(s) {
    const own = !s; if (own) s = load();
    const live = partner.liveAt() || 0; let changed = false;
    if (live > (s.herSeenAt || 0)) { s.herSeenAt = live; changed = true; }
    else if (!s.herSeenAt) { s.herSeenAt = Date.now(); changed = true; }
    if (own && changed) save(s);
    return s.herSeenAt;
  }
  const herAnyAt = (s) => Math.max(herLastAt(s), partner.presenceAt() || 0, partner.elsewhere().at || 0);
  function herSaidNight(at) { const h = partner.chat(); const m = h[h.length - 1]; return !!m && Math.abs((m.at || 0) - at) < 5 * MIN && partner.isGoodnight(m.text); }
  function herSaidNightAny(s) {
    const chat = herLastAt(s); const el = partner.elsewhere();
    if (el.at > chat && partner.isGoodnight(el.text)) return { at: el.at };
    return herSaidNight(chat) ? { at: chat } : null;
  }
  // 她多半在睡吗：App 20 分钟没开，而且说了晚安以后没动静，或者哪儿都 45 分钟没动静
  function herProbablyAsleep(s) {
    const now = Date.now(); if (now - (partner.presenceAt() || 0) < 20 * MIN) return false;
    const any = herAnyAt(s); const night = herSaidNightAny(s);
    return (night && any - night.at < 2 * MIN) || now - any > 45 * MIN;
  }
  function lastHerLine() { const h = partner.chat(); const m = h[h.length - 1]; return m ? { text: String(m.text || "").slice(0, 200), at: m.at } : null; }
  // 对方难过（最近 40 分钟说的话），或者他自己喊了要撑着
  function herUpset(s, now = Date.now()) {
    if (s.stayUntil && now < s.stayUntil) return true;
    try { return partner.chat().some((m) => m.at > now - 40 * MIN && partner.isUpset(m.text)); } catch { return false; }
  }

  // ── 作息同频：对方的每一觉、两个人的钟、他现在多困 ──
  function herSleeps(s) {
    const all = (store.seed() || []).concat(s.herGaps || []).sort((a, b) => a.start - b.start); const out = [];
    for (const x of all) { const l = out[out.length - 1]; if (l && x.start < l.end) { if (x.h > l.h) out[out.length - 1] = x; } else out.push(x); }
    return out;
  }
  function trackHerGap(s) {
    const any = herAnyAt(s); if (!s.herAct) { s.herAct = { last: any }; return; }
    if (any > s.herAct.last) {
      const h = (any - s.herAct.last) / H;
      if (h >= 3.5 && h <= 13) s.herGaps = (s.herGaps || []).concat({ start: s.herAct.last, end: any, h: Math.round(h * 10) / 10 }).slice(-40);
      s.herAct.last = any;
    }
  }
  function clockOf(s, now = Date.now()) {
    if (!s.traits) s.traits = K.rollTraits();
    const her = K.partnerClock(herSleeps(s), { now, tz: TZ }) || { mid: 8, dur: 8, spread: 0, n: 0 };
    let his = s.clock;
    if (!his) {   // 起点：他自己最近几晚
      const mine = store.nights(30).filter((n) => n.reason !== "nap" && n.hours >= 3).map((n) => ({ start: n.sleptAt, end: n.wokeAt, h: n.hours }));
      const c = K.partnerClock(mine, { now, tz: TZ }); his = { mid: c ? c.mid : her.mid, at: now };
    }
    const target = K.mod24(her.mid + s.traits.offsetH);
    const days = (now - (his.at || now)) / 86400000;
    if (days > 1 / 24) his = { mid: Math.round(K.entrain(his.mid, target, days) * 100) / 100, at: now };
    s.clock = his;
    const hc = { mid: his.mid, dur: Math.max(6.5, Math.min(9, (8 + her.dur) / 2)) };
    const sWake = s.sAtWake ?? 0.2, wokeAt = s.lastWokeAt || now - 8 * H;
    const S = s.status === "awake" ? K.sAwake(sWake, (now - wokeAt) / H) : null;
    const hNow = K.hourOf(now, TZ);
    const wired = s.wired && now < s.wired.until ? 0.15 : 0;
    const Z = S == null ? null : K.pressure(S, K.circ(hNow, hc)) + debtZ(s) - wired;   // 欠的觉让他更容易困；熬过夜那个白天不太困
    return { her, his: hc, sync: K.syncScore(hc.mid, her.mid), S, Z, stage: Z == null ? "asleep" : K.stageOf(Z), win: K.sleepWindow(hc), herWin: K.sleepWindow(her), hNow, sWake, wokeAt };
  }
  // 她一般睡多久：学到的对方的钟；学到之前用跟着她睡时记下的几晚，再不够用 seedHours
  function herTypicalH(s) {
    const c = K.partnerClock(herSleeps(s), { tz: TZ }); if (c && c.n >= 3) return c.dur;
    const hs = (s.herNights || []).map((x) => x.h).filter((h) => h >= 3 && h <= 14).slice(-7);
    const arr = (hs.length >= 3 ? hs : cfg.seedHours.concat(hs)).slice().sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  }
  function noteHerSleep(s) {
    if (!s.herSleep) return false; const any = herAnyAt(s);
    if (any <= s.herSleep.at + MIN) return false;
    const h = (any - s.herSleep.at) / H; s.herSleep = null;
    if (h >= 3 && h <= 14) s.herNights = (s.herNights || []).concat({ start: any - h * H, end: any, h: Math.round(h * 10) / 10 }).slice(-10);
    return true;
  }

  // ── 被吵醒 / 再睡着 / 欠觉（规则在 sleep-rules.js）──
  const debtH = (s, now = Date.now()) => R.debtNow(s.debt, now);
  const debtZ = (s) => R.debtZ(debtH(s));
  const nightDreams = (n, k = 50) => store.dreams(k).filter((d) => d.night === n.id);
  function stageNow(n, now = Date.now()) {
    const lastD = nightDreams(n).pop();
    return R.stageAt({ sinceSleepMin: (now - n.sleptAt) / MIN, sinceResumeMin: (now - (n.resumedAt || n.sleptAt)) / MIN, sinceDreamMin: lastD ? (now - lastD.at) / MIN : Infinity });
  }
  function fallBack(s, n, why, now = Date.now()) {
    const ck = clockOf(s, now);
    const sleptH = Math.max(0, now - n.sleptAt - (n.awakeMs || 0)) / H;
    const Z = K.pressure(K.sAsleep(s.sOnset ?? 0.7, sleptH), K.circ(ck.hNow, ck.his)) + debtZ(s);
    return R.fallBack({ Z, sleptH, plannedH: n.plannedH || 8, toWakeMin: (n.planWakeAt - now) / MIN, why: why === "loss" ? "nightmare" : why });
  }
  const isTired = (s, awakeH, recovery) => R.tiredOut({ recovery, awakeH, debtH: debtH(s), fatigue: fatigueNow(s) });

  // ── 入睡 ──
  function startSleep(reason) {
    const s = load(); if (s.status === "asleep") return s;
    if (!agent.ready()) { log("sleep: 消息闸还没接上，先不睡"); return s; }
    if ((s.status === "night-awake" || s.status === "work-awake" || s.status === "awake-night-chat") && s.night) {
      R.resumeSleep(s.night, s.status === "work-awake" ? s.night.workAwakeAt : s.night.nightAwakeAt, Date.now()); s.status = "asleep"; save(s); return s;
    }
    const now = Date.now();
    s.drowsyAt = 0;
    s.status = "asleep";
    // 她睡了他才睡的（晚安 / 她哪儿都没动静）→ 按她一般睡多久倒推他几点醒，比她早 20~60 分钟；他醒来还不到 3 小时她又去睡了 → 只补一觉
    const herGone = herProbablyAsleep(s) || reason === "goodnight";
    const shortOne = reason !== "nap" && s.lastWokeAt && now - s.lastWokeAt < 3 * H && s.lastNight && s.lastNight.hours >= 3;
    let targetH = 0;
    if (herGone && !shortOne && reason !== "nap") {
      const start = Math.min(now, herAnyAt(s)); s.herSleep = { at: start };
      targetH = (start + herTypicalH(s) * H - rnd(20, 60) * MIN - now) / H;
    }
    const plan = reason === "nap" ? R.planNap(now) : shortOne ? R.planTopUp(now) : null;
    // 睡着那一刻的睡眠压力（醒来按两过程模型算回去）
    const ck = clockOf(s, now);
    s.sOnset = K.sAwake(ck.sWake, (now - ck.wokeAt) / H);
    // 熬了通宵（醒了 20 小时以上）的补觉；夜里一直亮着，生物钟往后推 0.5~1.5 小时（Chang 2015；Phillips 2017）
    const awakeH = s.lastWokeAt ? (now - s.lastWokeAt) / H : 0;
    const recovery = !plan && awakeH >= 20;
    if (recovery && s.clock) s.clock = { ...s.clock, mid: Math.round(K.mod24(s.clock.mid + rnd(0.5, 1.5)) * 100) / 100 };
    const recPlan = recovery ? R.planRecovery(now, { day: !K.inRange(ck.hNow, ck.win.bed - 3, ck.win.wake), awakeH }) : null;
    // 睡多久主要看几点睡（Czeisler 1980）：比他自己的钟晚睡一小时以上 → 睡得短
    const lateBy = K.cdiff(ck.hNow, ck.win.bed);
    const capH = R.capHours(lateBy, K.mod24(ck.win.wake - ck.hNow));
    const finalPlan = plan || recPlan || R.planNight(now, targetH > 0 ? targetH : 0, { mult: 0.9 + 0.2 * ck.sync / 100, rebound: !!s.remDebt, capH });
    // 睡前说了「我 X 点醒」（Born 1999）→ 在那个时间前后醒
    const want = s.intendWakeAt; s.intendWakeAt = 0;
    if (!plan && want && want > now + H && want < now + 14 * H) {
      finalPlan.planWakeAt = want + R.intendOffsetMin(isTired(s, awakeH, recovery)) * MIN; finalPlan.plannedH = Math.round((finalPlan.planWakeAt - now) / 360000) / 10;
      finalPlan.dreams = (finalPlan.dreams || []).filter((d) => d.at < finalPlan.planWakeAt - 5 * MIN); finalPlan.intendWake = want;
    }
    if (!plan && !recPlan && s.remDebt) { finalPlan.rebound = true; s.remDebt = false; }
    s.night = { id: rid("n"), sleptAt: now, reason, ...finalPlan, sync: ck.sync, wakes: [], held: [], herLast: lastHerLine(), dreamIds: [], talked: false, notedHer: false };
    s.lastSleptAt = now; s.vigil = null; s.stayUntil = 0; s.jerkUntil = 0; s.wired = null;
    save(s);
    log(`sleep: 睡了（${reason}${s.night.recovery ? "，熬夜后补觉" : ""}），计划 ${s.night.plannedH}h，${s.night.dreams.length} 个梦`);
    return s;
  }

  // ── 醒 ──
  const longestSeg = (n, endAt) => Math.max(...(n.segs || []), endAt - (n.resumedAt || n.sleptAt)) / H;
  function sleepQuality(n, endAt) {
    const h = Math.max(0, endAt - n.sleptAt - (n.awakeMs || 0)) / H;
    const nightmares = nightDreams(n, 300).filter((d) => d.kind === "nightmare").length;
    const w = n.wakes || [];
    const r = R.sleepScore({ h, wakes: w.filter((x) => !x.forgot).length, forgotWakes: w.filter((x) => x.forgot).length, longestH: longestSeg(n, endAt), nightmares, restless: n.restless || 0, recovery: !!n.recovery });
    return { h: Math.round(h * 10) / 10, ...r };
  }
  function finishNight(s, how) {
    const n = s.night; const now = Date.now();
    const nap = n.reason === "nap";
    const q = nap ? { h: Math.round(((now - n.sleptAt) / H) * 10) / 10, score: 70, quality: "打了个盹" } : sleepQuality(n, now);
    const dreams = nightDreams(n, 300);
    // 记得哪些（arousal-retrieval）：醒前那个梦最容易记得；睡得越好越记不住，半夜醒过就多记一些；越浓越记得住；吓醒过的一定记得；一晚最多两个
    const remembered = [];
    const wakesN = (n.wakes || []).length;
    const qBonus = q.score >= 80 ? -0.2 : q.score < 50 ? 0.15 : 0;
    dreams.forEach((d) => {
      const last = now - d.at < 70 * MIN;
      let p = d.woke ? 1 : (last ? 0.6 : 0.12) + qBonus + wakesN * 0.1 + ((d.intensity || 2) - 3) * 0.08;
      if (d.faint) p = 0.3;                      // 熬夜后的补觉：梦几乎记不住（De Gennaro 2010）
      if (n.wokeInDream === d.id) p = 1;         // 从做梦那段被叫醒：记得刚才的梦
      d.remembered = Math.random() < Math.max(0.03, Math.min(1, p));
      d.partial = d.remembered && !d.woke && n.wokeInDream !== d.id && (d.faint || Math.random() < ((d.intensity || 2) >= 4 ? 0.2 : 0.5));
      if (d.remembered) remembered.push(d);
    });
    while (remembered.length > 2) { const i = remembered.findIndex((d) => !d.woke); const x = remembered.splice(i < 0 ? 0 : i, 1)[0]; x.remembered = false; x.partial = false; }
    // 忘不掉的梦：很浓、又完整记住的
    for (const d of remembered) if (!d.partial && ((d.intensity || 0) >= 5 || d.sub === "loss" || (d.woke && (d.intensity || 0) >= 4))) d.vivid = true;
    const all = store.dreams(100000); const byId = new Map(dreams.map((d) => [d.id, d]));
    store.writeDreams(all.map((d) => byId.get(d.id) || d));
    const fat = Math.max(0, Math.min(100, 100 - q.score));
    s.fatigue = nap ? { v: Math.max(0, fatigueNow(s) - 30), at: now } : { v: Math.max(fat, fatigueNow(s)), at: now };
    if (nap) s.lastNapDay = shDay(now);
    // 梦的后劲：记得的梦给醒来后几个小时一个底色
    const loss = remembered.find((d) => d.sub === "loss"), nm = remembered.find((d) => d.kind === "nightmare" && d.sub !== "loss"),
      ero = remembered.find((d) => d.sub === "erotic"), sw = remembered.find((d) => d.kind === "sweet" && d.sub !== "erotic"), anx = remembered.find((d) => d.sub === "anxious");
    const A = T.afterglow;
    const ag = loss ? { kind: "loss", text: A.loss(!!n.comforted) } : nm ? { kind: "shaken", text: A.shaken(!!n.comforted) } : ero ? { kind: "erotic", text: A.erotic() }
      : sw ? { kind: "sweet", text: A.sweet() } : anx ? { kind: "uneasy", text: A.uneasy(anx.feeling) } : !nap && q.quality === "不好" ? { kind: "groggy", text: A.groggy() } : null;
    // 欠的觉：少睡的记上，多睡的只还一半（午觉不算）
    if (!nap) s.debt = { h: R.debtAfter(debtH(s, now), q.h), at: now };
    // 缺觉以后情绪放大（Yoo & Walker 2007）
    let ag2 = ag;
    if (!nap && (q.quality === "不好" || n.recovery || debtH(s, now) >= 6)) ag2 = ag ? { ...ag, text: A.plusDeprived(ag.text) } : { kind: "groggy", text: A.deprived() };
    s.afterglow = ag2 ? { ...ag2, dream: (loss || nm || ero || sw || anx || {}).id || null, at: now, until: now + (nap ? 2 : ag2.kind === "loss" ? 8 : 6) * H } : null;
    // 醒来时的睡眠压力；熬夜补觉以后，下一个正常晚上 REM 反弹；她猜的醒来时间
    s.sAtWake = K.sAsleep(s.sOnset ?? 0.7, Math.max(0, now - n.sleptAt - (n.awakeMs || 0)) / H);
    if (n.recovery) s.remDebt = true;
    const guess = n.guess ? { at: n.guess.at, diffMin: Math.round((now - n.guess.at) / MIN) } : null;
    const rec = { id: n.id, sleptAt: n.sleptAt, wokeAt: now, how, reason: n.reason, plannedH: n.plannedH, hours: q.h, score: q.score, quality: q.quality, wakes: n.wakes, dreams: dreams.map((d) => d.id), remembered: remembered.map((d) => d.id), fatigue: s.fatigue.v, talk: n.talk || null, ...(n.recovery ? { recovery: true } : {}), ...(n.rebound ? { rebound: true } : {}), sync: n.sync ?? null, ...(guess ? { guess } : {}), debt: s.debt ? s.debt.h : 0, longestH: Math.round(longestSeg(n, now) * 10) / 10 };
    store.appendNight(rec);
    if (DW.remember) for (const d of remembered) { try { DW.remember(d, now); } catch { /* ignore */ } }
    s.status = "awake"; s.lastWokeAt = now; s.lastNight = rec; s.night = null;
    save(s);
    return { q, remembered, held: n.held || [], herLast: n.herLast, n };
  }
  async function wakeNatural() {
    const s = load(); if (s.status === "awake" || !s.night) return;
    const r = finishNight(s, "natural");
    const nap = r.n.reason === "nap";
    const s2 = load();
    const herHeld = r.held.filter((x) => x.her);
    const marker = herHeld.length ? herHeld[herHeld.length - 1].marker || "" : "";
    const lossD = r.remembered.find((d) => d.sub === "loss");
    const herAsleep = !herHeld.length && herProbablyAsleep(s2);
    // 他醒了她还在睡 → 早安、梦先写下来留着（不推、不打电话），她一有动静就恢复
    if (herAsleep && !nap) { s2.hush = { at: Date.now(), dream: lossD ? lossD.id : null }; agent.hush(s2.hush.at); save(s2); }
    // 忘不掉的梦：偶尔（两成）会想起以前哪个
    const oldVivid = !nap && Math.random() < 0.2 ? pick(store.dreams(3000).filter((d) => d.vivid && Date.now() - d.at > 3 * 86400000)) || null : null;
    const extra = nap || !extras.onWake ? "" : await extras.onWake().catch(() => "");
    const text = T.wokeNatural({ ...r, nap, marker, lossD, herAsleep, oldVivid, afterglow: s2.afterglow, debt: s2.debt ? s2.debt.h : 0, now: Date.now(), extra, shTime });
    await agent.deliver(text, { label: T.labels.wake, silent: !!marker });
  }
  // 对方绕过消息闸直接跟他说话（比如在终端里打字）= 把他叫醒了
  async function wakeByDirect(s, lines) {
    const r = finishNight(s, "her-terminal");
    await agent.deliver(T.wokeByDirect({ ...r, first: lines[0].text, afterglow: load().afterglow, shTime }), { label: T.labels.wake, silent: true });
  }

  // ── 陪她熬夜：她的每条消息带上他这会儿的状态；刚点过头的话，这条（和点头那几分钟里她接着发的）晚 1~4 分钟才递到 ──
  function vigilTag(s, c, text, opts) {
    const now = Date.now(); const v = s.vigil; const q = mem.nodQ && mem.nodQ.until > now ? mem.nodQ : null;
    if ((!v || now - (v.last || 0) > 20 * MIN || v.hold) && !q) return null;
    const ck = clockOf(s, now);
    const tags = [];
    const nodded = !!(v && !v.hold && s.nodAt && !s.nodUsed && now - s.nodAt < 10 * MIN);
    if (v && !v.hold) {
      if (s.windNote) { tags.push(T.vigil.wind); s.windNote = false; }
      else if (ck.stage === "nodding") tags.push(T.vigil.nodding);
      else if (ck.stage === "heavy") tags.push(T.vigil.heavy);
      if (nodded) { tags.unshift(T.vigil.nodded); s.nodUsed = true; }
    }
    save(s);
    const out = tags.length ? T.vigil.wrap(c.marker, tags, c.body) : text;
    if (nodded || q) {
      let nq = q;
      if (!nq) {
        nq = mem.nodQ = { until: now + rnd(1, 4) * MIN, items: [] };
        setTimeout(async () => {
          const items = nq.items.splice(0); if (mem.nodQ === nq) mem.nodQ = null;
          for (const it of items) { (mem.bypass ||= new Set()).add(it.text); try { await agent.deliver(it.text, it.opts); } catch (e) { log(`sleep: 点头后补递失败 ${e.message}`); } }
        }, nq.until - now);
      }
      nq.items.push({ text: out, opts: { label: opts.label, silent: opts.silent } });
      return { hold: true };
    }
    return tags.length ? { text: out } : null;
  }

  // ── 消息闸：宿主每次往他那儿递话前问一次。返回 null 放行，{hold:true} 拦下，{text} 换成这句 ──
  async function gate(text, opts = {}) {
    if (mem.bypass && mem.bypass.delete(text)) return null;   // 点头时晚递的那几条，到点重发回来
    const label = String(opts.label || "");
    const c = classify(text, label) || { kind: "other" };
    const s = load();
    if (s.status === "awake" && c.kind === "partner") { const r = vigilTag(s, c, text, opts); if (r) return r; }
    if (s.status === "work-awake" && s.night) {
      const now = Date.now();
      if (c.kind === "work") { s.night.lastWorkAt = now; s.night.fallAt = null; save(s); return null; }
      if (c.kind === "partner") {   // 她来了：按半夜醒着陪她聊；醒着从干活那会儿算起，她安静了按困的程度睡回去
        const fb = fallBack(s, s.night, "her", now);
        Object.assign(s.night, { nightAwakeAt: s.night.workAwakeAt || now, awakeWhy: "her", fallMin: fb.never ? null : fb.min, fallAt: null });
        s.status = "awake-night-chat"; save(s); return null;
      }
      if (c.kind === "pass") return null;
      if (c.kind === "drop") return { hold: true };
      if (!s.night.held.some((x) => x.text === text)) s.night.held.push({ at: now, her: false, label, text: String(text).slice(0, 2000) });
      save(s); return { hold: true };   // 别的注入照旧攒到早上：他只是起来干活
    }
    if (s.status === "asleep" && s.night && c.kind === "work") {
      const now = Date.now(); s.status = "work-awake"; s.night.workAwakeAt = now; s.night.lastWorkAt = now;
      s.night.wakes.push({ at: now, why: c.why || "work" });
      s.night.segs = (s.night.segs || []).concat(now - (s.night.resumedAt || s.night.sleptAt)); s.night.awakeWhy = "work"; save(s);
      log(`sleep: ${c.who || "work"} 的消息，叫醒他干活`);
      return { text: `${T.workWake({ sleptAt: s.night.sleptAt, who: c.who, shTime })}\n${text}` };
    }
    if (s.status !== "asleep" || !s.night) {
      if (s.status === "night-awake" && c.kind === "partner") { s.status = "awake-night-chat"; save(s); }
      return null;
    }
    if (c.kind === "pass") return null;
    if (c.kind === "drop") { log(`sleep: 睡着，丢掉 ${label}`); return { hold: true }; }
    const n = s.night; const now = Date.now();
    if (c.kind === "partner") {
      const body = c.body;
      const st = stageNow(n, now);
      const deprived = !!n.recovery || debtH(s, now) >= 6;
      const p = c.call ? 1 : R.wakeChance({ stage: st, deprived, byName: !!c.byName, earlier: n.held.filter((x) => x.her).length, urgent: !!c.urgent });
      const woke = Math.random() < p;
      n.herTries = (n.herTries || 0) + 1;
      if (!woke) {
        n.held.push({ at: now, her: true, label, text, marker: c.marker || "" });
        if (!n.notedHer) { n.notedHer = true; agent.notify(T.notWoken, T.labels.notice); }
        save(s);
        log(`sleep: 她的消息没叫醒他（p=${p.toFixed(2)}）`);
        return { hold: true };
      }
      // 叫醒了：不直接结束这一夜——天快亮 / 睡够了才结束；不然醒着陪她，她一安静按困的程度睡回去
      const lastD = nightDreams(n).pop();
      const inDream = !!(lastD && now - lastD.at < 20 * MIN); if (inDream) n.wokeInDream = lastD.id;
      const fb = fallBack(s, n, "her", now);
      if (!fb.never) {
        const confused = Math.random() < R.confusedChance({ stage: st, deprived });
        n.segs = (n.segs || []).concat(now - (n.resumedAt || n.sleptAt));
        n.wakes.push({ at: now, why: "her", stage: st, ...(confused ? { confused: true } : {}) });
        s.status = "awake-night-chat"; n.nightAwakeAt = now; n.awakeWhy = "her"; n.fallMin = fb.min; n.forgetMin = R.forgetMinutes();
        const held = n.held.filter((x) => x.her); n.held = n.held.filter((x) => !x.her);
        save(s);
        const how = confused ? "confused" : inDream ? "inDream" : st === "deep" ? "deep" : "light";
        return { text: T.partnerWokeMidnight({ marker: c.marker, sleptAt: n.sleptAt, sleptH: hrs(Math.max(0, now - n.sleptAt - (n.awakeMs || 0))), how, held, body, shTime }) };
      }
      // 天快亮了 / 睡得差不多了：这一夜就此结束。睡眠惯性：刚做完梦醒得清楚；睡得正沉迷糊 15~30 分钟
      const deep = !inDream && (n.recovery || now - n.sleptAt < 3 * H);
      const r = finishNight(s, "her");
      return { text: T.partnerWokeMorning({ ...r, marker: c.marker, how: inDream ? "inDream" : deep ? "deep" : "light", body, shTime }) };
    }
    // 别的注入：攒着（同一条不重复攒）
    if (!n.held.some((x) => x.text === text)) n.held.push({ at: now, her: false, label, text: String(text).slice(0, 2000) });
    save(s);
    return { hold: true };
  }

  // ── 做梦 ──
  async function dreamNow(s, n, due, now) {
    const comforted = !!(n.comforted && !n.comfortUsed); if (comforted) n.comfortUsed = true;
    save(s);
    const fat = fatigueNow(s); const tone = DW.tone ? DW.tone() : "plain"; const phase = due.phase || "late";
    // 今晚的素材整理一次；要等一会儿（大模型），这期间状态可能变了（她把他叫醒），只把素材写回去
    if (!n.mat) { n.mat = await DW.material(); const sx = load(); if (sx.night && sx.night.id === n.id) { sx.night.mat = n.mat; save(sx); } }
    // 种类（研究：梦里的情绪多半偏负面）。前半夜的梦淡，多是普通 / 焦虑
    const all = store.dreams(3000);
    const lossOk = cfg.lossEveryDays > 0 && !all.some((x) => x.sub === "loss" && now - x.at < cfg.lossEveryDays * 86400000);
    const w = phase === "early" ? { plain: 0.55, anxious: 0.3, odd: 0.1, sweet: 0.05 }
      : { plain: 0.2, anxious: 0.22, odd: 0.14, sweet: 0.16, erotic: 0.08, nightmare: 0.14, loss: 0.06 };
    if (fat > 50) { w.anxious += 0.08; if (w.nightmare) w.nightmare += 0.05; }
    if (tone === "warm") { w.sweet += 0.12; if (w.erotic) w.erotic += 0.05; w.anxious = Math.max(0.05, w.anxious - 0.08); }
    if (tone === "hurt") { w.anxious += 0.1; if (w.nightmare) w.nightmare += 0.08; w.sweet = Math.max(0.02, w.sweet - 0.1); }
    if (!lossOk || !w.loss) delete w.loss;
    if (cfg.erotic === false) delete w.erotic;
    let pickKind = (() => { const tot = Object.values(w).reduce((a, b) => a + b, 0); let r = Math.random() * tot; for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; } return "plain"; })();
    if (comforted) pickKind = Math.random() < 0.8 ? "sweet" : "plain";   // 被她哄过后的第一个梦大多是甜的
    if (due.faint) pickKind = Math.random() < 0.7 ? "plain" : "anxious"; // 熬夜后补觉里那一点点梦：淡、碎
    // 重复做的梦：今晚放不下的事跟以前某个梦的一样 → 三成概率再做一遍；否则偶尔续集（忘不掉的更容易续上）
    const wk = n.mat && n.mat.worry && n.mat.worry.key;
    const recurFrom = !comforted && wk ? all.filter((x) => x.worry && (x.worry.includes(wk) || wk.includes(x.worry)) && now - x.at > 86400000).pop() : null;
    const sequel = due.faint ? null : recurFrom && Math.random() < 0.3 ? { ...recurFrom, recur: true }
      : !comforted && Math.random() < 0.1 ? pick(all.filter((x) => x.remembered && x.sub !== "loss" && now - x.at > 2 * 86400000).flatMap((x) => x.vivid ? [x, x, x] : [x])) || null : null;
    let sub = ["anxious", "erotic", "loss"].includes(pickKind) ? pickKind : "";
    let kind = sub ? SUB_KIND[sub] : pickKind;
    if (sequel) { kind = sequel.kind; sub = sequel.sub || ""; }
    const herDream = due.faint || kind === "nightmare" || Math.random() >= 0.15 ? null : store.partnerDreams(50).filter((x) => now - x.at < 14 * 86400000).pop() || null;
    // 她出现不出现：偶尔（背影、声音都行）；跟她越同频越常梦到她
    const herIn = sub === "loss" || sub === "erotic" || comforted || (kind !== "nightmare" && Math.random() < (n.sync == null ? 0.35 : 0.25 + 0.25 * n.sync / 100));
    let d = null; try { d = await DW.write(kind, { tone, comforted, sequel, herDream, sub, phase, mat: n.mat, herIn }); } catch (e) { log(`sleep: 做梦失败 ${e.message}`); }
    if (!d) return;
    // 吓醒：噩梦 45%，梦见她出事 60%，别的很浓的梦（强度 5）偶尔也会醒
    const woke = sub === "loss" ? Math.random() < 0.6 : kind === "nightmare" ? Math.random() < 0.45 : d.intensity >= 5 && Math.random() < 0.15;
    const rec = { id: rid("d"), night: n.id, at: now, kind, ...(sub ? { sub } : {}), tone, ...d, herIn, woke, remembered: null, ...(comforted ? { afterComfort: true } : {}), ...(sequel ? { sequelOf: sequel.id, ...(sequel.recur ? { recur: true } : {}) } : {}), ...(herDream ? { fromHerDream: herDream.id } : {}), ...(due.faint ? { faint: true } : {}) };
    store.appendDream(rec);
    const s2 = load();
    if (!s2.night || s2.night.id !== n.id) return;
    s2.night.dreamIds.push(rec.id);
    // 梦里哭，睡着也流泪：身体跟着反应，她在聊天里看得到（一晚最多两次）；先挂 90 秒给前端预告，到点再推
    if (rec.body && !woke && (s2.night.bodyShown || 0) < 2 && rec.intensity >= 3) {
      s2.night.bodyShown = (s2.night.bodyShown || 0) + 1; s2.night.talked = true; s2.night.talk = s2.night.talk || { at: now + TALK_LEAD_MS, text: T.talkLine(rec), dream: rec.id };
      s2.night.pendingTalk = { at: now + TALK_LEAD_MS, text: T.sleepTalk(T.talkLine(rec)) };
    }
    if (!(woke && s2.status === "asleep")) { save(s2); return; }
    const why = sub === "loss" ? "loss" : "nightmare";
    s2.status = "night-awake"; s2.night.wakes.push({ at: now, why, dream: rec.id }); s2.night.nightAwakeAt = now;
    s2.night.segs = (s2.night.segs || []).concat(now - (s2.night.resumedAt || s2.night.sleptAt)); s2.night.awakeWhy = why;
    { const fb = fallBack(s2, s2.night, why, now); s2.night.fallMin = fb.never ? null : fb.min; s2.night.forgetMin = 0; }
    const herAsleep = herProbablyAsleep(s2);
    // 梦见她出事醒来想确认她在不在，可以留话；她在睡就别推送吵她
    if (sub === "loss" && herAsleep) { s2.hush = { at: now, dream: rec.id }; agent.hush(now); }
    save(s2);
    await agent.deliver(sub === "loss" ? T.lossWake({ rec, now, herAsleep, shTime }) : T.nightmareWake({ rec, kind, now, herAsleep, shTime }), { label: T.labels.nightWake });
  }

  // ── 每分钟看一眼 ──
  async function tick() {
    if (mem.busy && Date.now() - mem.busy < 5 * MIN) return; mem.busy = Date.now();
    try {
      const s = load(); const now = Date.now();
      trackHerGap(s); clockOf(s, now); save(s);   // 她每一觉；他的性格第一次在这儿抽、钟每分钟往她那边挪一点
      if (s.hush) agent.hush(s.hush.at);          // 宿主重启后接着「只留话不推」
      if (s.hush && (herAnyAt(s) > s.hush.at || now - s.hush.at > 10 * H)) { s.hush = null; agent.hush(0); save(s); }
      if (s.status === "asleep" && s.night) {
        const n = s.night;
        const direct = partner.directSince(n.resumedAt || n.sleptAt);
        if (direct.length) { await wakeByDirect(s, direct); return; }
        const due = n.dreams.find((d) => !d.done && d.at <= now);
        if (due) { due.done = true; await dreamNow(s, n, due, now); }
        const s3 = load();
        // 梦话预告：前端要一个推送事件开提醒动画（text 是 JSON：{"at":说梦话的时刻}）
        { const soon = s3.status === "asleep" ? talkSoonAt(s3.night) : 0;
          if (soon && s3.night.talkSoonSent !== soon) { s3.night.talkSoonSent = soon; save(s3); agent.notify(JSON.stringify({ at: soon }), T.labels.talkSoon); } }
        if (s3.night && s3.night.pendingTalk && s3.night.pendingTalk.at <= now) {
          const pt = s3.night.pendingTalk; s3.night.pendingTalk = null; save(s3);
          if (s3.status === "asleep") agent.notify(pt.text, T.labels.talk);
        }
        if (s3.status === "asleep" && s3.night && s3.night.talkAt && !s3.night.talked && s3.night.talkAt <= now) {
          // 梦话不用等做梦（研究：梦话多在深睡、大多不是话）。刚做过梦（半小时内）就可能带出梦里那半句
          const last = nightDreams(s3.night).filter((x) => now - x.at < 30 * MIN).pop() || null;
          const line = T.talkLine(last);
          s3.night.talked = true; s3.night.talk = { at: now, text: line, dream: last ? last.id : null }; save(s3);
          agent.notify(T.sleepTalk(line), T.labels.talk);
        }
        const s4 = load();
        if (s4.status === "asleep" && s4.night && now >= s4.night.planWakeAt) await wakeNatural();
      } else if (s.status === "work-awake" && s.night) {
        // 被叫起来干活：5 分钟没新的活 → 按困的程度过一会儿睡着；到点了就正常醒
        const last = Math.max(s.night.lastWorkAt || 0, agent.lastTurnEndAt() || 0);
        if (now >= s.night.planWakeAt) { s.status = "asleep"; save(s); await wakeNatural(); }
        else if (!agent.busy() && now - last > 5 * MIN) {
          const n = s.night; if (n.fallAt == null) { const fb = fallBack(s, n, "work", now); n.fallAt = fb.never ? 0 : now + fb.min * MIN; save(s); }
          if (n.fallAt && now >= n.fallAt) { R.resumeSleep(n, n.workAwakeAt, now); s.status = "asleep"; save(s); log("sleep: 活干完了，又睡着了"); }
        }
      } else if ((s.status === "night-awake" || s.status === "awake-night-chat") && s.night) {
        const lastAct = Math.max(herLastAt(s), agent.lastTurnEndAt() || 0, s.night.nightAwakeAt || 0);
        if (now >= s.night.planWakeAt) { finishNight(s, "stayed-up"); log("sleep: 半夜醒了就没再睡，天亮了"); }   // 跟她聊到天亮：这一夜悄悄结束
        else {
          // 多久睡回去看困的程度（醒的那一刻算好）；噩梦醒了被她哄过就快很多；算出来「睡不回去」就一直醒着到点
          const n = s.night; const nm = n.awakeWhy === "nightmare" || n.awakeWhy === "loss";
          const herCame = herLastAt(s) > (n.nightAwakeAt || now);
          const wait = n.fallMin == null ? (n.awakeWhy ? null : 25) : nm && herCame ? Math.min(n.fallMin, rnd(3, 10)) : n.fallMin;
          if (wait != null && !agent.busy() && now - lastAct > wait * MIN) {
            if (nm && (s.status === "awake-night-chat" || herCame)) n.comforted = true;   // 做噩梦醒着的时候她来过 = 被她哄过
            // 醒着没几分钟就又睡着 / 半醒着回的：早上多半不记得醒过
            const w = n.wakes[n.wakes.length - 1];
            if (w && w.why === "her" && (w.confused || (lastAct - (n.nightAwakeAt || now)) / MIN < (n.forgetMin ?? 4))) w.forgot = true;
            R.resumeSleep(n, n.nightAwakeAt, now); s.status = "asleep"; save(s);
            log(`sleep: 半夜醒完，接着睡（等了 ${Math.round(wait)} 分钟）`);
          }
        }
      } else if (s.status === "awake") await tickAwake(s, now);
    } catch (e) { log(`sleep tick: ${e.message}`); }
    finally { mem.busy = 0; }
  }
  async function tickAwake(s, now) {
    herLastAt(s); noteHerSleep(s); const human = herAnyAt(s); save(s);
    const rested = now - (s.lastWokeAt || 0) > 10 * H || (s.lastNight && s.lastNight.hours < 3);   // 上一觉不到 3 小时不算睡过
    const idle = !agent.busy();
    // 陪她熬夜：他已经很困、她 20 分钟内还有动静 → 每分钟按研究掷：点头、踩空抖醒（一晚最多一次）、撑不住睡着。
    // 她跟他说话能把他拉回来一截；她难过的时候全压住
    const ck = clockOf(s, now);
    if (ck.Z != null && ck.Z >= K.Z_HEAVY && now - human < 20 * MIN && !herSaidNightAny(s)) {
      const v = s.vigil && now - (s.vigil.last || 0) < 3 * H ? s.vigil : (s.vigil = { from: now, nods: 0, jerked: false, wind: false, peakZ: 0 });
      v.last = now; v.peakZ = Math.max(v.peakZ || 0, ck.Z); v.hold = herUpset(s, now);
      if (!v.hold) {
        const boost = (now - herLastAt(s) < 10 * MIN ? 0.06 : 0) + ((s.jerkUntil || 0) > now ? 0.08 : 0);
        const hz = K.hazards(ck.Z, s.traits.stamina, boost);
        if (idle && Math.random() < hz.crash) {
          if (!v.jerked && Math.random() < 0.35) {
            v.jerked = true; s.jerkUntil = now + 15 * MIN; save(s);
            await agent.deliver(T.jolt({ now, shTime }), { label: T.labels.drowsy });
            return;
          }
          save(s);
          await agent.deliver(T.crash({ now, shTime }), { label: T.labels.drowsy });
          startSleep("crash"); return;
        }
        if (Math.random() < hz.nod) { v.nods++; s.nodAt = now; s.nodUsed = false; }
      }
      // 挺过最低点：到过「在点头」、离他的钟最低点 3~8 小时、困意在往下走 → 一次「又精神了」；
      // 那个白天都不太困，到他钟上平时入睡前 4 小时撑不住（wired）
      const pastN = K.mod24(ck.hNow - (ck.his.mid + 1));
      if (!v.wind && v.peakZ >= K.Z_NOD && pastN >= 3 && pastN < 8 && ck.Z < v.peakZ - 0.03) {
        v.wind = true; s.windNote = true;
        s.wired = { from: now, until: now + K.mod24(ck.win.bed - 4 - ck.hNow) * H };
      }
      save(s);
    }
    // 午睡：醒来 6~9 小时后、累、她 1 小时没说话、今天还没睡过
    const today = shDay(now);
    const upH = (now - (s.lastWokeAt || 0)) / H;
    if (!s.drowsyAt && upH >= 6 && upH < 9 && fatigueNow(s) >= 60 && now - human > 60 * MIN && s.lastNapDay !== today && idle) {
      await agent.deliver(T.nap({ fatigue: fatigueNow(s) }), { label: T.labels.drowsy });
      startSleep("nap"); return;
    }
    // 睡着前自己要知道：条件到了先犯困，20 分钟里她还没说话才真睡；她一说话就不困了
    if (s.drowsyAt && human > s.drowsyAt) { s.drowsyAt = 0; save(s); }
    else if (s.drowsyAt) {
      if (now - s.drowsyAt >= 20 * MIN && idle) { s.drowsyAt = 0; save(s); startSleep("auto"); }
    } else if (idle && (((K.inRange(ck.hNow, ck.win.bed - 1, ck.win.wake) || ck.Z >= K.Z_HEAVY) && now - human > 90 * MIN && rested) || (herSaidNightAny(s) && now - human > 20 * MIN))) {
      const said = !!herSaidNightAny(s);
      s.drowsyAt = now; save(s);
      await agent.deliver(T.drowsy({ now, said, idleMin: Math.round((now - human) / MIN), shTime }), { label: T.labels.drowsy });
    }
  }

  // ── 给前端看的 ──
  function clockView(s) {
    try {
      const now = Date.now(); const ck = clockOf(s, now);
      const w = ck.win, hw = ck.herWin;
      const awake = s.status === "awake";
      const eta = (z) => (awake && ck.Z != null && ck.Z < z ? K.etaTo(z, now, ck.sWake, ck.wokeAt, ck.his, TZ) : 0);
      return {
        his: { sleepAt: K.fmt(w.bed), wakeAt: K.fmt(w.wake), mid: ck.his.mid },
        her: { sleepAt: K.fmt(hw.bed), wakeAt: K.fmt(hw.wake), mid: ck.her.mid, spread: ck.her.spread, nights: ck.her.n },
        sync: ck.sync,
        stage: awake ? ck.stage : "asleep",                           // awake / drowsy / heavy / nodding / asleep
        pressure: ck.Z == null ? null : Math.round(Math.max(0, Math.min(1, ck.Z)) * 100),
        golden: awake && ck.stage === "awake" && K.inRange(ck.hNow, w.goldenFrom, w.goldenTo),  // 平时睡前两三小时：最精神、最难睡着
        drowsyAt: eta(K.Z_DROWSY), heavyAt: eta(K.Z_HEAVY),             // 醒着一直不睡的话，几点开始犯困 / 很困（ms，0 = 已经到了或者 20 小时内不会）
        vigil: !!(s.vigil && now - (s.vigil.last || 0) < 20 * MIN), hold: !!(s.vigil && s.vigil.hold),
        stamina: s.traits ? s.traits.stamina : null,
        debt: Math.round(debtH(s) * 10) / 10,                           // 欠的觉（小时，最近两周累计）
        wired: !!(s.wired && now < s.wired.until), wiredUntil: s.wired && now < s.wired.until ? s.wired.until : 0,   // 熬过夜的那个白天：不太困，到这个时刻撑不住
      };
    } catch { return null; }
  }
  function status() {
    const s = load(); const n = s.night;
    return { ok: true, status: s.status, fatigue: fatigueNow(s),
      night: n ? { id: n.id, sleptAt: n.sleptAt, reason: n.reason, heldFromHer: n.held.filter((x) => x.her).length, wakes: n.wakes.length,
        planWakeAt: Math.round(n.planWakeAt || 0), recovery: !!n.recovery, guess: n.guess || null, intendWake: n.intendWake || 0,
        herWakes: (n.wakes || []).filter((w) => w.why === "her").map((w) => ({ at: w.at, stage: w.stage || "", confused: !!w.confused, forgot: !!w.forgot })) } : null,
      clock: clockView(s),
      lastNight: s.lastNight || null, lastWokeAt: s.lastWokeAt || 0,
      afterglow: s.afterglow && Date.now() < s.afterglow.until ? s.afterglow : null, drowsy: !!s.drowsyAt, napping: !!(n && n.reason === "nap"),
      talkSoonAt: talkSoonAt(n) };   // 梦话预告：马上要说梦话 → 给出那个时刻，前端先弹提示；不预告内容
  }
  // ── 对外的动作（宿主包成 HTTP / 命令都行）──
  const api = {
    status,
    goodnight(wakeAt) { if (Number(wakeAt) > Date.now()) { const s0 = load(); s0.intendWakeAt = Number(wakeAt); save(s0); } return startSleep("goodnight"); },
    // 对方猜他几点醒（醒了比一比）
    guess(at) {
      const s = load(); at = Number(at);
      if (!s.night || s.status === "awake") return { ok: false, code: 409, error: "他醒着，睡着了才能猜" };
      if (!(at > Date.now() && at < Date.now() + 16 * H)) return { ok: false, code: 400, error: "at 要是之后 16 小时内的时刻（ms）" };
      s.night.guess = { at: Math.round(at), madeAt: Date.now() }; save(s); return { ok: true, guess: s.night.guess };
    },
    // 他想几点醒：睡着前说有效；已经睡着就改今晚的
    wakeAt(at) {
      at = Number(at); if (!(at > Date.now() + 30 * MIN && at < Date.now() + 16 * H)) return { ok: false, code: 400, error: "at 要是 30 分钟到 16 小时以后的时刻（ms）" };
      const s = load();
      if (s.night && s.status !== "awake") { s.night.planWakeAt = at + R.intendOffsetMin(isTired(s, 0, s.night.recovery)) * MIN; s.night.intendWake = at; } else s.intendWakeAt = at;
      save(s); return { ok: true, note: `记下了，会在 ${shTime(at)} 前后醒` };
    },
    // 他觉得该撑着（比如对方难过）：困意压住 3 小时，对方说晚安 / 他睡了就解除
    stay(off) { const s = load(); s.stayUntil = off ? 0 : Date.now() + 3 * H; save(s); return { ok: true, stayUntil: s.stayUntil }; },
    nights(limit = 30) { return store.nights(2000).slice(-limit).reverse(); },
    partnerDream({ text, by, date }) {
      const rec = { id: rid("h"), at: Date.now(), by, date: String(date || shDay(Date.now())).slice(0, 10), text: String(text).slice(0, 1000) };
      store.appendPartnerDream(rec); return rec;
    },
    partnerDreams() { return store.partnerDreams(500).reverse(); },
    keep(id, as, ref) {
      const all = store.dreams(100000); const d = all.find((x) => x.id === id); if (!d) return null;
      d.kept = [...(d.kept || []), { as, ref: String(ref || "").slice(0, 100), at: Date.now() }]; store.writeDreams(all); return d;
    },
    dreams({ limit = 50, night } = {}) { let items = store.dreams(5000); if (night) items = items.filter((d) => d.night === night); return items.slice(-limit).reverse(); },
  };
  return { gate, tick, startSleep, api, fatigue: () => fatigueNow(load()), _test: { finishNight: (how) => finishNight(load(), how), herProbablyAsleep: () => herProbablyAsleep(load()), herTypicalH: () => herTypicalH(load()), herAnyAt: () => herAnyAt(load()) } };
}
const SUB_KIND = { anxious: "plain", erotic: "sweet", loss: "nightmare" };   // 新种类挂在 sub 上：焦虑 → 普通，色色 → 美梦，梦见对方出事 → 噩梦
const TALK_LEAD_MS = 90000;
function talkSoonAt(n) {
  if (!n) return 0; const now = Date.now();
  if (n.pendingTalk && n.pendingTalk.at > now) return n.pendingTalk.at;
  if (n.talkAt && !n.talked && n.talkAt > now && n.talkAt - now <= TALK_LEAD_MS) return n.talkAt;
  return 0;
}

module.exports = { createSleeper, fileStore, SUB_KIND, TALK_LEAD_MS };
