export default async (req) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const key = req.headers.get('x-api-key') || '';
    if (key !== process.env.INGEST_KEY) return new Response('Unauthorized', { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { submission_id, area_id, responder, issue_count, timestamp } = body;
    if (!submission_id || !area_id || typeof issue_count !== 'number') {
      return new Response('Bad Request: missing fields', { status: 400 });
    }

    const ts = timestamp ? new Date(timestamp) : new Date();
    const day = ts.toISOString().slice(0, 10);

    const dir = process.env.GITHUB_DATA_DIR || 'data';
    const path = `${dir}/${area_id.toLowerCase()}/${day}.jsonl`;

    const line = JSON.stringify({
      submission_id, area_id, responder,
      issue_count, timestamp: ts.toISOString()
    }) + '\n';

    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';
    const apiBase = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;

    const gh = async (url, init) => fetch(url, {
      ...init,
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        ...init?.headers
      }
    });

    // read existing file, if any
    const getRes = await gh(`${apiBase}?ref=${branch}`);
    let sha = null, content = '';
    if (getRes.status === 200) {
      const j = await getRes.json();
      sha = j.sha;
      content = Buffer.from(j.content, 'base64').toString('utf8');
    } else if (getRes.status !== 404) {
      return new Response('GitHub read error', { status: 502 });
    }

    const b64 = Buffer.from(content + line, 'utf8').toString('base64');

    const putRes = await gh(apiBase, {
      method: 'PUT',
      body: JSON.stringify({ message: `Add ${submission_id} to ${path}`, content: b64, branch, sha })
    });

    if (putRes.status >= 400) return new Response('GitHub write error', { status: 502 });

    return new Response('ok', { status: 200 });
  } catch (err) {
    return new Response(`Server error: ${err}`, { status: 500 });
  }
};
