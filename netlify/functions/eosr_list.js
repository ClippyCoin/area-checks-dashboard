import { DateTime } from "luxon";

export default async (req, context) => {
  try {
    if (req.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(req.url);
    const weekParam = url.searchParams.get("week") || "";
    const weeksParam = url.searchParams.get("weeks") || "";

    const { GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN } = process.env;
    const [owner, repo] = (GITHUB_REPO || "").split("/");
    const basePath = "data-eosr";

    if (!owner || !repo || !GITHUB_BRANCH) {
      return json({ error: "Missing GitHub configuration" }, 500);
    }

    if (weeksParam.toLowerCase() === "all") {
      const weeks = await listWeeks(owner, repo, GITHUB_BRANCH, basePath, GITHUB_TOKEN);
      return json({ weeks }, 200, noCache());
    }

    const weekId = (weekParam.toLowerCase() === "current")
      ? currentWeekId()
      : (weekParam || currentWeekId());

    const items = await readWeek(owner, repo, GITHUB_BRANCH, basePath, weekId, GITHUB_TOKEN);
    return json({ week: weekId, items }, 200, noCache());

  } catch (e) {
    return json({ error: String(e) }, 500, noCache());
  }
};

function currentWeekId() {
  const tz = "America/Chicago";
  const now = DateTime.now().setZone(tz);
  const wkStart0500 = now.startOf("week").plus({ hours: 5 }); // Monday 05:00 local
  const weekStart = now < wkStart0500 ? wkStart0500.minus({ weeks: 1 }) : wkStart0500;
  const id = `${weekStart.weekYear}-W${String(weekStart.weekNumber).padStart(2, "0")}`;
  return id;
}

async function listWeeks(owner, repo, branch, basePath, token) {
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${basePath}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(api, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!r.ok) return [];
  const j = await r.json();
  const weeks = (Array.isArray(j) ? j : [])
    .map(x => x?.name || "")
    .filter(name => name.endsWith(".jsonl"))
    .map(name => name.replace(/\.jsonl$/i, ""))
    .sort((a, b) => b.localeCompare(a)); // newest first
  return weeks;
}

async function readWeek(owner, repo, branch, basePath, weekId, token) {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${basePath}/${encodeURIComponent(weekId)}.jsonl`;
  const r = await fetch(rawUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store"
  });
  if (!r.ok) return [];
  const text = await r.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const items = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object") items.push(obj);
    } catch {}
  }
  items.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  return items;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });
}

function noCache() {
  return { "Cache-Control": "no-store" };
}
