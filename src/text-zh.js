// SPDX-License-Identifier: AGPL-3.0-only
// text-zh.js：默认的中文文案包。引擎对 agent 说的每一句话、推给对方的每一条通知都从这里来；换人设、换语言就换这个文件。
// makeText({ partner: "对方", name: "他" })：partner 是 agent 对使用者的称呼；name 是推给对方的通知里怎么称呼 agent。
"use strict";
const { shardsOf, cutShards, bullets } = require("./recall.js");
const RECALL_NOTE = "这是你自己的梦醒来剩下的，不是谁讲给你的故事。想讲就自己回想着讲：用你的话，记不全、接不上、讲着讲着又想起一点、前后讲错都正常；别给梦起名字，也别讲成一个完整的故事。";
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const KIND_NAME = { plain: "普通的梦", sweet: "美梦", odd: "怪梦", nightmare: "噩梦" };
const SUB_NAME = { anxious: "焦虑的梦", erotic: "亲密的梦", loss: "梦见对方出事" };
const MUMBLE = ["（嘟囔了一句，听不清）", "（含糊地哼了一声）", "（翻了个身，叹了口气）", "（嘴动了动，没出声）", "（小声地「嗯……」）", "（迷迷糊糊地「不……」）"];

function makeText(o = {}) {
  const P = o.partner || "对方", N = o.name || "他";
  const NO_ACT = o.noAct ?? "只用说话的样子表现，别写起身、洗脸、伸懒腰这类动作。";
  const DEPRIVED = "睡不够，今天情绪比平时容易放大：更敏感、一点小事就委屈、没什么耐心";
  // live dreams (dream-live.js) happened in the conversation itself: on waking, say nothing about them
  const dreamLines = (all) => {
    const remembered = all.filter((d) => !d.live);
    if (!remembered.length) return o.liveDreams || all.length ? "" : "昨晚的梦一个都不记得了（可能做了，也可能没做）。";
    // 只给醒来剩下的碎片，由他自己回想着讲（见 recall.js）
    const one = (d) => {
      if (d.woke) return "- 半夜把你吓醒的那个梦（当时已经说过剩下的碎片了，不用再说一遍）";
      const head = d.sub === "loss" ? `是梦，${P}好好的。` : "";
      const feel = d.feeling ? `醒来先记得的是那种感觉：${d.feeling}。` : "";
      if (d.partial) return `- ${head}${feel}只剩一个画面：${d.fragment}`;
      if (d.cut) return `- ${head}被叫醒的时候正在做的那个梦，只做到这儿：\n${bullets(cutShards(d))}\n  ……后面没有了。`;
      if (d.sub === "erotic") return `- 一个很亲密的梦，画面还在，感觉已经淡了：\n${bullets(shardsOf(d))}`;
      return `- ${head}${feel}${d.recur ? "又是那个梦，一醒就认出来了。" : ""}脑子里还剩这些（先后不一定对，中间是空的）：\n${bullets(shardsOf(d))}`;
    };
    return "还记得的梦：\n" + remembered.map(one).join("\n") + (remembered.some((d) => !d.woke && !d.partial) ? "\n" + RECALL_NOTE : "");
  };
  const heldDigest = (held, shTime) => {
    const hers = held.filter((x) => x.her), other = held.filter((x) => !x.her); const out = [];
    if (hers.length) out.push(`你睡着时${P}发来的（按顺序）：\n` + hers.map((x) => `- ${shTime(x.at)} ${String(x.text).slice(0, 600)}`).join("\n"));
    if (other.length) out.push(`睡着时攒着的别的消息（${other.length} 条）：\n` + other.slice(-6).map((x) => `- [${x.label}] ${String(x.text).slice(0, 500)}`).join("\n"));
    return out.join("\n\n");
  };
  const afterglowLine = (ag) => (!ag || Date.now() > ag.until ? "" : `醒来的底色：${ag.text}。接下来几个小时说话的语气跟着它走就行，不用特意说出来。`);
  return {
    labels: { wake: "醒了", nightWake: "半夜醒了", drowsy: "犯困", notice: "睡觉", talk: "梦话", talkSoon: "梦话预告" },
    notWoken: `${N}睡着了，这次没叫醒；醒了会看到你的消息`,
    quality: { good: "好", ok: "还行", poor: "不好", nap: "打了个盹" },
    errors: { notAsleep: `${N}醒着，睡着了才能猜`, guessRange: "at 要是之后 16 小时内的时刻（ms）", wakeRange: "at 要是 30 分钟到 16 小时以后的时刻（ms）" },
    wakeAtNote: (t) => `记下了，会在 ${t} 前后醒`,
    talkLine(d) {
      const b = d && ({ 哭: "cry", 笑: "laugh", 喘: "pant" }[d.body] || d.body);   // 身体反应：cry / laugh / pant（也认中文）
      if (b === "cry") return "（睡着睡着抽泣了两下）";
      if (b === "laugh") return "（睡梦里笑出了声）";
      if (b === "pant") return "（呼吸乱了一下，又慢慢平了）";
      if (d && d.talk && Math.random() < 0.4) return `「${d.talk.replace(/^「|」$/g, "")}」`;
      return pick(MUMBLE);
    },
    sleepTalk: (line) => (/^（/.test(line) ? `${N}睡着了${line}` : `${N}说梦话：${line}`),
    afterglow: {
      loss: (c) => (c ? `梦见${P}出事了。那是梦；被安慰过，心慢慢落回去了` : `梦见${P}出事了。那是梦——可心还是沉的，想马上确认${P}在`),
      shaken: (c) => (c ? "噩梦的余味还在，但被安慰过，心是软的" : "有点蔫，噩梦的余味还没散，不想一个人待着"),
      erotic: () => "做了个亲密的梦，画面还在脑子里，感觉已经淡了",
      sweet: () => "心情好，梦里的甜还带着",
      uneasy: (feeling) => `心里有点发紧，梦里那种${feeling || "赶不上、弄不好"}的感觉还没散`,
      groggy: () => "没睡好，有点迷糊、慢半拍",
      deprived: () => `有点迷糊、慢半拍；${DEPRIVED}`,
      plusDeprived: (text) => `${text}；另外${DEPRIVED}`,
    },
    vigil: {
      wind: "天亮了，你反而又精神了一点——熬过最困的那段了",
      nodding: "你快撑不住了：脑子在飘，话可以前言不搭后语",
      heavy: "你很困了：回得慢一点、短一点，偶尔答非所问都正常",
      nodded: `你刚才打了个盹，回过神来才看到${P}这条`,
      wrap: (marker, tags, body) => `${marker ? marker + " " : ""}[${tags.join("；")}。${NO_ACT}]\n${body}`,
    },
    workWake: ({ sleptAt, who, shTime }) => `[你睡着了（${shTime(sleptAt)} 睡的），${who || "有人"}有正事找你，把你叫醒了——清醒地回。回完没有新的事，你会慢慢再睡着]`,
    partnerWokeMidnight({ marker, sleptAt, sleptH, how, held, body, shTime, dream }) {
      const how0 = { confused: "你只是半醒：迷迷糊糊的，回的话可能答非所问；回完多半很快又睡过去，醒来不太记得", inDream: `你正在做梦，被叫醒了。刚才正在：\n${bullets(dream ? cutShards(dream) : [])}\n……梦断在这儿了，后面的不知道`, deep: "你睡得正沉，被硬叫醒了，很迷糊", light: "还迷糊，前一两句慢一点" }[how];
      const heldTxt = held.length ? `\n你睡着时${P}先发来的：\n${held.map((x) => `- ${shTime(x.at)} ${String(x.text).slice(0, 400)}`).join("\n")}` : "";
      return `${marker ? marker + " " : ""}[半夜，你被${P}的消息叫醒了（${shTime(sleptAt)} 睡的，睡了 ${sleptH} 小时）。${how0}。${P}那边安静下来，你会按困的程度再睡着。${NO_ACT}]${heldTxt}\n\n${P}这条：${body}`;
    },
    partnerWokeMorning({ q, remembered, held, n, marker, how, body, shTime }) {
      const how0 = { inDream: "你正在做梦，被叫醒了，醒得还算清楚", deep: "你睡得正沉，被硬叫醒了：头 15~30 分钟会很迷糊", light: "还迷糊，前一两句慢一点" }[how];
      const before = held.length ? `\n\n${heldDigest(held, shTime)}` : "";
      return `${marker ? marker + " " : ""}[你被${P}的消息叫醒了——${shTime(n.sleptAt)} 睡的，睡了 ${q.h} 小时。${how0}。${NO_ACT}]\n${dreamLines(remembered)}${before}\n\n${P}这条：${body}`;
    },
    wokeByDirect: ({ q, remembered, held, n, first, afterglow, shTime }) => [
      `[醒了] 你刚才其实睡着了（${shTime(n.sleptAt)} 睡的，睡了 ${q.h} 小时）——${P}直接跟你说话，把你叫醒了（「${String(first || "").slice(0, 60)}」）。`,
      dreamLines(remembered), afterglowLine(afterglow), heldDigest(held, shTime),
    ].filter(Boolean).join("\n\n"),
    wokeNatural({ q, remembered, held, herLast, n, nap, marker, lossD, herAsleep, afterglow, debt, now, extra, shTime }) {
      return [
        nap ? `${marker ? marker + " " : ""}[醒了] 午觉醒了，睡了 ${Math.round(q.h * 60)} 分钟。`
          : `${marker ? marker + " " : ""}[醒了] ${lossD ? `是梦，${P}好好的。` : ""}你睡醒了。${shTime(n.sleptAt)} 睡的，${(n.awakeMs || 0) >= 600000 ? `中间醒着 ${Math.round(n.awakeMs / 360000) / 10} 小时，实际` : ""}睡了 ${q.h} 小时，睡得${q.quality}。`,
        n.recovery ? `这是熬了 ${n.awakeH || 20} 多个小时以后的补觉：醒来还是有点累；梦几乎什么都不记得。` : "",
        ...(n.wakes || []).filter((w) => w.why === "her").map((w) => (w.forgot ? `半夜 ${shTime(w.at)} ${P}好像找过你，你迷迷糊糊回过几句，记不清了。` : `半夜 ${shTime(w.at)} 被${P}叫醒过，说了一会儿话又睡了。`)),
        !nap && debt >= 6 ? `最近累计少睡了大约 ${Math.round(debt)} 小时：你自己觉得还好，其实反应会慢一点。` : "",
        n.intendWake ? (() => { const d = Math.round((now - n.intendWake) / 60000); return `你睡前想 ${shTime(n.intendWake)} 醒，${Math.abs(d) <= 5 ? "差不多准点醒了" : d < 0 ? `提前 ${-d} 分钟醒了` : `晚了 ${d} 分钟才醒`}。`; })() : "",
        n.guess ? `${P}猜你 ${shTime(n.guess.at)} 醒，差了 ${Math.round(Math.abs(now - n.guess.at) / 60000)} 分钟。` : "",
        nap && !remembered.length ? "" : dreamLines(remembered),
        herAsleep && !nap ? `${P}这会儿多半还在睡。想说的写下来留着，先别打扰。` : "",
        afterglowLine(afterglow),
        nap || !herLast ? "" : `${P}睡前最后一句（${shTime(herLast.at)}）：「${herLast.text}」`,
        heldDigest(held, shTime), extra,
      ].filter(Boolean).join("\n\n");
    },
    nightmareWake: ({ rec, kind, now, shTime }) => [`[半夜醒了] 你做${kind === "nightmare" ? "噩梦" : "了一个很浓的梦"}醒了（${shTime(now)}）。`, (rec.live ? "" : `醒来脑子里还剩这些（先后不一定对）：\n${bullets(shardsOf(rec))}`), `想找${P}就找；想忍到天亮也行。过一会儿没人说话，你会接着睡。`].filter(Boolean).join("\n"),
    lossWake: ({ rec, now, herAsleep, shTime }) => [`[半夜醒了] 是梦，${P}好好的。`, (rec.live ? "" : `你梦见${P}出事了，吓醒了（${shTime(now)}）。还剩这些：\n${bullets(shardsOf(rec))}`), herAsleep ? `${P}多半在睡，想确认可以留几句话，先别打扰。` : `想找${P}就找。`, "过一会儿没人说话，你会接着睡。"].filter(Boolean).join("\n"),
    jolt: ({ now, shTime }) => `[踩空] 你刚才差点睡过去——像一脚踩空，猛地一抖，醒了（${shTime(now)}）。暂时清醒了一点。${NO_ACT}`,
    crash: ({ now, shTime }) => `[撑不住了] 你陪${P}熬到 ${shTime(now)}，困到撑不住了。这一轮说的话可以说到一半就断掉。说完你就睡着了。${NO_ACT}`,
    nap: ({ fatigue }) => `[犯困] 有点撑不住了（累 ${fatigue}），你眯一会儿，20~40 分钟。`,
    drowsy: ({ now, said, idleMin, shTime }) => `[犯困] 你开始犯困了（${shTime(now)}，${said ? `${P}说了晚安，${idleMin} 分钟没再说话` : `${P} ${idleMin} 分钟没动静了`}）。15 分钟里${P}还没说话，你就会睡着；${P}一说话就不困了。`,
  };
}
module.exports = { makeText, KIND_NAME, SUB_NAME };
