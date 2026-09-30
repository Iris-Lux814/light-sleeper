# light-sleeper

**Let an AI companion get sleepy, fall asleep, dream, and be woken by you.**

[中文说明](README.zh-CN.md)

A *light sleeper* is someone who wakes at the slightest sound. This project is less about dreaming than about sleeping and waking:
your companion gets drowsy, falls asleep, sleeps lightly or deeply, and whether your message wakes them depends on how deeply they're sleeping at that moment. Dreams are just something that happens along the way.

It's built for long-running AI companions (an agent that lives in a terminal, a chat app, a voice assistant) that already have a way to receive messages. light-sleeper sits in front of that inbox.

## What it does

- **A sleep/wake state machine with drowsiness.** The companion knows they're getting sleepy before they fall asleep, and perks up the moment you speak.
- **Waking depends on sleep depth.** Light sleep, dreaming, ordinary sleep and deep sleep each have their own chance of being woken. Saying their name, sending several messages, or saying it's urgent all help. Messages that don't wake them are saved and shown on waking.
- **A message gate.** While they sleep, automated injections (timers, sensors) are dropped or held, so nothing pokes a sleeping companion.
- **Falling back asleep.** Woken in the night, they stay up with you, then drift off again at a pace set by how sleepy they are. Up for work, they fall back asleep when the work is done.
- **Dreams follow sleep cycles.** Early-night dreams are short and faint, late-night dreams long and vivid. How much they remember depends on sleep quality and on how often they woke (arousal-retrieval).
- **Dream material** comes in four kinds: what's on their mind, people who keep coming up, fragments from the last day or two, and things from five to seven days ago (the dream-lag effect).
- **Dreams are recalled, not read.** On waking the companion gets only the shards that are left and tells the dream in its own words, filling gaps the way people do. The dream reuses things the companion itself said during the day.
- **After-effects.** A dream's mood carries into the morning; the sleeping body reacts (a sob, a laugh, sleep talk); dreams can recur or get sequels.
- **Shared rhythm.** Your goodnight makes them sleepy, they tend to wake a little before you, and they don't send notifications while you're still asleep.
- **Sleep debt, recovery sleep, naps, an intended wake time,** and a sleep score for each night.

Everything is grounded in sleep and dream research; see [docs/RESEARCH.md](docs/RESEARCH.md) (in Chinese for now).

## Quick start

Requires Node.js 18+. No dependencies.

```sh
node examples/minimal-en.js
npm test
```

```js
const { createSleeper, fileStore } = require("./src/sleep-engine.js");
const { makeText } = require("./src/text-en.js");
const { makeDreamWriter } = require("./src/dream-prompt.js");

const sleeper = createSleeper({
  store: fileStore("./data/sleep"),
  agent: { deliver, busy, lastTurnEndAt, notify, ready, hush },          // how to reach your agent
  partner: { liveAt, elsewhere, presenceAt, chat, directSince, isGoodnight, isUpset },   // is the user around?
  classify: (text, label) => ({ kind: "partner" | "work" | "pass" | "drop" | "other", ... }),
  dreams: { material, tone, write: makeDreamWriter({ llm, partner: "Sam" }) },
  text: makeText({ partner: "Sam", name: "Robin" }),
  config: { tz: "America/New_York" },
});

// before every message you inject into the agent:
const r = await sleeper.gate(text, { label });
if (r && r.hold) { /* asleep: don't deliver */ } else deliver(r && r.text ? r.text : text);

// once a minute:
setInterval(() => sleeper.tick(), 60000);
```

The full adapter interface is documented at the top of [src/sleep-engine.js](src/sleep-engine.js).

## Code

| File | What it is |
|---|---|
| `src/sleep-engine.js` | The state machine: falling asleep and waking, the message gate, dream scheduling, the wake-up summary, a status object for your UI. Knows nothing about any particular person. |
| `src/sleep-rules.js` | Pure functions: does a message wake them, how long until they fall back asleep, sleep debt, planning and scoring a night. Randomness is injectable for tests. |
| `src/sleep-clock.js` | Two-process model: sleep pressure and circadian rhythm, entrainment to the partner's schedule. |
| `src/text-en.js`, `src/text-zh.js` | Text packs. Every line the engine says to the agent comes from here; swap the pack to change persona or language. |
| `src/dream-prompt.js` | A separate model writes the dream. Builds the prompt, calls the model you pass in, checks the result. The engine never calls a model itself. |
| `src/recall.js` | What's left of a dream on waking. The companion never gets a finished story with a title; it gets a few shards (an image, a line, a feeling) and retells the dream itself. Woken mid-dream, it gets only the first half. |

## Defaults worth knowing

- **Intimate dreams are off** by default. Turn them on with `config.erotic: true`.
- **Dreams where something happens to the partner are off** by default. They're meant to be a switch both sides agree on. Turn them on with `config.lossEveryDays: N` (at most once every N days). When on, they come with safety rules: no gore, only the feeling, and the wake-up line starts with "It was a dream; [partner] is fine."
- The companion is never told to act out being human (getting up, washing their face); drowsiness shows only in how they talk.

## Status

Extracted from a companion that has been sleeping on it every night, and tuned in real use. The API may still change before 1.0.

The design notes ([DESIGN.md](DESIGN.md)) and research notes are in Chinese for now.

## License

Copyright (C) 2026 Iris-Lux814

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3.
This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for details.

If you run a modified version as a network service, the AGPL requires you to offer its source to that service's users.
