// GitHub 이슈로 받은 링크를 data/links.json 에 추가하거나 삭제한다.
// 유튜브는 oEmbed 로 제목을, 그 밖의 링크는 Open Graph 메타데이터로 제목·요약·대표 이미지를 가져온다.
// 사용: node scripts/manage-links.mjs add|remove  (ISSUE_BODY, ISSUE_NUMBER 또는 REQUEST_FILE 환경변수 사용)
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { listDriveFolder } from './drive-list.mjs';

const LINKS_PATH = 'data/links.json';
const GROUPS = ['참고자료', '유튜브 링크', '블로그 링크', '기타자료'];

// 분류 이름(옛 이름 포함)을 네 가지 분류 중 하나로 바꾼다. '자동'이거나 모르는 이름이면 링크 종류로 정한다.
function normalizeGroup(label, type) {
  const l = String(label || '').trim();
  if (GROUPS.includes(l)) return l;
  if (l === '구글 드라이브' || l === '자료') return '참고자료';
  if (l === '유튜브') return '유튜브 링크';
  if (l === '블로그') return '블로그 링크';
  if (l === '기사' || l === '웹') return '기타자료';
  return { youtube: '유튜브 링크', blog: '블로그 링크', gdrive: '참고자료' }[type] || '기타자료';
}
const mode = process.argv[2] || 'add';
const body = process.env.ISSUE_BODY || '';
const issueNumber = process.env.ISSUE_NUMBER ? Number(process.env.ISSUE_NUMBER) : null;

// 이슈 양식(### 제목 + 값) 을 { 제목: 값 } 으로 바꾼다. 양식이 아니면 빈 객체.
function parseIssueForm(text) {
  const fields = {};
  const parts = text.split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const [head, ...rest] = part.split('\n');
    const value = rest.join('\n').trim();
    fields[head.trim()] = value === '_No response_' ? '' : value;
  }
  return fields;
}

function field(fields, prefix) {
  const key = Object.keys(fields).find((k) => k.startsWith(prefix));
  return key ? fields[key] : '';
}

function extractUrls(text) {
  return [...new Set((text.match(/https?:\/\/[^\s<>()"'`]+/g) || []).map((u) => u.replace(/[.,;]+$/, '')))];
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'music.youtube.com') {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

// 네이버 블로그 PC 주소는 본문이 iframe 안에 있어 메타데이터가 비어 있으므로 모바일 주소로 읽는다.
function metadataUrl(url) {
  const u = new URL(url);
  if (u.hostname === 'blog.naver.com') {
    u.hostname = 'm.blog.naver.com';
    return u.toString();
  }
  return url;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const headerCharset = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1];
  const metaCharset = buf
    .subarray(0, 4096)
    .toString('latin1')
    .match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  let charset = (headerCharset || metaCharset || 'utf-8').toLowerCase();
  let decoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return { ok: res.ok, finalUrl: res.url, html: decoder.decode(buf) };
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function metaContent(html, names) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*>|<meta[^>]+content=["'][^"']*["'][^>]+(?:property|name)=["']${name}["'][^>]*>`,
      'i'
    );
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content?.trim()) return decodeEntities(content.trim());
  }
  return '';
}

function clean(s, max) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// 메타 설명이 없을 때 본문 첫 문단에서 요약을 만든다.
function firstParagraph(html) {
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 40);
  return paras[0] || '';
}

// 구글 드라이브·문서 링크: { app: file|folder|document|spreadsheets|presentation, id }
function googleDrive(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'drive.google.com') {
      const folder = u.pathname.match(/\/folders\/([\w-]{10,})/);
      if (folder) return { app: 'folder', id: folder[1] };
      const file = u.pathname.match(/\/file\/d\/([\w-]{10,})/);
      if (file) return { app: 'file', id: file[1] };
      const id = u.searchParams.get('id');
      if (id && /^[\w-]{10,}$/.test(id)) return { app: 'file', id };
    }
    if (u.hostname === 'docs.google.com') {
      const m = u.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([\w-]{10,})/);
      if (m) return { app: m[1], id: m[2] };
    }
  } catch {}
  return null;
}

const DRIVE_LABEL = {
  folder: 'Google Drive 폴더',
  file: 'Google Drive 파일',
  document: 'Google 문서',
  spreadsheets: 'Google 스프레드시트',
  presentation: 'Google 프레젠테이션',
};

async function describeDrive(url, drive) {
  let title = '';
  let summary = '';
  try {
    const { html } = await fetchText(url);
    title = (metaContent(html, ['og:title']) ||
      decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim())
      .replace(/\s+-\s+Google (Drive|Docs|Sheets|Slides|문서|스프레드시트|프레젠테이션|드라이브)\s*$/i, '');
    summary = metaContent(html, ['og:description', 'description']);
    if (/^(Google (Drive|Docs|Sheets|Slides)|Sign-in|로그인)/i.test(title)) title = ''; // 비공개 링크는 로그인 화면이 온다
  } catch (e) {
    console.warn(`드라이브 정보를 읽지 못함: ${url} (${e.message})`);
  }
  // 홈페이지는 구글 화면을 임베드하지 않고 파일 이름 목록만 보여준다.
  const files =
    drive.app === 'folder' ? await listDriveFolder(drive.id) : title ? [{ id: drive.id, name: clean(title, 200), folder: false }] : null;
  return {
    type: 'gdrive',
    driveApp: drive.app,
    driveId: drive.id,
    ...(files ? { files } : {}),
    title: clean(title || DRIVE_LABEL[drive.app], 200),
    summary: clean(summary, 300),
    site: DRIVE_LABEL[drive.app],
    image: null,
  };
}

async function describe(url) {
  const drive = googleDrive(url);
  if (drive) return describeDrive(url, drive);
  const vid = youtubeId(url);
  if (vid) {
    let title = '';
    let author = '';
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (res.ok) {
        const o = await res.json();
        title = o.title || '';
        author = o.author_name || '';
      }
    } catch {}
    return {
      type: 'youtube',
      videoId: vid,
      title: title || 'YouTube 영상',
      summary: '',
      site: author ? `YouTube · ${author}` : 'YouTube',
      image: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
    };
  }

  const host = new URL(url).hostname.replace(/^www\./, '');
  const type = /blog|tistory|brunch|velog|medium|substack|wordpress|naver\.me/i.test(host) ? 'blog' : 'web';
  try {
    const { html, finalUrl } = await fetchText(metadataUrl(url));
    const title =
      metaContent(html, ['og:title', 'twitter:title']) ||
      decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
    const summary =
      metaContent(html, ['og:description', 'twitter:description', 'description']) || firstParagraph(html);
    let image = metaContent(html, ['og:image', 'twitter:image', 'twitter:image:src']);
    if (image) {
      try {
        image = new URL(image, finalUrl).toString();
      } catch {
        image = '';
      }
    }
    const site = metaContent(html, ['og:site_name']) || host;
    return {
      type,
      title: clean(title || host, 200),
      summary: clean(summary, 300),
      site: clean(site, 80),
      image: image || null,
    };
  } catch (e) {
    console.warn(`메타데이터를 읽지 못함: ${url} (${e.message})`);
    return { type, title: host, summary: '', site: host, image: null };
  }
}

// 홈페이지 관리자 화면이 커밋한 요청 파일(data/link-requests/*.json)도 이슈 양식과 같은 필드로 읽는다.
const fields = process.env.REQUEST_FILE
  ? (({ urls = [], category = '', sub = '', title = '', summary = '', tags = '' }) => ({
      링크: [].concat(urls).join('\n'),
      분류: category,
      세부분류: sub,
      제목: title,
      요약: summary,
      태그: [].concat(tags).join(', '),
    }))(JSON.parse(await readFile(process.env.REQUEST_FILE, 'utf8')))
  : parseIssueForm(body);
const urlSource = Object.keys(fields).length ? field(fields, '링크') || body : body;
const urls = extractUrls(urlSource);

let links = [];
try {
  links = JSON.parse(await readFile(LINKS_PATH, 'utf8'));
} catch {}

const report = [];
const sameUrl = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

if (!urls.length) {
  report.push('⚠️ 링크(http/https 주소)를 찾지 못했습니다.');
} else if (mode === 'remove') {
  for (const url of urls) {
    const before = links.length;
    links = links.filter((l) => !sameUrl(l.url, url));
    report.push(before !== links.length ? `🗑️ 삭제: ${url}` : `ℹ️ 목록에 없는 링크: ${url}`);
  }
} else {
  const customTitle = field(fields, '제목');
  const customSummary = field(fields, '요약');
  const category = field(fields, '분류');
  const sub = field(fields, '세부분류').trim().slice(0, 40);
  const tags = (field(fields, '태그') || '')
    .split(/[,#\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const url of urls) {
    if (links.some((l) => sameUrl(l.url, url))) {
      report.push(`ℹ️ 이미 저장된 링크: ${url}`);
      continue;
    }
    const meta = await describe(url);
    const single = urls.length === 1;
    const entry = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      url,
      ...meta,
      ...(single && customTitle ? { title: customTitle } : {}),
      ...(single && customSummary ? { summary: customSummary } : {}),
      category: normalizeGroup(category, meta.type),
      group: normalizeGroup(category, meta.type),
      ...(sub ? { sub } : {}),
      tags,
      addedAt: new Date().toISOString(),
      ...(issueNumber ? { issue: issueNumber } : {}),
    };
    links.unshift(entry);
    report.push(`✅ 추가: **${entry.title}** (${entry.category})\n   ${url}`);
  }
}

await writeFile(LINKS_PATH, JSON.stringify(links, null, 2) + '\n');
const message = report.join('\n');
console.log(message);
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `report<<__EOF__\n${message}\n__EOF__\n`);
}
