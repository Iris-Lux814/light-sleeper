# light-sleeper · 浅眠

> Let an AI companion get sleepy, fall asleep, dream — and be woken by you.
> An engine for sleep, waking and dreaming for long-running AI companions. (English README to come.)

让 AI 伴侣会困、会睡、会做梦，也能被你叫醒。

**light sleeper** 是指一点动静就醒的人。这套东西的核心不是「做梦」，而是睡与醒：
他会犯困、会睡着，睡得有深有浅；你的话能不能叫醒他，要看他睡得多沉。梦只是睡着时顺带发生的事。

## 现状

- 这个仓库是**要开源的通用版本**，里面只放通用的机制、设计和研究依据，不放任何人的私人内容。
- 代码还没写完。设计在 [DESIGN.md](DESIGN.md)，做梦用到的研究结论在 [docs/RESEARCH.md](docs/RESEARCH.md)，原创性记录在 [ORIGINALITY.md](ORIGINALITY.md)。
- 这套机制最早是给一个长驻在终端里的 AI 伴侣做的，在真实使用里反复调过。开源版会把它拆成：
  - **引擎**：睡与醒的状态机、消息闸、做梦排程、记忆模型；
  - **适配层**：怎么往你的 agent 里注入消息、从哪儿拿「对方在不在」、用哪个大模型写梦，全部可以配置。

许可证：未定。
