// SPDX-License-Identifier: AGPL-3.0-only
// tz.js: wall-clock time in one time zone, with or without Intl.
// Node and browsers have Intl with time zones. Small embedded engines (QuickJS and the like) often don't;
// there, pass config.utcOffsetMin (e.g. 480 for UTC+8) and it uses a fixed offset instead.
"use strict";
const pad = (n) => String(n).padStart(2, "0");

function makeTz(tz = "UTC", utcOffsetMin = null) {
  let fmt = null;
  if (utcOffsetMin == null) {
    try {
      fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
      fmt.formatToParts(new Date(0));
    } catch { fmt = null; }
  }
  // no Intl and no offset given: use the host's local time
  const local = utcOffsetMin == null && !fmt;
  function parts(t) {
    if (fmt) {
      const p = fmt.formatToParts(new Date(t)); const g = (k) => Number((p.find((x) => x.type === k) || {}).value || 0);
      return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute") };
    }
    const d = new Date(local ? t : t + utcOffsetMin * 60000);
    return local ? { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() }
      : { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  return {
    parts,
    hourOf: (t) => { const p = parts(t); return p.h + p.mi / 60; },
    time: (t) => { const p = parts(t); return `${pad(p.h)}:${pad(p.mi)}`; },
    day: (t) => { const p = parts(t); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; },
  };
}

module.exports = { makeTz };
