exports.handler = async (event, context) => {
  try {
    const qs = event.queryStringParameters || {};
    const area = String(qs.area || "").trim().toUpperCase();
    const limitNum = Number(qs.limit || 100);
    const limit = Math.max(1, Math.min(500, Number.isNaN(limitNum) ? 100 : limitNum));

    if (!area) {
      return json({ error: "missing area" }, 400);
    }

    const { GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN } = process.env;
    const [owner, repo] = (GITHUB_REPO || "").split("/");
    if (!owner || !repo || !GITHUB_BRANCH) {
      return json({ area, items: [] }, 200, { "Cache-Control": "no-cache" });
    }

    const tz = "America/Chicago";
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false
    });
    const parts = d => Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    const ymd = d => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };

    const now = new Date();
    const days = [0, -1, 1];
    const paths = days.map(n => {
      const d = new Date(now.getTime() + n * 24 * 3600 * 1000);
      return `data/${area.toLowerCase()}/${ymd(d)}.jsonl`;
    });

    const items = [];
    for (const p of paths) {
      const text = await readRaw(owner, repo, GITHUB_BRANCH, p, GITHUB_TOKEN);
      if (!text) continue;
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          if (String(obj.area_id || "").toUpperCase() !== area) continue;
          items.push({
            submission_id: obj.submission_id || null,
            timestamp: obj.timestamp || obj.time || null,
            responder: obj.responder || null,
            issue_count: Number(obj.issue_count || 0),
            fails: Array.isArray(obj.fails) ? obj.fails : null
          });
        } catch {}
      }
    }

    items.sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
    const trimmed = items.slice(-limit).reverse();

    return json({ area, items: trimmed }, 200, { "Cache-Control": "no-cache" });
  } catch (err) {
    return json({ area: null, items: [], error: err.message }, 200, { "Cache-Control": "no-cache" });
  }
};

async function readRaw(owner, repo, branch, path, token) {
  const u = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const opts = token
    ? { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    : { cache: "no-store" };
  const r = await fetch(u, opts);
  if (!r.ok) return "";
  return r.text();
}

function json(obj, status = 200, extra = {}) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(obj)
  };
}
