export default async (req) => {
  try {
    const url = new URL(req.url);
    const area = (url.searchParams.get('area') || 'KILL').toUpperCase();
    const dir = process.env.GITHUB_DATA_DIR || 'data';
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';

    const today = new Date();
    const days = [0, 1];
    const lines = [];

    const gh = async (path) => fetch(
      `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`,
      { headers: { 'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json' } }
    );

    for (const d of days) {
      const dt = new Date(today.getTime() - d * 86400000);
      const dayStr = dt.toISOString().slice(0, 10);
      const path = `${dir}/${area.toLowerCase()}/${dayStr}.jsonl`;
      const res = await gh(path);
      if (res.status === 200) {
        const j = await res.json();
        const text = Buffer.from(j.content, 'base64').toString('utf8');
        lines.push(...text.trim().split('\n').filter(Boolean));
      }
    }

    const rows = lines.map(l => JSON.parse(l)).filter(r => r.area_id?.toUpperCase() === area);
    const now = Date.now();
    let lastTime = null;
    for (const r of rows) {
      const t = Date.parse(r.timestamp);
      if (!isNaN(t) && (lastTime === null || t > lastTime)) lastTime = t;
    }
    const minutesSince = lastTime === null ? null : Math.floor((now - lastTime) / 60000);

    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const issuesToday = rows.filter(r => {
      const t = Date.parse(r.timestamp);
      return !isNaN(t) && t >= startOfDay.getTime() && Number(r.issue_count) > 0;
    }).length;

    let status = 'Loading';
    if (minutesSince === null) status = 'No Data';
    else if (minutesSince <= 60 && issuesToday === 0) status = 'Good';
    else if (minutesSince <= 60 && issuesToday > 0) status = 'Attention';
    else status = 'Missed';

    return new Response(JSON.stringify({
      area,
      lastTime: lastTime ? new Date(lastTime).toISOString() : null,
      minutesSince,
      issuesToday,
      status
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    return new Response(`Server error: ${err}`, { status: 500 });
  }
};
