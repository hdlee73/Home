# 이현덕 개인 홈페이지

- 만든이: 이현덕 (hdlee73@gmail.com)
- 현재 버전: v2.1.0 (업데이트 내역은 `version.json`)

정적 페이지(`index.html`)이며 GitHub Pages로 배포합니다. 별도 서버나 API 키가 필요 없습니다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 홈페이지 본문 (이력, 내 앱, 자료실, 문의) |
| `assets/site.js` | 내 앱·자료실 표시, 업데이트 내역, 새 버전 안내 |
| `version.json` | 사이트 이름·버전·업데이트 내역 |
| `data/apps.json` | 공개 앱 목록 (자동 생성) |
| `data/apps-config.json` | 앱 목록에서 뺄 저장소, 이름·설명 덮어쓰기 |
| `data/links.json` | 자료실 링크 목록 (자동 생성) |

## 내 앱

`앱 목록 갱신` 워크플로가 6시간마다 공개 저장소와 각 저장소의 **최신 릴리스**를 읽어 `data/apps.json`에 저장합니다.
바로 반영하려면 GitHub의 **Actions → 앱 목록 갱신 → Run workflow**를 누르세요.

- 다운로드 버튼은 릴리스 파일 중 `.apk`, `.exe`, `.msi`, `.dmg`, `.zip` 순으로 대표 파일을 고릅니다.
- 소개 문구는 저장소의 About(Description)을 씁니다. 따로 쓰고 싶으면 `data/apps-config.json`의 `overrides`에 저장소 이름으로 적습니다.
- 목록에서 숨길 저장소는 `exclude`에 넣거나 `overrides`에서 `"hidden": true`로 지정합니다.

## 자료실 (링크 추가·삭제)

1. 홈페이지 자료실의 **링크 추가 (관리자)** 버튼을 누르거나, 저장소의 **Issues → New issue → 🔗 링크 추가**를 엽니다.
2. 링크 주소를 붙여 넣고 제출합니다. 여러 개면 한 줄에 하나씩 넣습니다. 제목·요약은 비워 두면 자동으로 가져옵니다.
3. 1~2분 뒤 워크플로가 `data/links.json`에 저장하고, 결과를 댓글로 남긴 뒤 이슈를 닫습니다.

- 유튜브 링크(`youtube.com/watch`, `youtu.be`, `shorts`)는 영상 플레이어가 바로 표시됩니다.
- 블로그·웹 링크는 Open Graph 정보로 제목, 요약, 대표 이미지, 원문 링크 카드를 만듭니다. 네이버 블로그도 지원합니다.
- 삭제는 **🗑️ 링크 삭제** 이슈에 주소를 넣으면 됩니다.
- **저장소 주인(hdlee73)이 연 이슈만** 처리되므로 다른 사람이 이슈를 열어도 홈페이지는 바뀌지 않습니다.

## 버전 올리기

배포할 때 `version.json`의 `version`과 `changelog`, 그리고 `index.html`의 `<meta name="site-version">` 값을 같은 버전으로 올립니다.
이미 페이지를 열어 둔 방문자에게는 상단에 새로고침 안내가 표시됩니다.

## 보안

- 워크플로는 Actions가 자동 발급하는 `GITHUB_TOKEN`만 사용하며, 저장소에 키나 비밀번호를 넣지 않습니다. 추가 키가 필요해지면 **Settings → Secrets and variables → Actions**에 등록합니다.
- 저장소에 푸시할 수 있는 사람은 저장소 주인뿐이므로 다른 사람이 사이트를 바꿔 배포할 수 없습니다.

## 문의 남기기

문의 양식은 [FormSubmit](https://formsubmit.co)을 통해 hdlee73@gmail.com 으로 메일을 보냅니다. 내용은 홈페이지에 저장되거나 표시되지 않습니다.
**처음 한 번** 문의가 들어오면 FormSubmit에서 확인(Activate) 메일이 오며, 그 메일의 버튼을 눌러야 이후 문의가 전달됩니다.
전송에 실패하면 방문자의 메일 앱이 열려 같은 내용을 직접 보낼 수 있습니다.
