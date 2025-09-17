export default async (req, context) => {
  try {
    const tz = "America/Chicago";
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const parts = o => Object.fromEntries(fmt.formatToParts(o).map(p => [p.type, p.value]));
    const ymd = d => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
    const hm = d => { const p = parts(d); return `${p.hour}:${p.minute}`; };

    const { GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN } = process.env;
    const [owner, repo] = (GITHUB_REPO || "").split("/");
    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`;
    const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}`;
    const ghHeaders = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" } : { Accept: "application/vnd.github+json" };

    async function listAreas() {
      const res = await fetch(`${apiBase}/data?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: ghHeaders });
      if (!res.ok) return [];
      const arr = await res.json();
      return Array.isArray(arr) ? arr.filter(x => x && x.type === "dir").map(x => x.name.toUpperCase()) : [];
    }

    async function readFile(path) {
      const res = await fetch(`${rawBase}/${path}`, GITHUB_TOKEN ? { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } } : undefined);
      if (!res.ok) return "";
      return res.text();
    }

    function dayWindowNow() {
      const now = new Date();
      const todayY = ymd(now);
      const yest = new Date(now.getTime() - 24 * 3600 * 1000);
      const yestY = ymd(yest);
      const tom = new Date(now.getTime() + 24 * 3600 * 1000);
      const tomY = ymd(tom);
      const hmNow = hm(now);
      const startY = hmNow >= "05:30" ? todayY : yestY;
      const nextY = startY === todayY ? tomY : todayY;
      return { startY, nextY, todayY, yestY, tomY };
    }

    function whichShift(localHM) {
      if (localHM >= "05:00" && localHM < "13:00") return "first";
      if (localHM >= "13:00" && localHM < "21:00") return "second";
      if (localHM >= "21:00" || localHM < "05:30") return "third";
      return "none";
    }

    const areas = await listAreas();

    const days = [];
    const now = new Date();
    const oneDay = 24 * 3600 * 1000;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * oneDay);
      // compute plant start for that day
      const hmD = hm(d);
      const todayY = ymd(d);
      const yest = new Date(d.getTime() - oneDay);
      const yestY = ymd(yest);
      const tom = new Date(d.getTime() + oneDay);
      const tomY = ymd(tom);
      const startY = hmD >= "05:30" ? todayY : yestY;
      const nextY = startY === todayY ? tomY : todayY;
      days.push({ startY, nextY, label: startY });
    }

    let totals = { first: 0, second: 0, third: 0 };
    const perDay = days.map(d => ({ label: d.label, first: 0, second: 0, third: 0 }));

    for (let di = 0; di < days.length; di++) {
      const { startY, nextY } = days[di];
      for (const area of areas) {
        const maybe = [`data/${area.toLowerCase()}/${startY}.jsonl`, `data/${area.toLowerCase()}/${nextY}.jsonl`];
        let lines = [];
        for (const p of maybe) {
          const txt = await readFile(p);
          if (txt) lines.push(...txt.split(/\r?\n/).filter(Boolean));
        }
        // count submissions per shift for this plant day
        let dayFirst = 0, daySecond = 0, dayThird = 0;
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            const ts = new Date(obj.timestamp || obj.time || 0);
            if (isNaN(ts)) continue;
            const localY = ymd(ts);
            const localHM = hm(ts);
            const inDay = (localY === startY && localHM >= "05:30") || (localY === nextY && localHM < "05:30");
            if (!inDay) continue;
            const s = whichShift(localHM);
            if (s === "first") dayFirst += 1;
            else if (s === "second") daySecond += 1;
            else if (s === "third") dayThird += 1;
          } catch {}
        }
        perDay[di].first += dayFirst;
        perDay[di].second += daySecond;
        perDay[di].third += dayThird;
      }
      totals.first += perDay[di].first;
      totals.second += perDay[di].second;
      totals.third += perDay[di].third;
    }

    function capped(n) {
      if (n >= 9) return 8; // 9 plus counts as 8 toward percent
      return Math.min(n, 7);
    }

    const goalPerDay = 7; // per shift per day
    const daysCount = days.length;
    const denom = goalPerDay * daysCount;

    const percent = s => Math.round((s / denom) * 100);

    const counted = {
      first: perDay.reduce((a, d) => a + capped(d.first), 0),
      second: perDay.reduce((a, d) => a + capped(d.second), 0),
      third: perDay.reduce((a, d) => a + capped(d.third), 0),
    };

    const body = {
      period: { start: days[0].label, end: days[days.length - 1].label, tz },
      totals,
      counted,
      percent: {
        first: percent(counted.first),
        second: percent(counted.second),
        third: percent(counted.third),
      },
      days: perDay,
    };

    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
};
