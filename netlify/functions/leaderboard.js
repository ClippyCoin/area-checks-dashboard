export default async (req, context) => {
  try {
    const tz = "America/Chicago";
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const parts = d => Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    const ymd = d => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
    const hm  = d => { const p = parts(d); return `${p.hour}:${p.minute}`; };

    const { GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN } = process.env;
    const [owner, repo] = (GITHUB_REPO || "").split("/");
    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`;
    const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}`;
    const ghHeaders = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" } : { Accept: "application/vnd.github+json" };

    async function listAreas() {
      const r = await fetch(`${apiBase}/data?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: ghHeaders });
      if (!r.ok) return [];
      const arr = await r.json();
      return Array.isArray(arr) ? arr.filter(x => x && x.type === "dir").map(x => x.name.toUpperCase()) : [];
    }
    async function read(path) {
      const r = await fetch(`${rawBase}/${path}`, GITHUB_TOKEN ? { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } } : undefined);
      if (!r.ok) return "";
      return r.text();
    }

    const now = new Date();
    const dayMs = 24*3600*1000;
    const dowFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    const idx = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    const dow = idx[dowFmt.format(now)];
    const daysBackToMon = (dow + 6) % 7;
    const monday = new Date(now.getTime() - daysBackToMon*dayMs);

    const workDays = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday.getTime() + i*dayMs);
      const startY = ymd(d);
      const prevY  = ymd(new Date(d.getTime() - dayMs));
      workDays.push({ label: startY, startY, prevY });
    }

    function inWindow(localY, localHM, prevY, startY) {
      if (localY === prevY && localHM >= "21:00") return true;
      if (localY === startY && localHM <  "21:00") return true;
      return false;
    }
    function whichShift(localHM) {
      if (localHM >= "05:00" && localHM < "13:00") return "first";
      if (localHM >= "13:00" && localHM < "21:00") return "second";
      if (localHM >= "21:00" ||  localHM < "05:00") return "third";
      return "none";
    }

    const areas = await listAreas();

    const perDay = workDays.map(d => ({ label: d.label, first: 0, second: 0, third: 0, codes: {} }));
    for (let di = 0; di < workDays.length; di++) {
      const { startY, prevY } = workDays[di];
      for (const area of areas) {
        const codeKey = area.toUpperCase();
        if (!perDay[di].codes[codeKey]) perDay[di].codes[codeKey] = { first: 0, second: 0, third: 0 };
        const files = [`data/${area.toLowerCase()}/${prevY}.jsonl`, `data/${area.toLowerCase()}/${startY}.jsonl`];
        let lines = [];
        for (const f of files) {
          const t = await read(f);
          if (t) lines.push(...t.split(/\r?\n/).filter(Boolean));
        }
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            const ts  = new Date(obj.timestamp || obj.time || 0);
            if (isNaN(ts)) continue;
            const localY  = ymd(ts);
            const localHM = hm(ts);
            if (!inWindow(localY, localHM, prevY, startY)) continue;
            const s = whichShift(localHM);
            if (s === "none") continue;
            perDay[di][s] += 1;
            perDay[di].codes[codeKey][s] += 1;
          } catch {}
        }
      }
    }

    const totals = perDay.reduce((a, d) => ({ first: a.first + d.first, second: a.second + d.second, third: a.third + d.third }), { first: 0, second: 0, third: 0 });

    const cap = 8;
    const counted = { first: 0, second: 0, third: 0 };
    for (const d of perDay) {
      for (const code of Object.keys(d.codes)) {
        counted.first  += Math.min(d.codes[code].first,  cap);
        counted.second += Math.min(d.codes[code].second, cap);
        counted.third  += Math.min(d.codes[code].third,  cap);
      }
    }

    const goalPerDay = 7;
    const days = 5;
    const numCodes = areas.length || 0;
    const denomPerShift = Math.max(1, goalPerDay * days * numCodes);
    const pct = n => Math.min(100, Math.round((n / denomPerShift) * 100));

    const notes = "Third shift counts Sunday 21:00 through Friday 05:00, first and second shifts count Monday through Friday, cap is 8 per code per day, percent uses a goal of 7 per code per day, all times America/Chicago";

    const body = {
      period: { start: workDays[0].label, end: workDays[workDays.length - 1].label, tz },
      denom: { perShift: denomPerShift, goalPerDay, capPerDay: cap, codes: numCodes, days },
      totals,
      counted,
      percent: { first: pct(counted.first), second: pct(counted.second), third: pct(counted.third) },
      days: perDay,
      notes
    };

    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
};
