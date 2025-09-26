import { DateTime } from "luxon";

export default async (req, context) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.json();
    const { shift, submitted_by, priority, notes } = body;
    if (!shift || !notes) {
      return json({ error: "shift and notes are required" }, 400);
    }

    const tz = "America/Chicago";
    const now = DateTime.now().setZone(tz);
    const weekStart0500 = now.startOf("week").plus({ hours: 5 });
    const weekStart = now < weekStart0500 ? weekStart0500.minus({ weeks: 1 }) : weekStart0500;
    const plant_week_id = `${weekStart.weekYear}-W${String(weekStart.weekNumber).padStart(2, "0")}`;

    const entry = {
      plant_week_id,
      week_start_local: weekStart.toISO(),
      timestamp: now.toISO(),
      local_day: now.toFormat("yyyy-LL-dd"),
      shift,
      submitted_by: submitted_by || null,
      priority: priority || "normal",
      affected_areas: ["USP Complex"],
      notes,
    };

    const { GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN } = process.env;
    const [owner, repo] = (GITHUB_REPO || "").split("/");
    if (!owner || !repo || !GITHUB_BRANCH || !GITHUB_TOKEN) {
      return json({ error: "Missing GitHub configuration" }, 500);
    }

    const path = `data-eosr/${plant_week_id}.jsonl`;
    const existing = await readRaw(owner, repo, GITHUB_BRANCH, path, GITHUB_TOKEN);
    const newContent = (existing ? existing + "\n" : "") + JSON.stringify(entry);
    await writeFile(owner, repo, GITHUB_BRANCH, path, newContent, GITHUB_TOKEN);

    await sendEmail(entry);

    return json({ ok: true, entry }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

async function readRaw(owner, repo, branch, path, token) {
  const u = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) return "";
  return r.text();
}

async function writeFile(owner, repo, branch, path, content, token) {
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const get = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let sha = null;
  if (get.ok) {
    const j = await get.json();
    sha = j.sha;
  }
  const b64 = Buffer.from(content).toString("base64");
  await fetch(api, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `EOSR update ${path}`,
      content: b64,
      branch,
      sha,
    }),
  });
}

async function sendEmail(entry) {
  const subject = `[EOSR] Week ${entry.plant_week_id}, ${entry.shift} shift, ${entry.local_day}`;
  const body = [
    `Week: ${entry.plant_week_id}`,
    `Shift: ${entry.shift}`,
    `Priority: ${entry.priority}`,
    `Submitted by: ${entry.submitted_by || "n/a"}`,
    `Affected areas: USP Complex`,
    `Timestamp: ${entry.timestamp}`,
    "",
    "Report:",
    entry.notes
  ].join("\n");

  const sgKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || "no-reply@yourdomain.com";
  const toEmail = "USPMAINTENANCE@waynesanderson.com";
  if (!sgKey) return;

  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sgKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail },
      subject,
      content: [{ type: "text/plain", value: body }],
    }),
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
