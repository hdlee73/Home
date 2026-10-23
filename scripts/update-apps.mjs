// 공개 GitHub 저장소와 각 저장소의 최신 릴리스를 모아 data/apps.json 으로 저장한다.
// GitHub Actions(update-apps.yml)에서 실행되며, 토큰은 Actions 가 자동 발급하는 GITHUB_TOKEN 만 사용한다.
import { readFile, writeFile } from 'node:fs/promises';

const CONFIG_PATH = 'data/apps-config.json';
const OUTPUT_PATH = 'data/apps.json';

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
const owner = process.env.GITHUB_OWNER || config.owner;
const token = process.env.GITHUB_TOKEN;
// show 에 적은 저장소만, 적은 순서대로 노출한다.
const show = (config.show || []).map((n) => n.toLowerCase());
const overrides = Object.fromEntries(
  Object.entries(config.overrides || {}).map(([k, v]) => [k.toLowerCase(), v])
);

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `${owner}-homepage`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

// 다운로드 버튼에 쓸 대표 파일: 설치 파일 확장자를 우선하고, 같은 확장자면 일반 PC용(x64)을 ARM용보다 앞세운다.
const PREFERRED_EXT = ['.apk', '.aab', '.exe', '.msi', '.dmg', '.pkg', '.appimage', '.deb', '.zip'];
const isArm = (name) => /arm64|aarch64|[-_.]arm[-_.]/i.test(name);
function pickPrimaryAsset(assets) {
  for (const ext of PREFERRED_EXT) {
    const hits = assets.filter((a) => a.name.toLowerCase().endsWith(ext));
    const hit = hits.find((a) => !isArm(a.name)) || hits[0];
    if (hit) return hit.name;
  }
  return assets[0]?.name ?? null;
}

const repos = [];
for (let page = 1; ; page++) {
  const batch = await gh(`/users/${owner}/repos?type=owner&per_page=100&page=${page}&sort=pushed`);
  if (!batch?.length) break;
  repos.push(...batch);
  if (batch.length < 100) break;
}

const apps = [];
const candidates = [];
for (const repo of repos) {
  if (repo.private || repo.fork || repo.archived) continue;
  candidates.push(repo.name);
  if (!show.includes(repo.name.toLowerCase())) continue;
  const ov = overrides[repo.name.toLowerCase()] || {};

  const rel = await gh(`/repos/${owner}/${repo.name}/releases/latest`);
  const assets = (rel?.assets || []).map((a) => ({
    name: a.name,
    size: a.size,
    downloads: a.download_count,
    url: a.browser_download_url,
  }));

  apps.push({
    repo: repo.name,
    name: ov.name || repo.name,
    description: ov.description || repo.description || '',
    icon: ov.icon || null,
    language: repo.language,
    topics: repo.topics || [],
    stars: repo.stargazers_count,
    url: repo.html_url,
    homepage: ov.homepage || repo.homepage || null,
    pushedAt: repo.pushed_at,
    release: rel
      ? {
          tag: rel.tag_name,
          name: rel.name || rel.tag_name,
          publishedAt: rel.published_at,
          url: rel.html_url,
          notes: (rel.body || '').slice(0, 600),
          assets,
          primaryAsset: pickPrimaryAsset(assets),
          zipball: rel.zipball_url,
        }
      : null,
  });
}

apps.sort((a, b) => show.indexOf(a.repo.toLowerCase()) - show.indexOf(b.repo.toLowerCase()));
candidates.sort((a, b) => a.localeCompare(b));

const next = { owner, apps, candidates };
let prev = null;
try {
  prev = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
} catch {}

// 내용이 바뀌었을 때만 갱신 시각을 바꿔 불필요한 커밋을 막는다.
if (prev && JSON.stringify({ owner: prev.owner, apps: prev.apps, candidates: prev.candidates }) === JSON.stringify(next)) {
  console.log('변경 사항 없음');
} else {
  await writeFile(OUTPUT_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), ...next }, null, 2) + '\n');
  console.log(`앱 ${apps.length}개 저장`);
}
