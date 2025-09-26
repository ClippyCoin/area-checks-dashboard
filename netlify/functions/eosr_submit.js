import { DateTime } from "luxon";

export default async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const shift = String(body.shift || "").toLowerCase();
    const priority = String(body.priority || "normal");
    const submitted_by = String(body.submitted_by || "").trim();
    const notes = String(body.notes || "").trim();

    if (!shift || !notes) {
      return new Response(JSON.stringify({ error: "shift and notes required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const now = DateTime.now().setZone("America/Chicago");
    const weekYear = now.weekYear;
    const weekNumber = String(now.weekNumber).padStart(2, "0");
    const weekId = `${weekYear}-W${weekNumber}`;

    const entry = {
      ts_utc: DateTime.utc().toISO(),
      tz: "America/Chicago",
      local_day: now.toFormat("cccc, LLL dd yyyy HH:mm"),
      week: weekId,
      shift,
      priority,
      submitted_by,
      affected_areas: "USP Complex",
      notes,
    };

    const { GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN } = process.env;
    if (!GITHUB_REPO || !GITHUB_BRANCH || !GITHUB_TOKEN) {
      return new Response(JSON.stringify({ error: "Missing GitHub env vars" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const [owner, repo] = GITHUB_REPO.split("/");
    const path = `data-eosr/${weekId}.jsonl`;

    async function getFileSha() {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${GITHUB_BRANCH}`, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "User-Agent": "netlify-fn" },
        cache: "no-store",
      });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`github get err ${r.status}`);
      const j = await r.json();
      return j.sha || null;
    }

    async function getExisting() {
      const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${GITHUB_BRANCH}/${path}`, { cache: "no-store" });
      if (!r.ok) return "";
      return await r.text();
    }

    const sha = await getFileSha();
    const prev = sha ? await getExisting() : "";
    const next = prev ? prev + "\n" + JSON.stringify(entry) : JSON.stringify(entry);

    const commitBody = {
      message: `EOSR ${weekId}`,
      content: Buffer.from(next, "utf8").toString("base64"),
      branch: GITHUB_BRANCH,
      sha: sha || undefined,
    };

    const put = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "User-Agent": "netlify-fn", "Content-Type": "application/json" },
      body: JSON.stringify(commitBody),
    });

    if (!put.ok) {
      const t = await put.text();
      return new Response(JSON.stringify({ error: "GitHub write failed", detail: t }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
    const FROM_EMAIL = process.env.FROM_EMAIL || "no-reply@example.com";
    const EOSR_TO = process.env.EOSR_TO || "USPMAINTENANCE@waynesanderson.com";

    if (SENDGRID_API_KEY) {
      const subject = `[EOSR][${priority.toUpperCase()}] ${shift} shift — ${now.toFormat("ccc LLL dd yyyy")}`;
      const plain =
`End of Shift Report

When: ${entry.local_day} (${entry.tz})
Shift: ${entry.shift}
Priority: ${entry.priority}
Submitted by: ${entry.submitted_by || "(not provided)"}
Affected areas: ${entry.affected_areas}

Notes:
${entry.notes}
`;
      const html =
`<h3>End of Shift Report</h3>
<p><b>When:</b> ${entry.local_day} (${entry.tz})<br>
<b>Shift:</b> ${entry.shift}<br>
<b>Priority:</b> ${entry.priority}<br>
<b>Submitted by:</b> ${entry.submitted_by || "(not provided)"}<br>
<b>Affected areas:</b> ${entry.affected_areas}</p>
<pre style="white-space:pre-wrap;font-family:inherit;border:1px solid #ddd;border-radius:6px;padding:10px;background:#f7f7f7;color:#000">${entry.notes.replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</pre>`;

      const sgBody = {
        personalizations: [{ to: EOSR_TO.split(",").map(e => ({ email: e.trim() })).filter(x => x.email) }],
        from: { email: FROM_EMAIL },
        subject,
        content: [
          { type: "text/plain", value: plain },
          { type: "text/html", value: html }
        ]
      };

      const sg = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(sgBody)
      });

      if (!sg.ok) {
        const errText = await sg.text();
        console.error("SendGrid error:", sg.status, errText);
      }
    }

    return new Response(JSON.stringify({ ok: true, week: weekId }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
