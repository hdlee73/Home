// data/links.json 의 구글 드라이브 폴더 링크마다 파일 이름 목록(files)을 새로 읽어 저장한다.
// 폴더에 파일을 추가·삭제해도 주기적으로 반영되도록 워크플로가 호출한다.
import { readFile, writeFile } from 'node:fs/promises';
import { listDriveFolder } from './drive-list.mjs';

const LINKS_PATH = 'data/links.json';
const links = JSON.parse(await readFile(LINKS_PATH, 'utf8'));
let changed = 0;

for (const link of links) {
  if (link.type !== 'gdrive' || link.driveApp !== 'folder') continue;
  const files = await listDriveFolder(link.driveId);
  if (!files) continue;
  if (JSON.stringify(files) !== JSON.stringify(link.files || null)) {
    link.files = files;
    changed++;
  }
  console.log(`${link.title}: ${files.length}개`);
}

if (changed) await writeFile(LINKS_PATH, JSON.stringify(links, null, 2) + '\n');
console.log(`변경 ${changed}건`);
