// GitHub 이슈로 받은 링크를 data/links.json 에 추가하거나 삭제한다.
// 유튜브는 oEmbed 로 제목을, 그 밖의 링크는 Open Graph 메타데이터로 제목·요약·대표 이미지를 가져온다.
// 사용: node scripts/manage-links.mjs add|remove  (ISSUE_BODY, ISSUE_NUMBER 환경변수 사용)
import { readFile, writeFile, appendFile } from 'node:fs/promises';

const LINKS_PATH = 'data/links.json';
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

async function describe(url) {
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

const fields = parseIssueForm(body);
const urlSource = Object.keys(fields).length ? field(fields, '링크') || body : body;
const urls = extractUrls(urlSource);

let links = [];
try {
  links = JSON.parse(await readFile(LINKS_PATH, 'utf8'));
} catch {}

const report = [];
const sameUrl = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

if (!urls.length) {
  report.push('⚠️ 이슈 내용에서 링크(http/https 주소)를 찾지 못했습니다.');
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
      category: category && category !== '자동' ? category : meta.type === 'youtube' ? '유튜브' : meta.type === 'blog' ? '블로그' : '웹',
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
