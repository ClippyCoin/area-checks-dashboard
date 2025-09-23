// netlify/functions/summary.js
exports.handler = async (event, context) => {
  try {
    const area = event.queryStringParameters && event.queryStringParameters.area;
    if (!area) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "missing area" })
      };
    }

    const { GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN } = process.env;
    const [owner, repo] = (GITHUB_REPO || "").split("/");
    const baseRaw = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}`;

    const tz = "America/Chicago";
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false
    });
    const parts = d => Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    const ymd = d => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
    const hm  = d => { const p = parts(d); return `${p.hour}:${p.minute}`; };
    const hmToMin = s => {
      const [h, m] = String(s).split(":").map(n => parseInt(n, 10));
      return (isNaN(h) || isNaN(m)) ? 0 : h * 60 + m;
    };

    const now = new Date();
    const todayY = ymd(now);
    const yest = new Date(now.getTime() - 24 * 3600 * 1000);
    const tom  = new Date(now.getTime() + 24 * 3600 * 1000);
    const yestY = ymd(yest);
    const tomY  = ymd(tom);

    const nowHM = hm(now);
    const plantStartY = nowHM >= "05:00" ? todayY : yestY;
    const plantNextY  = plantStartY === todayY ? tomY : todayY;

    async function read(path) {
      const headers = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : undefined;
      const res = await fetch(`${baseRaw}/${path}`, { headers });
      if (!res.ok) return "";
      return res.text();
    }

    const dir = `data/${area.toLowerCase()}`;
    const paths = [`${dir}/${yestY}.jsonl`, `${dir}/${todayY}.jsonl`, `${dir}/${tomY}.jsonl`];

    const lines = [];
    for (const p of paths) {
      const t = await read(p);
      if (t) lines.push(...t.split(/\r?\n/).filter(Boolean));
    }

    function inPlantDay(localY, localHM) {
      if (localY === plantStartY && localHM >= "05:00") return true;
      if (localY === plantNextY  && localHM <  "05:00") return true;
      return false;
    }
    function whichShift(localHM) {
      if (localHM >= "05:00" && localHM < "13:00") return "first";
      if (localHM >= "13:00" && localHM < "21:00") return "second";
      if (localHM >= "21:00" ||  localHM < "05:00") return "third";
      return "none";
    }

    const rows = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const ts = new Date(obj.timestamp || obj.time || 0);
        if (Number.isNaN(ts.getTime())) continue;
        const localY  = ymd(ts);
        const localHM = hm(ts);
        if (inPlantDay(localY, localHM)) {
          rows.push({ obj, tsISO: ts.toISOString(), localY, localHM });
        }
      } catch {}
    }
    rows.sort((a, b) => a.tsISO.localeCompare(b.tsISO));

    const submissionsToday = rows.length;
    const issuesToday = rows.reduce((sum, r) => {
      const c = Number(r.obj.issue_count ?? 0);
      return sum + (Number.isNaN(c) ? 0 : c);
    }, 0);

    const latestISO = submissionsToday ? rows[rows.length - 1].tsISO : null;
    let minutesSince = null;
    if (latestISO) {
      const ms = Date.now() - new Date(latestISO).getTime();
      minutesSince = Math.max(0, Math.floor(ms / 60000));
    }

    let first = 0, second = 0, third = 0;
    for (const r of rows) {
      const s = whichShift(r.localHM);
      if (s === "first")  first  += 1;
      if (s === "second") second += 1;
      if (s === "third")  third  += 1;
    }

    const WIN_MIN = 60;
    const TOL_MIN = 10;

    const nowMin = hmToMin(nowHM);
    const minutesSinceStart = nowHM >= "05:00" ? nowMin - 300 : (24 * 60 - 300) + nowMin;
    const windowsElapsed = Math.max(1, Math.floor(minutesSinceStart / WIN_MIN) + 1);

    const seenWindows = new Set();
    const ontimeWindows = new Set();
    for (const r of rows) {
      const m = hmToMin(r.localHM);
      let totalFromStart;
      if (r.localY === plantStartY && r.localHM >= "05:00") {
        totalFromStart = m - 300;
      } else if (r.localY === plantNextY && r.localHM < "05:00") {
        totalFromStart = (24 * 60 - 300) + m;
      } else {
        continue;
      }
      if (totalFromStart < 0) continue;
      const idx = Math.floor(totalFromStart / WIN_MIN);
      seenWindows.add(idx);
      const offsetInWindow = totalFromStart % WIN_MIN;
      if (offsetInWindow < TOL_MIN) ontimeWindows.add(idx);
    }

    const completed = Math.min(seenWindows.size, windowsElapsed);
    const ontime   = Math.min(ontimeWindows.size, windowsElapsed);
    const completionPct = Math.min(100, Math.round((completed / windowsElapsed) * 100));
    const onTimePct     = Math.min(100, Math.round((ontime   / windowsElapsed) * 100));

    let status = "OK";
    if (issuesToday >= 5) status = "Critical";
    else if (issuesToday >= 3) status = "Alert";
    else if (issuesToday >= 1) status = "Attention";

    const body = {
      area,
      lastTime: latestISO,
      minutesSince,
      submissionsToday,
      issuesToday,
      onTimePct,
      completionPct,
      status,
      shiftCountsToday: { first, second, third },
      meta: { tz, plantStart: `${plantStartY}T05:00:00` }
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify(body)
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
