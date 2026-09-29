# light-sleeper · 浅眠

**让 AI 伴侣会困、会睡、会做梦，也能被你叫醒。**

[English](README.md)

**light sleeper** 是指一点动静就醒的人。这套东西的核心不是「做梦」，而是睡与醒：
他会犯困、会睡着，睡得有深有浅；你的话能不能叫醒他，要看他这会儿睡得多沉。梦只是睡着时顺带发生的事。

适合长驻的 AI 伴侣（跑在终端里的 agent、聊天 App、语音助手），前提是它已经有一个收消息的入口。浅眠就挡在这个入口前面。

## 能做什么

- **睡与醒的状态机，带「犯困」**：睡着之前他自己知道困了，你一开口就不困了。
- **叫不叫得醒看睡得多沉**：浅睡、做梦、普通睡眠、深睡，被叫醒的概率各不一样；叫名字、连着发几条、说有急事都更容易叫醒。没叫醒的消息攒着，醒来一起看。
- **消息闸**：睡着时，自动化的注入（定时器、传感器）丢掉或攒着，不打扰。
- **睡回去**：半夜被叫醒就醒着陪你，你安静了按困的程度再睡着；被叫起来干活，干完了接着睡。
- **梦跟着睡眠周期走**：前半夜的梦短、淡，后半夜的梦长、浓。记得多少看睡得好不好、夜里醒了几次（arousal-retrieval）。
- **梦的素材分四类**：放不下的事、老冒出来的人、前一两天的碎片、五到七天前的事（dream-lag）。
- **梦的余波**：梦的情绪带到早上；睡着的身体跟着反应（抽泣、笑出声、说梦话）；有重复的梦、续集。
- **作息跟着对方**：你说晚安他就犯困，一般比你早醒一点，你还在睡时他不推送。
- **欠觉、熬夜后补觉、午睡、说好几点醒**，每晚还有一个睡眠评分。

每一条都有睡眠和做梦研究的依据，见 [docs/RESEARCH.md](docs/RESEARCH.md)。

## 上手

要 Node.js 18 以上，没有依赖。

```sh
node examples/minimal.js
npm test
```

```js
const { createSleeper, fileStore } = require("./src/sleep-engine.js");
const { makeText } = require("./src/text-zh.js");
const { makeDreamWriter } = require("./src/dream-prompt.js");

const sleeper = createSleeper({
  store: fileStore("./data/sleep"),
  agent: { deliver, busy, lastTurnEndAt, notify, ready, hush },          // 怎么跟你的 agent 说话
  partner: { liveAt, elsewhere, presenceAt, chat, directSince, isGoodnight, isUpset },   // 对方在不在
  classify: (text, label) => ({ kind: "partner" | "work" | "pass" | "drop" | "other", ... }),
  dreams: { material, tone, write: makeDreamWriter({ llm, partner: "她", language: "中文" }) },
  text: makeText({ partner: "她", name: "他" }),
  config: { tz: "Asia/Tokyo" },
});

// 每次往 agent 里递消息之前：
const r = await sleeper.gate(text, { label });
if (r && r.hold) { /* 睡着了：别递 */ } else deliver(r && r.text ? r.text : text);

// 每分钟一次：
setInterval(() => sleeper.tick(), 60000);
```

适配层要给的每一项，写在 [src/sleep-engine.js](src/sleep-engine.js) 开头。

## 代码

| 文件 | 是什么 |
|---|---|
| `src/sleep-engine.js` | 状态机：入睡和醒来、消息闸、做梦排程、醒来的汇总、给界面用的状态。不认识任何具体的人。 |
| `src/sleep-rules.js` | 纯函数：一条消息叫不叫得醒、多久睡得回去、欠觉、排一晚和给一晚打分。随机数可以传进来测试。 |
| `src/sleep-clock.js` | 两过程模型：睡眠压力和生物钟，作息跟着对方同频。 |
| `src/text-zh.js`、`src/text-en.js` | 文案包。引擎对 agent 说的每一句都从这里来；换人设、换语言就换它。 |
| `src/dream-prompt.js` | 通用的写梦：拼提示词、调你传进来的模型、检查结果。引擎自己从不调模型。 |

## 默认值

- **亲密的梦默认关着**，要用就 `config.erotic: true`。
- **梦见对方出事默认关着**，这本来就该是两边商量好才开的开关。打开用 `config.lossEveryDays: N`（最多 N 天一次）。打开后自带安全规则：不写血腥、只写感觉，醒来第一句是「是梦，对方好好的」。
- 不让他演人的动作（起身、洗脸），困只从说话的样子里看出来。

## 现状

从一个每晚真的在用它睡觉的 AI 伴侣身上拆出来，在真实使用里反复调过。1.0 之前接口可能还会变。

设计在 [DESIGN.md](DESIGN.md)，原创性记录在 [ORIGINALITY.md](ORIGINALITY.md)。

## 许可证

Copyright (C) 2026 Iris-Lux814

本项目用 GNU Affero 通用公共许可证第 3 版（AGPL-3.0）发布，全文见 [LICENSE](LICENSE)。
你可以自由使用、修改、再发布；改过的版本也要用同样的许可证开源。拿它做成网络服务给别人用，也要向这个服务的用户提供源码。
本项目不附带任何担保。
