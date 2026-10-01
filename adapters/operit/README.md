# light-sleeper for Operit

A ToolPkg that lets the AI in one Operit chat get drowsy, fall asleep and dream.

## Install (Android)

1. Build it: `node adapters/operit/build.js` → `dist/light_sleeper.toolpkg`. (Or take it from a release.)
2. Copy `light_sleeper.toolpkg` to the phone and import it in Operit (package manager → import package), or put it in `Android/data/com.ai.assistance.operit/files/packages/`.
3. Enable the package (the bundle is `light_sleeper_bundle`; its tools are in the `light_sleeper` subpackage, which is what the AI activates with `use_package`). Settings are optional (environment config):
   - `LIGHT_SLEEPER_PARTNER`: what the AI calls you.
   - `LIGHT_SLEEPER_LANG`: `zh` or `en`.
   - `LIGHT_SLEEPER_UTC_OFFSET`: your time zone in minutes (480 = UTC+8). Leave empty to use the phone's time.
   - `LIGHT_SLEEPER_DREAMS`: `live` (default; dreams happen in the chat scene by scene) or `model` (only fragments on waking).
4. Open the chat you want and ask the AI to run the `light_sleeper:setup` tool. It binds that chat and creates a workflow called "light-sleeper clock" that ticks every 15 minutes. If the workflow can't be created, make one by hand: schedule trigger, every 15 minutes, action `light_sleeper:tick`.
5. If the role card limits which packages the AI may use, add `light_sleeper` to its allowed packages, or the tools are blocked.
6. Tell the AI (in its role card or prompt) that after saying goodnight it can call `light_sleeper:go_to_sleep`. It also falls asleep on its own when it gets sleepy.

## Operit2 / iOS

Not working yet. On Operit2 (tested on iOS) the package imports and activates, but every tool times out after 60 s, even `diagnose`. Use Operit on Android for now.

## How it works here

- Every message you send in the bound chat goes through the sleep gate (a chat input hook). If it doesn't wake the AI, the message is held and shown when it wakes. If it does, it's sent with a short note on how the AI woke.
- The engine talks to the AI with `send_message_to_ai`, with the user message hidden. Live dream scenes are sent the same way, starting with `[dream]`. The AI's replies stay in the chat, so its dream reactions show up there, a bit like sleep talk.
- Dreams are written by the chat model you configured in Operit (`Tools.Chat.call`). No extra API key.
- State is one file: `/sdcard/Download/Operit/plugins/light_sleeper/data.json`.

## Limits

- The clock ticks every 15 minutes (Operit's minimum) and on every message you send, so things happen up to 15 minutes late.
- Operit has no call to post a message as the AI, so sleep talk only goes to the log.
- `send_message_to_ai` waits for the full reply. Some versions freeze while a workflow waits on it (Operit issue #1263). If that happens, set `LIGHT_SLEEPER_DREAMS=model` so dreams don't need a reply.

---

# 浅眠 Operit 版

让 Operit 某个聊天里的 AI 会困、会睡、会做梦。

1. 把 `light_sleeper.toolpkg` 导入 Operit（包管理 → 导入包），启用。外层包叫 `light_sleeper_bundle`，工具在子包 `light_sleeper` 里，AI 用 `use_package` 要激活的是子包。
2. 环境配置（都可以不填）：`LIGHT_SLEEPER_PARTNER`（AI 怎么称呼你）、`LIGHT_SLEEPER_LANG`（zh / en）、`LIGHT_SLEEPER_UTC_OFFSET`（东八区填 480，不填用手机时间）、`LIGHT_SLEEPER_DREAMS`（live 默认 / model）。
3. 在要用的聊天里让 AI 调一次 `light_sleeper:setup`：绑定这个聊天，并建一个每 15 分钟跑一次的工作流。建不了就手动建：定时触发每 15 分钟，动作 `light_sleeper:tick`。
4. 角色卡如果限制了能用哪些包，要把 `light_sleeper` 加进允许列表，不然工具会被拦。
5. 在角色卡里告诉 AI：说完晚安可以调 `light_sleeper:go_to_sleep` 去睡。困了也会自己睡。

iOS（Operit2）现在还不能用：能导入激活，但工具全部超时。先用安卓版 Operit。

限制：时钟 15 分钟走一步，事情最多晚 15 分钟；梦里的回应会留在聊天里；卡住的话把 `LIGHT_SLEEPER_DREAMS` 改成 `model`。
