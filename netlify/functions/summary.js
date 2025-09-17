export default async (req, context) => {
  try {
    const url = new URL(req.url);
    const area = url.searchParams.get("area");
    if (!area) {
      return new Response(JSON.stringify({ error: "missing area" }), { status: 400 });
    }

    const { GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN } = process.env;
    const [owner, repo] = (GITHUB_REPO || "").split("/");
    const baseRaw = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}`;

    const tz = "America/Chicago";
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    });
    const parts = d => Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    const ymd = d => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
    const hm  = d => { const p = parts(d); return `${p.hour}:${p.minute}`; };

    const now = new Date();
    const todayY = ymd(now);
    const yest   = new Date(now.getTime() - 24*3600*1000);
    const tom    = new Date(now.getTime() + 24*3600*1000);
    const yestY  = ymd(yest);
    const tomY   = ymd(tom);

    const nowHM = hm(now);
    const plantStartY = nowHM >= "05:00" ? todayY : yestY;
    const plantNextY  = plantStartY === todayY ? tomY : todayY;

    async function read(path) {
      const res = await fetch(`${baseRaw}/${path}`, GITHUB_TOKEN ? { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } } : undefined);
      if (!res.ok) return "";
      return res.text();
    }

    const paths = [
      `data/${area.toLowerCase()}/${yestY}.jsonl`,
      `data/${area.toLowerCase()}/${todayY}.jsonl`,
      `data/${area.toLowerCase()}/${tomY}.jsonl`
    ];

    let lines = [];
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

    let issuesToday = 0;
    let latestISO = null;
    let first = 0, second = 0, third = 0;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const ts  = new Date(obj.timestamp || obj.time || 0);
        if (isNaN(ts)) continue;

        const localY  = ymd(ts);
        const localHM = hm(ts);

        if (inPlantDay(localY, localHM)) {
          const c = Number(obj.issue_count ?? 0);
          if (!Number.isNaN(c)) issuesToday += c;

          const s = whichShift(localHM);
          if (s === "first")  first  += 1;
          if (s === "second") second += 1;
          if (s === "third")  third  += 1;
        }

        latestISO = ts.toISOString();
      } catch {}
    }

    let minutesSince = null;
    if (latestISO) {
      const ms = Date.now() - new Date(latestISO).getTime();
      minutesSince = Math.max(0, Math.floor(ms / 60000));
    }

    let status = "OK";
    if (issuesToday >= 5) status = "Critical";
    else if (issuesToday >= 3) status = "Alert";
    else if (issuesToday >= 1) status = "Attention";

    const body = {
      area,
      lastTime: latestISO,
      minutesSince,
      issuesToday,
      latestCount: 0,
      status,
      shiftCountsToday: { first, second, third },
      meta: { tz, plantStart: `${plantStartY}T05:00:00` }
    };

    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
};
