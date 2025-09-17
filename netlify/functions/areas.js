export default async (req, context) => {
  try {
    const { GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN } = process.env;
    if (!GITHUB_REPO || !GITHUB_BRANCH) {
      return new Response(JSON.stringify({ areas: [] }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
    }
    const [owner, repo] = GITHUB_REPO.split("/");
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/data?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
    const headers = { Accept: "application/vnd.github+json" };
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return new Response(JSON.stringify({ areas: [] }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
    }
    const items = await res.json();
    const areas = Array.isArray(items)
      ? items.filter(it => it && it.type === "dir" && it.name).map(it => String(it.name).toUpperCase()).sort()
      : [];
    return new Response(JSON.stringify({ areas }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
  } catch (err) {
    return new Response(JSON.stringify({ areas: [] }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
  }
};
