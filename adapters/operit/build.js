// SPDX-License-Identifier: AGPL-3.0-only
// Builds dist/light_sleeper.toolpkg (a zip) for Operit. No dependencies.
//   node adapters/operit/build.js
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const ROOT = path.join(__dirname, "..", ".."), HERE = __dirname;
require("child_process").execFileSync(process.execPath, [path.join(ROOT, "scripts", "bundle.js")], { stdio: "inherit" });
fs.mkdirSync(path.join(HERE, "lib"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "dist", "light-sleeper.js"), path.join(HERE, "lib", "light-sleeper.js"));

const FILES = ["manifest.json", "main.js", "lib/light-sleeper.js", "packages/light_sleeper.js"];
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const locals = [], centrals = []; let offset = 0;
for (const name of FILES) {
  const data = fs.readFileSync(path.join(HERE, name)); const deflated = zlib.deflateRawSync(data); const nameBuf = Buffer.from(name, "utf8");
  const crc = crc32(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(deflated.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(deflated.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt32LE(offset, 42);
  locals.push(lh, nameBuf, deflated); centrals.push(ch, nameBuf);
  offset += lh.length + nameBuf.length + deflated.length;
}
const cd = Buffer.concat(centrals);
const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(FILES.length, 8); end.writeUInt16LE(FILES.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
const out = path.join(ROOT, "dist", "light_sleeper.toolpkg");
fs.writeFileSync(out, Buffer.concat([...locals, cd, end]));
console.log(`${path.relative(process.cwd(), out)}: ${FILES.length} files, ${Math.round(fs.statSync(out).size / 1024)} KB`);
