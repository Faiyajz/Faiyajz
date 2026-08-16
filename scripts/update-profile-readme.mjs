import { readFile, writeFile } from 'node:fs/promises';

const username = process.env.GITHUB_REPOSITORY_OWNER || 'Faiyajz';
const token = process.env.GITHUB_TOKEN;
const panelPaths = [
  new URL('../assets/telemetry-dark.svg', import.meta.url),
  new URL('../assets/telemetry-light.svg', import.meta.url),
];
const nowPaths = [new URL('../assets/now-building-dark.svg', import.meta.url), new URL('../assets/now-building-light.svg', import.meta.url)];

if (!token) throw new Error('GITHUB_TOKEN is required.');

const graphql = async (query, variables = {}) => {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) throw new Error(payload.errors?.[0]?.message || response.statusText);
  return payload.data;
};

const data = await graphql(
  `query Profile($login: String!, $from: DateTime!, $mergedQuery: String!, $closedQuery: String!) {
    user(login: $login) {
      repositories(first: 100, ownerAffiliations: [OWNER], isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) { totalCount nodes { name description primaryLanguage { name } pushedAt } }
      contributionsCollection(from: $from) {
        totalCommitContributions
        commitContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner } }
      }
    }
    merged: search(query: $mergedQuery, type: ISSUE, first: 5) {
      issueCount
      nodes { ... on PullRequest { title url repository { nameWithOwner } mergedAt } }
    }
    closed: search(query: $closedQuery, type: ISSUE, first: 1) { issueCount }
  }`,
  {
    login: username,
    from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    mergedQuery: `type:pr is:merged author:${username}`,
    closedQuery: `type:issue is:closed author:${username}`,
  },
);

const markdownSafe = (value) => value.replace(/[|\\]/g, '\\$&').replace(/\s+/g, ' ').trim();
const latestPosts = async (url, label) => {
  if (!url) return [];
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Faiyajz-profile-readme' } });
    if (!response.ok) throw new Error(response.statusText);
    const xml = await response.text();
    return [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, 3).flatMap(([item]) => {
      const title = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i)?.slice(1).find(Boolean);
      const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
      return title && link ? [`- **${label}** · [${markdownSafe(title.replace(/<[^>]+>/g, ''))}](${link})`] : [];
    });
  } catch (error) {
    console.warn(`Unable to load ${label} RSS: ${error.message}`);
    return [];
  }
};

const contributed = new Set(data.user.contributionsCollection.commitContributionsByRepository.map(({ repository }) => repository.nameWithOwner)).size;
const values = {
  PUBLIC_REPOS: data.user.repositories.totalCount,
  MERGED_PRS: data.merged.issueCount,
  CLOSED_ISSUES: data.closed.issueCount,
  COMMITS: data.user.contributionsCollection.totalCommitContributions,
  CONTRIBUTED_REPOS: contributed,
};
const xmlSafe = (text) => String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const active = data.user.repositories.nodes[0];

for (const panelPath of panelPaths) {
  let panel = await readFile(panelPath, 'utf8');
  for (const [marker, value] of Object.entries(values)) {
    panel = panel.replace(new RegExp(`(<text id="${marker}"[^>]*>)[^<]*(</text>)`), `$1${value}$2`);
  }
  await writeFile(panelPath, panel);
}

for (const panelPath of nowPaths) {
  let panel = await readFile(panelPath, 'utf8');
  panel = panel.replace(/(<text id="NOW_REPO"[^>]*>)[^<]*(<\/text>)/, `$1${xmlSafe(active?.name || 'no public activity yet')}$2`);
  panel = panel.replace(/(<text id="NOW_DETAIL"[^>]*>)[^<]*(<\/text>)/, `$1${xmlSafe(`${active?.primaryLanguage?.name || 'repository'} · ${active?.description || 'recently active public work'}`.slice(0, 96))}$2`);
  await writeFile(panelPath, panel);
}

const journal = [
  ...(await latestPosts(process.env.LINKEDIN_RSS_URL, 'LinkedIn')),
].slice(0, 4);
const readmePath = new URL('../README.md', import.meta.url);
let readme = await readFile(readmePath, 'utf8');
readme = readme.replace(
  /<!-- ENGINEERING_JOURNAL:START -->[\s\S]*?<!-- ENGINEERING_JOURNAL:END -->/,
  `<!-- ENGINEERING_JOURNAL:START -->\n${journal.length ? journal.join('\n') : '_No RSS entries yet. Add `LINKEDIN_RSS_URL` as a repository variable._'}\n<!-- ENGINEERING_JOURNAL:END -->`,
);
await writeFile(readmePath, readme);
