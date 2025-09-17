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
    const ghJson = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" } : { Accept: "application/vnd.github+json" };
    const ghAuth = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : undefined;

    async function listAreas() {
      const r = await fetch(`${apiBase}/data?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: ghJson });
      if (!r.ok) return [];
      const arr = await r.json();
      return Array.isArray(arr) ? arr.filter(x => x && x.type === "dir").map(x => x.name.toUpperCase()) : [];
    }
    async function readRaw(path) {
      const r = await fetch(`${rawBase}/${path}`, ghAuth ? { headers: ghAuth } : undefined);
      if (!r.ok) return "";
      return r.text();
    }
    async function getContent(path) {
      const r = await fetch(`${apiBase}/${encodeURIComponent(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: ghJson });
      return r;
    }
    async function putContent(path, message, contentB64, sha) {
      const body = { message, content: contentB64, branch: GITHUB_BRANCH };
      if (sha) body.sha = sha;
      const r = await fetch(`${apiBase}/${encodeURIComponent(path)}`, { method: "PUT", headers: { ...ghJson, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return r;
    }

    function weekRange(now) {
      const dayMs = 24*3600*1000;
      const dowFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
      const idx = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
      const dow = idx[dowFmt.format(now)];
      const daysBackToMon = (dow + 6) % 7;
      const monday = new Date(now.getTime() - daysBackToMon*dayMs);
      const days = [];
      for (let i=0;i<5;i++) {
        const d = new Date(monday.getTime() + i*dayMs);
        const startY = ymd(d);
        const nextY  = ymd(new Date(d.getTime() + dayMs));
        days.push({ startY, nextY, label: startY });
      }
      return { monday: ymd(monday), days };
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
    function capDay(n) { const x = Math.max(0, n|0); if (x >= 9) return 8; return Math.min(x, 8); }

    if (req.method === "GET") {
      const r = await fetch(`${apiBase}/archive?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: ghJson });
      if (!r.ok) return new Response(JSON.stringify({ weeks: [] }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
      const arr = await r.json();
      const files = Array.isArray(arr) ? arr.filter(f => f.type === "file" && /^week-\d{4}-\d{2}-\d{2}\.json$/.test(f.name)) : [];
      const items = [];
      for (const f of files) {
        const txt = await readRaw(`archive/${f.name}`);
        try { items.push(JSON.parse(txt)); } catch {}
      }
      items.sort((a,b) => (a.period.start < b.period.start ? 1 : -1));
      return new Response(JSON.stringify({ weeks: items }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
    }

    if (req.method === "POST") {
      const now = new Date();
      const areas = await listAreas();
      const { monday, days } = weekRange(now);

      let perDay = days.map(d => ({ label: d.label, first: 0, second: 0, third: 0 }));
      for (let di = 0; di < days.length; di++) {
        const { startY, nextY } = days[di];
        for (const area of areas) {
          const files = [`data/${area.toLowerCase()}/${startY}.jsonl`, `data/${area.toLowerCase()}/${nextY}.jsonl`];
          let lines = [];
          for (const f of files) {
            const t = await readRaw(f);
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

      const totals = perDay.reduce((a, d) => ({ first:a.first+d.first, second:a.second+d.second, third:a.third+d.third }), { first:0, second:0, third:0 });
      const counted = {
        first:  perDay.reduce((a,d)=>a+capDay(d.first), 0),
        second: perDay.reduce((a,d)=>a+capDay(d.second),0),
        third:  perDay.reduce((a,d)=>a+capDay(d.third), 0)
      };
      const denom = 7 * 5;
      const pct = n => Math.round((n / denom) * 100);
      const percent = { first: pct(counted.first), second: pct(counted.second), third: pct(counted.third) };

      const best = Math.max(percent.first, percent.second, percent.third);
      const winners = [];
      if (percent.first  === best) winners.push("1st");
      if (percent.second === best) winners.push("2nd");
      if (percent.third  === best) winners.push("3rd");
      const winner = winners.join(", ");

      const record = {
        period: { start: days[0].label, end: days[days.length-1].label, tz },
        totals, counted, percent, winner, savedAt: new Date().toISOString()
      };

      const path = `archive/week-${monday}.json`;
      const exists = await getContent(path);
      if (exists.ok) {
        return new Response(await exists.text(), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
      }
      const contentB64 = Buffer.from(JSON.stringify(record, null, 2), "utf8").toString("base64");
      const put = await putContent(path, `Archive weekly results ${monday}`, contentB64);
      if (!put.ok) {
        const t = await put.text();
        return new Response(JSON.stringify({ error: t }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(record), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
    }

    return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
};
