export default async (req, context) => {
  try {
    const url = new URL(req.url);
    const area = url.searchParams.get("area");
    if (!area) {
      return new Response(JSON.stringify({ error: "missing area" }), { status: 400 });
    }

    const today = new Date();
    const yyyy = today.getUTCFullYear();
    const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(today.getUTCDate()).padStart(2, "0");
    const path = `data/${area.toLowerCase()}/${yyyy}-${mm}-${dd}.jsonl`;

    const { GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN } = process.env;
    const [owner, repo] = (GITHUB_REPO || "").split("/");
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${path}`;

    const headers = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {};
    const res = await fetch(rawUrl, { headers });

    if (!res.ok) {
      const body = { area, lastTime: null, minutesSince: null, issuesToday: 0, status: "OK" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
    }

    const content = await res.text();
    const lines = content.split(/\r?\n/).filter(Boolean);

    if (lines.length === 0) {
      const body = { area, lastTime: null, minutesSince: null, issuesToday: 0, status: "OK" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    let issuesToday = 0;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const c = Number(obj.issue_count ?? 0);
        if (!Number.isNaN(c)) issuesToday += c;
      } catch {}
    }

    const latest = JSON.parse(lines[lines.length - 1]);
    const latestCount = Number(latest.issue_count ?? 0);
    const lastTime = latest.timestamp ?? latest.time ?? null;

    let minutesSince = null;
    if (lastTime) {
      const ms = Date.now() - new Date(lastTime).getTime();
      minutesSince = Math.max(0, Math.floor(ms / 60000));
    }

    const status = latestCount > 0 ? "Attention" : "OK";
    const body = { area, lastTime, minutesSince, issuesToday, status };

    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
};
