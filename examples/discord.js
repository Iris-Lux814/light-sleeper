// SPDX-License-Identifier: AGPL-3.0-only
// A Discord bot companion that sleeps. Needs discord.js: npm i discord.js
//
//   DISCORD_TOKEN=…  DISCORD_USER_ID=…  LLM_API_KEY=…  LLM_MODEL=…  node examples/discord.js
//
// The bot talks to one person (DISCORD_USER_ID) in direct messages. Turn on "Message Content Intent" for the bot
// in the Discord developer portal. Optional: LLM_BASE_URL, DREAM_MODEL, TZ_NAME, DREAM_MODE=live|model, PERSONA,
// PARTNER_NAME, DATA_DIR.
"use strict";
const path = require("path");
const { makeCompanion } = require("./lib/companion.js");

let D; try { D = require("discord.js"); } catch { console.error("This example needs discord.js: npm i discord.js"); process.exit(1); }
const { Client, GatewayIntentBits, Partials, Events } = D;
const TOKEN = process.env.DISCORD_TOKEN, USER = String(process.env.DISCORD_USER_ID || "");
if (!TOKEN || !USER || !process.env.LLM_MODEL) { console.error("Set DISCORD_TOKEN, DISCORD_USER_ID, LLM_API_KEY and LLM_MODEL (see the top of this file)."); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });
const dm = async () => (await client.users.fetch(USER)).createDM();
// Discord messages are limited to 2000 characters
const chunks = (t) => String(t).match(/[\s\S]{1,1900}/g) || [];

const companion = makeCompanion({
  dir: process.env.DATA_DIR || path.join(__dirname, "..", "data", "discord"),
  persona: process.env.PERSONA || "You are a warm AI companion chatting with your partner on Discord. Keep replies short and natural.",
  partner: process.env.PARTNER_NAME || "my partner",
  send: async (text) => { const ch = await dm(); for (const c of chunks(text)) await ch.send(c); },
});

client.on(Events.MessageCreate, (m) => {
  if (m.author.bot || m.author.id !== USER || m.guildId) return;   // only their DMs
  if (!m.content) return;
  companion.onMessage(m.content).catch((e) => console.error("reply failed:", e.message));
});
client.once(Events.ClientReady, (c) => {
  console.log(`discord companion running as ${c.user.tag}; status: ${companion.status().status}`);
  setInterval(companion.tick, 60000);
});
client.login(TOKEN);
