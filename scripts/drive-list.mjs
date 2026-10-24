// 공유된 구글 드라이브 폴더의 파일 이름 목록을 읽는다. API 키 없이 공개 임베드 화면(embeddedfolderview)을 파싱한다.
// 결과: [{ id, name, folder }] — 읽지 못하면 null (기존 값을 유지하도록 호출한 쪽에서 처리).
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

export function parseFolderHtml(html) {
  const files = [];
  const parts = html.split(/id="entry-/).slice(1);
  for (const part of parts) {
    const id = part.match(/^([\w-]{10,})"/)?.[1];
    const name = part.match(/class="flip-entry-title"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    if (!id || !name) continue;
    const head = part.slice(0, 1500);
    files.push({ id, name: decode(name.replace(/<[^>]+>/g, '')), folder: /\/folders\//.test(head) });
  }
  return files;
}

export async function listDriveFolder(folderId) {
  try {
    const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (/accounts\.google\.com\/(ServiceLogin|v3\/signin)/.test(res.url)) return null;
    return parseFolderHtml(html);
  } catch (e) {
    console.warn(`드라이브 폴더 목록을 읽지 못함: ${folderId} (${e.message})`);
    return null;
  }
}
