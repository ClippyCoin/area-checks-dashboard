export default async (req, context) => {
  try {
    const tz = "America/Chicago";
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    });
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
      const nextY  = ymd(new Date(d.getTime() + dayMs));
      workDays.push({ startY, nextY, label: startY });
    }

    function inPlantDay(localY, localHM, startY, nextY) {
      if (localY === startY && localHM >= "05:00") return true;
      if (localY === nextY  && localHM <  "05:00") return true;
      return false;
    }
    function whichShift(localHM) {
      if (localHM >= "05:00" && localHM < "13:00") return "first";
      if (localHM >= "13:00" && localHM < "21:00") return "second";
      if (localHM >= "21:00" ||  localHM < "05:00") return "third";
      return "none";
    }

    const areas = await listAreas();

    let perDay = workDays.map(d => ({ label: d.label, first: 0, second: 0, third: 0 }));
    for (let di = 0; di < workDays.length; di++) {
      const { startY, nextY } = workDays[di];
      for (const area of areas) {
        const files = [`data/${area.toLowerCase()}/${startY}.jsonl`, `data/${area.toLowerCase()}/${nextY}.jsonl`];
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
            if (!inPlantDay(localY, localHM, startY, nextY)) continue;
            const s = whichShift(localHM);
            if (s === "first")  perDay[di].first  += 1;
            if (s === "second") perDay[di].second += 1;
            if (s === "third")  perDay[di].third  += 1;
          } catch {}
        }
      }
    }

    const totals = perDay.reduce((a, d) => ({
      first:  a.first  + d.first,
      second: a.second + d.second,
      third:  a.third  + d.third
    }), { first:0, second:0, third:0 });

    const capDay = n => Math.min(Math.max(0, n|0), 8); // 0..8
    const counted = {
      first:  perDay.reduce((a,d)=>a+capDay(d.first), 0),
      second: perDay.reduce((a,d)=>a+capDay(d.second),0),
      third:  perDay.reduce((a,d)=>a+capDay(d.third), 0)
    };

    const goalPerDay = 7;
    const denom = goalPerDay * 5;
    const pct = n => Math.round((n / denom) * 100);

    const body = {
      period: { start: workDays[0].label, end: workDays[workDays.length-1].label, tz },
      totals,
      counted,
      percent: { first: pct(counted.first), second: pct(counted.second), third: pct(counted.third) },
      days: perDay
    };

    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
};
