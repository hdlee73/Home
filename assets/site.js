// 내 앱 · 자료 링크 저장소 · 게시판 · 방문자 수 · 버전/업데이트 안내
(() => {
    const GITHUB_OWNER = 'hdlee73';
    const SITE_VERSION = document.querySelector('meta[name="site-version"]')?.content || '0.0.0';
    const LINKS_PAGE_SIZE = 9;

    const esc = (text) => String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const safeUrl = (url) => {
        try {
            const u = new URL(url);
            return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '#';
        } catch {
            return '#';
        }
    };

    const fmtDate = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    };

    const fmtSize = (bytes) => {
        if (!bytes) return '';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        let n = bytes;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
    };

    const fetchJson = async (url) => {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${url} ${res.status}`);
        return res.json();
    };

    // ---------- 내 앱 ----------

    function appCard(app) {
        const rel = app.release;
        const primary = rel?.assets.find((a) => a.name === rel.primaryAsset);
        const downloadUrl = primary?.url || rel?.zipball || null;
        const topics = (app.topics || []).slice(0, 4).map((t) =>
            `<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px]">#${esc(t)}</span>`).join('');
        const otherAssets = rel && rel.assets.length > 1
            ? `<details class="text-[11px] text-slate-500">
                   <summary class="cursor-pointer hover:text-blue-600">다른 파일 ${rel.assets.length - 1}개</summary>
                   <ul class="mt-1.5 space-y-1">
                       ${rel.assets.filter((a) => a.name !== rel.primaryAsset).map((a) => `
                           <li><a href="${safeUrl(a.url)}" class="hover:text-blue-600 hover:underline break-all"><i class="fa-solid fa-file-arrow-down mr-1"></i>${esc(a.name)}</a>
                               <span class="text-slate-400">${fmtSize(a.size)}</span></li>`).join('')}
                   </ul>
               </details>`
            : '';

        return `
            <article class="p-5 rounded-2xl bg-slate-50 border border-slate-100 hover:border-blue-200 transition-all flex flex-col gap-3">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                        <span class="w-10 h-10 flex-shrink-0 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                            ${app.icon ? `<img src="${safeUrl(app.icon)}" alt="" class="w-full h-full rounded-xl object-cover">` : '<i class="fa-solid fa-cube"></i>'}
                        </span>
                        <div class="min-w-0">
                            <h3 class="font-bold text-slate-800 text-sm sm:text-base truncate">${esc(app.name)}</h3>
                            <div class="text-[11px] text-slate-400 flex items-center gap-2">
                                ${app.language ? `<span><i class="fa-solid fa-code mr-0.5"></i>${esc(app.language)}</span>` : ''}
                                ${app.stars ? `<span><i class="fa-solid fa-star text-amber-400 mr-0.5"></i>${app.stars}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    ${rel ? `<span class="flex-shrink-0 text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">${esc(rel.tag)}</span>` : ''}
                </div>
                <p class="text-slate-600 text-xs leading-relaxed flex-1 whitespace-pre-line">${esc(app.description) || '<span class="text-slate-400">설명이 아직 없습니다.</span>'}</p>
                ${topics ? `<div class="flex flex-wrap gap-1">${topics}</div>` : ''}
                ${rel ? `<p class="text-[11px] text-slate-400">최신 릴리스 ${fmtDate(rel.publishedAt)}${primary ? ` · ${esc(primary.name)} ${fmtSize(primary.size)}` : ''}</p>` : ''}
                <div class="flex flex-wrap gap-2 pt-1">
                    ${downloadUrl
                        ? `<a href="${safeUrl(downloadUrl)}" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shadow-sm transition-all">
                               <i class="fa-solid fa-download"></i> 최신 버전 다운로드</a>`
                        : `<span class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-200 text-slate-500 text-xs font-medium">
                               <i class="fa-solid fa-hourglass-half"></i> 릴리스 준비 중</span>`}
                    ${rel ? `<a href="${safeUrl(rel.url)}" target="_blank" rel="noopener" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-blue-300 hover:text-blue-600 text-slate-600 text-xs font-medium transition-all">
                               <i class="fa-solid fa-scroll"></i> 릴리스 노트</a>` : ''}
                    <a href="${safeUrl(app.url)}" target="_blank" rel="noopener" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-blue-300 hover:text-blue-600 text-slate-600 text-xs font-medium transition-all">
                        <i class="fa-brands fa-github"></i> GitHub</a>
                    ${app.homepage ? `<a href="${safeUrl(app.homepage)}" target="_blank" rel="noopener" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-blue-300 hover:text-blue-600 text-slate-600 text-xs font-medium transition-all">
                        <i class="fa-solid fa-globe"></i> 홈페이지</a>` : ''}
                </div>
                ${otherAssets}
            </article>`;
    }

    async function renderApps() {
        const list = document.getElementById('appList');
        const meta = document.getElementById('appMeta');
        if (!list) return;
        try {
            const data = await fetchJson('data/apps.json');
            const apps = data.apps || [];
            if (!apps.length) {
                list.innerHTML = `<p class="col-span-full text-xs text-slate-400 text-center py-6">공개된 앱이 아직 없습니다.</p>`;
                return;
            }
            list.innerHTML = apps.map(appCard).join('');
            meta.textContent = data.updatedAt ? `${apps.length}개 · ${fmtDate(data.updatedAt)} 기준` : `${apps.length}개`;
        } catch (e) {
            console.warn(e);
            list.innerHTML = `<p class="col-span-full text-xs text-slate-400 text-center py-6">
                앱 정보를 불러오지 못했습니다. <a class="text-blue-600 hover:underline" href="https://github.com/${GITHUB_OWNER}?tab=repositories" target="_blank" rel="noopener">GitHub에서 보기</a></p>`;
        }
    }

    // ---------- 자료 링크 저장소 ----------

    const CATEGORY_ORDER = ['유튜브', '블로그', '구글 드라이브', '웹'];
    const linkState = { all: [], category: '전체', query: '', shown: LINKS_PAGE_SIZE };

    // 구글 드라이브: 구글 화면(게시자·수정자 표시 등)을 임베드하지 않고, 설명과 첨부파일 이름만 카드로 보여준다.
    // 파일 이름은 워크플로(scripts/drive-list.mjs)가 data/links.json 의 files 에 저장한다. '링크가 있는 모든 사용자' 공유가 필요하다.
    const DRIVE = {
        folder: { icon: 'fa-solid fa-folder-open', open: (id) => `https://drive.google.com/drive/folders/${id}` },
        file: { icon: 'fa-solid fa-file', open: (id) => `https://drive.google.com/file/d/${id}/view`, download: (id) => `https://drive.google.com/uc?export=download&id=${id}` },
        document: { icon: 'fa-solid fa-file-word', open: (id) => `https://docs.google.com/document/d/${id}/edit`, download: (id) => `https://docs.google.com/document/d/${id}/export?format=pdf` },
        spreadsheets: { icon: 'fa-solid fa-table', open: (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`, download: (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx` },
        presentation: { icon: 'fa-solid fa-display', open: (id) => `https://docs.google.com/presentation/d/${id}/edit`, download: (id) => `https://docs.google.com/presentation/d/${id}/export/pdf` },
    };

    const DRIVE_FILES_SHOWN = 8;

    function fileIcon(name, folder) {
        if (folder) return 'fa-solid fa-folder text-amber-400';
        const ext = (String(name).match(/\.([\w]+)$/) || [])[1]?.toLowerCase() || '';
        if (ext === 'pdf') return 'fa-solid fa-file-pdf text-red-400';
        if (['doc', 'docx', 'hwp', 'hwpx', 'txt'].includes(ext)) return 'fa-solid fa-file-word text-blue-400';
        if (['xls', 'xlsx', 'csv'].includes(ext)) return 'fa-solid fa-file-excel text-emerald-500';
        if (['ppt', 'pptx'].includes(ext)) return 'fa-solid fa-file-powerpoint text-orange-400';
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'fa-solid fa-file-image text-violet-400';
        if (['mp4', 'mov', 'avi', 'mkv', 'mp3', 'wav'].includes(ext)) return 'fa-solid fa-file-video text-pink-400';
        if (['zip', '7z', 'rar'].includes(ext)) return 'fa-solid fa-file-zipper text-slate-400';
        return 'fa-solid fa-file text-slate-400';
    }

    function driveCard(link, tags, footer) {
        const d = DRIVE[link.driveApp] || DRIVE.file;
        const id = link.driveId;
        const files = (Array.isArray(link.files) ? link.files : []).filter((f) => /^[\w-]{10,}$/.test(f?.id || ''));
        const rows = files.slice(0, DRIVE_FILES_SHOWN).map((f) => {
            const href = f.folder ? `https://drive.google.com/drive/folders/${f.id}` : `https://drive.google.com/file/d/${f.id}/view`;
            return `<li><a href="${href}" target="_blank" rel="noopener" class="flex items-center gap-2 py-1.5 text-xs text-slate-700 hover:text-blue-600">
                        <i class="${fileIcon(f.name, f.folder)} w-4 text-center flex-shrink-0"></i><span class="truncate">${esc(f.name)}</span></a></li>`;
        }).join('');
        return `
            <article class="rounded-2xl bg-slate-50 border border-slate-100 hover:border-amber-200 overflow-hidden flex flex-col transition-all">
                <div class="p-4 space-y-2 flex-1 flex flex-col">
                    <span class="self-start text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full"><i class="fa-brands fa-google-drive mr-1"></i>${esc(link.category || '구글 드라이브')}</span>
                    <a href="${d.open(id)}" target="_blank" rel="noopener" class="font-bold text-slate-800 text-sm leading-snug hover:text-blue-600 line-clamp-2"><i class="${d.icon} text-amber-500 mr-1"></i>${esc(link.title)}</a>
                    ${link.summary ? `<p class="text-slate-600 text-xs leading-relaxed line-clamp-3">${esc(link.summary)}</p>` : ''}
                    ${rows ? `<div class="rounded-xl bg-white border border-slate-100 px-3 py-1">
                        <div class="text-[10px] font-semibold text-slate-400 pt-1.5">첨부파일 ${files.length}개</div>
                        <ul class="divide-y divide-slate-50">${rows}</ul>
                        ${files.length > DRIVE_FILES_SHOWN ? `<div class="text-[11px] text-slate-400 py-1.5">외 ${files.length - DRIVE_FILES_SHOWN}개 · 폴더 열기에서 전체 보기</div>` : ''}
                    </div>` : ''}
                    ${tags ? `<div class="flex flex-wrap gap-1">${tags}</div>` : ''}
                    <div class="mt-auto pt-1 space-y-2">
                        ${footer}
                        <div class="flex flex-wrap gap-3 text-xs font-medium">
                            <a href="${d.open(id)}" target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-700">${link.driveApp === 'folder' ? '폴더 열기' : '열기'} <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i></a>
                            ${d.download ? `<a href="${d.download(id)}" target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-700">다운로드 <i class="fa-solid fa-download text-[10px]"></i></a>` : ''}
                        </div>
                    </div>
                </div>
            </article>`;
    }

    function linkCard(link) {
        const tags = (link.tags || []).map((t) =>
            `<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px]">#${esc(t)}</span>`).join('');
        const footer = `
            <div class="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span class="truncate">${esc(link.site || '')}</span>
                <span class="flex-shrink-0">${fmtDate(link.addedAt)}</span>
            </div>`;

        if (link.type === 'gdrive' && /^[\w-]{10,}$/.test(link.driveId || '')) return driveCard(link, tags, footer);

        if (link.type === 'youtube' && /^[\w-]{6,}$/.test(link.videoId || '')) {
            return `
                <article class="rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden flex flex-col">
                    <div class="relative w-full aspect-video bg-black">
                        <iframe class="absolute inset-0 w-full h-full" loading="lazy"
                                src="https://www.youtube-nocookie.com/embed/${link.videoId}"
                                title="${esc(link.title)}" frameborder="0"
                                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
                    </div>
                    <div class="p-4 space-y-2 flex-1 flex flex-col">
                        <span class="self-start text-[10px] font-semibold bg-red-100 text-red-600 px-2 py-0.5 rounded-full"><i class="fa-brands fa-youtube mr-1"></i>${esc(link.category || '유튜브')}</span>
                        <a href="${safeUrl(link.url)}" target="_blank" rel="noopener" class="font-bold text-slate-800 text-sm leading-snug hover:text-blue-600 line-clamp-2">${esc(link.title)}</a>
                        ${link.summary ? `<p class="text-slate-600 text-xs leading-relaxed line-clamp-3">${esc(link.summary)}</p>` : ''}
                        ${tags ? `<div class="flex flex-wrap gap-1">${tags}</div>` : ''}
                        <div class="mt-auto pt-1">${footer}</div>
                    </div>
                </article>`;
        }

        const badge = link.type === 'blog'
            ? `<span class="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full"><i class="fa-solid fa-pen-nib mr-1"></i>${esc(link.category || '블로그')}</span>`
            : `<span class="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full"><i class="fa-solid fa-link mr-1"></i>${esc(link.category || '웹')}</span>`;
        return `
            <article class="rounded-2xl bg-slate-50 border border-slate-100 hover:border-blue-200 overflow-hidden flex flex-col transition-all">
                ${link.image ? `
                    <a href="${safeUrl(link.url)}" target="_blank" rel="noopener" class="block w-full aspect-video bg-slate-100 overflow-hidden">
                        <img src="${safeUrl(link.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"
                             onerror="this.parentElement.remove()" class="w-full h-full object-cover hover:scale-105 transition-transform duration-300">
                    </a>` : ''}
                <div class="p-4 space-y-2 flex-1 flex flex-col">
                    <span class="self-start">${badge}</span>
                    <a href="${safeUrl(link.url)}" target="_blank" rel="noopener" class="font-bold text-slate-800 text-sm leading-snug hover:text-blue-600 line-clamp-2">${esc(link.title)}</a>
                    ${link.summary ? `<p class="text-slate-600 text-xs leading-relaxed line-clamp-4">${esc(link.summary)}</p>` : ''}
                    ${tags ? `<div class="flex flex-wrap gap-1">${tags}</div>` : ''}
                    <div class="mt-auto pt-1 space-y-2">
                        ${footer}
                        <a href="${safeUrl(link.url)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                            원문 보기 <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i></a>
                    </div>
                </div>
            </article>`;
    }

    function filteredLinks() {
        const q = linkState.query.trim().toLowerCase();
        return linkState.all.filter((l) =>
            (linkState.category === '전체' || l.category === linkState.category) &&
            (!q || [l.title, l.summary, l.site, ...(l.tags || [])].join(' ').toLowerCase().includes(q)));
    }

    function renderLinkFilters() {
        const box = document.getElementById('linkFilters');
        const cats = ['전체', ...new Set(linkState.all.map((l) => l.category).filter(Boolean))];
        box.innerHTML = cats.map((c) => {
            const count = c === '전체' ? linkState.all.length : linkState.all.filter((l) => l.category === c).length;
            const active = c === linkState.category;
            return `<button type="button" data-cat="${esc(c)}"
                        class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700'}">
                        ${esc(c)} <span class="${active ? 'text-blue-100' : 'text-slate-400'}">${count}</span></button>`;
        }).join('');
    }

    function renderLinks() {
        const list = document.getElementById('linkList');
        const more = document.getElementById('linkMore');
        const items = filteredLinks();
        renderLinkFilters();
        if (!items.length) {
            list.innerHTML = `<p class="col-span-full text-xs text-slate-400 text-center py-8">${linkState.all.length ? '조건에 맞는 링크가 없습니다.' : '아직 저장된 링크가 없습니다.'}</p>`;
            more.classList.add('hidden');
            return;
        }
        // 같은 분류끼리 묶어서 분류별 제목 아래에 보여준다 (분류 안에서는 최근에 추가한 순서).
        const order = (c) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? CATEGORY_ORDER.length : i; };
        const shown = items
            .map((l, i) => ({ l, i }))
            .sort((a, b) => order(a.l.category) - order(b.l.category) || String(a.l.category || '').localeCompare(String(b.l.category || '')) || a.i - b.i)
            .map((x) => x.l)
            .slice(0, linkState.shown);
        const groups = [];
        for (const l of shown) {
            const name = l.category || '기타';
            let g = groups.find((x) => x.name === name);
            if (!g) groups.push((g = { name, items: [] }));
            g.items.push(l);
        }
        list.innerHTML = groups.map((g) => `
            <div class="col-span-full flex items-center gap-2 ${g === groups[0] ? '' : 'mt-3'}">
                <h3 class="text-sm font-bold text-slate-700">${esc(g.name)}</h3>
                <span class="text-[11px] text-slate-400">${items.filter((l) => (l.category || '기타') === g.name).length}</span>
                <span class="flex-1 h-px bg-slate-100"></span>
            </div>${g.items.map(linkCard).join('')}`).join('');
        more.classList.toggle('hidden', items.length <= linkState.shown);
    }

    async function initLinks() {
        const list = document.getElementById('linkList');
        if (!list) return;
        document.getElementById('linkFilters').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-cat]');
            if (!btn) return;
            linkState.category = btn.dataset.cat;
            linkState.shown = LINKS_PAGE_SIZE;
            renderLinks();
        });
        document.getElementById('linkSearch').addEventListener('input', (e) => {
            linkState.query = e.target.value;
            linkState.shown = LINKS_PAGE_SIZE;
            renderLinks();
        });
        document.getElementById('linkMore').addEventListener('click', () => {
            linkState.shown += LINKS_PAGE_SIZE;
            renderLinks();
        });
        try {
            linkState.all = await fetchJson('data/links.json');
        } catch (e) {
            console.warn(e);
        }
        renderLinks();
    }

    // ---------- 버전 · 업데이트 내역 · 자동 업데이트 안내 ----------

    let versionInfo = null;

    function renderChangelog() {
        const box = document.getElementById('changelogList');
        if (!versionInfo) return;
        box.innerHTML = (versionInfo.changelog || []).map((entry) => `
            <div class="space-y-1.5">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">v${esc(entry.version)}</span>
                    <span class="text-[11px] text-slate-400">${esc(entry.date)}</span>
                </div>
                <ul class="list-disc pl-5 text-xs text-slate-600 space-y-1">
                    ${(entry.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}
                </ul>
            </div>`).join('');
    }

    async function checkVersion() {
        try {
            versionInfo = await fetchJson(`version.json?t=${Date.now()}`);
            renderChangelog();
            // 배포된 버전이 지금 보고 있는 페이지보다 새로우면 새로고침을 안내한다.
            if (versionInfo.version && versionInfo.version !== SITE_VERSION) {
                document.getElementById('updateBannerVersion').textContent = `v${versionInfo.version}`;
                document.getElementById('updateBanner').classList.remove('hidden');
            }
        } catch (e) {
            console.warn(e);
        }
    }

    function initVersion() {
        document.querySelectorAll('[data-site-version]').forEach((el) => { el.textContent = `v${SITE_VERSION}`; });
        const modal = document.getElementById('changelogModal');
        document.getElementById('changelogBtn').addEventListener('click', () => modal.classList.remove('opacity-0', 'pointer-events-none'));
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.closest('[data-close]')) modal.classList.add('opacity-0', 'pointer-events-none');
        });
        document.getElementById('updateReloadBtn').addEventListener('click', () => location.reload());
        checkVersion();
        setInterval(checkVersion, 10 * 60 * 1000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
    }

    // ---------- 페이지 구분 (주소 #profile · #apps · #links, 뒤로가기는 직전 페이지) ----------

    // ---------- 게시판: 공지(data/notices.json) + 방문자 글(구글 설문지 → 응답 시트) ----------

    const BOARD_PAGE_SIZE = 10;
    let boardConfig = null;
    let boardPosts = [];
    let boardShown = BOARD_PAGE_SIZE;

    async function renderNotices() {
        const box = document.getElementById('noticeList');
        if (!box) return;
        let notices = [];
        try {
            notices = await fetchJson('data/notices.json');
        } catch {}
        notices.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
        box.innerHTML = notices.length
            ? notices.map((n) => `
                <li>
                    <details class="group py-3">
                        <summary class="flex items-center gap-2 cursor-pointer list-none">
                            ${n.pinned ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-semibold flex-shrink-0">고정</span>' : ''}
                            <span class="flex-1 min-w-0 text-sm font-semibold text-slate-800 truncate">${esc(n.title)}</span>
                            <span class="text-[11px] text-slate-400 flex-shrink-0">${fmtDate(n.createdAt)}</span>
                            <i class="fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform group-open:rotate-180"></i>
                        </summary>
                        ${n.body ? `<p class="mt-2 text-sm text-slate-600 leading-relaxed whitespace-pre-line break-words">${esc(n.body)}</p>` : ''}
                    </details>
                </li>`).join('')
            : '<li class="text-xs text-slate-400 text-center py-6">아직 공지가 없습니다.</li>';
    }

    const sheetId = (url) => (String(url || '').match(/\/spreadsheets\/d\/([\w-]{20,})/) || [])[1] || null;

    function formEmbedUrl(url) {
        try {
            const u = new URL(url);
            if (u.hostname !== 'docs.google.com' || !u.pathname.startsWith('/forms/d/')) return null;
            u.pathname = u.pathname.replace(/\/(viewform|edit|formResponse)?\/?$/, '/viewform');
            u.search = '?embedded=true';
            u.hash = '';
            return u.toString();
        } catch {
            return null;
        }
    }

    // 공개된 시트는 Google Visualization 응답(JSONP)으로 읽는다. CORS·API 키가 필요 없다.
    function loadSheet(id) {
        return new Promise((resolve, reject) => {
            const cb = `__boardSheet${Date.now()}`;
            const script = document.createElement('script');
            const done = () => { delete window[cb]; script.remove(); clearTimeout(timer); };
            const timer = setTimeout(() => { done(); reject(new Error('timeout')); }, 15000);
            window[cb] = (res) => {
                done();
                if (res?.status === 'error') reject(new Error('sheet'));
                else resolve(res.table);
            };
            script.onerror = () => { done(); reject(new Error('network')); };
            script.src = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?headers=1&tqx=responseHandler:${cb}&_=${Date.now()}`;
            document.head.appendChild(script);
        });
    }

    const cellText = (c) => (c == null ? '' : String(c.f ?? c.v ?? '').trim());

    function cellTime(c) {
        const m = String(c?.v ?? '').match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+)(?:,(\d+))?)?\)$/);
        return m ? new Date(m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0) : null;
    }

    function tableToPosts(table, moderation) {
        const labels = table.cols.map((c) => String(c.label || '').trim().toLowerCase());
        const find = (words, fallback) => {
            const i = labels.findIndex((l) => words.some((w) => l.includes(w)));
            return i >= 0 ? i : fallback;
        };
        const iTime = find(['타임스탬프', 'timestamp'], 0);
        const iName = find(['이름', '닉네임', 'name'], 1);
        const iBody = find(['내용', '글', 'message', 'content'], 2);
        const iShow = find(['공개', 'approve'], -1);
        const iHide = find(['숨김', 'hide'], -1);
        return table.rows
            .map((r) => r.c || [])
            .filter((c) => cellText(c[iBody]))
            .filter((c) => !(iHide >= 0 && cellText(c[iHide])))
            .filter((c) => !moderation || (iShow >= 0 && /^(o|y|yes|공개|ㅇ|v|✔|true)$/i.test(cellText(c[iShow]))))
            .map((c) => ({ time: cellTime(c[iTime]), timeText: cellText(c[iTime]), name: cellText(c[iName]) || '방문자', body: cellText(c[iBody]).slice(0, 3000) }))
            .sort((a, b) => (b.time || 0) - (a.time || 0));
    }

    function renderBoardPosts() {
        const box = document.getElementById('boardPostList');
        const list = boardPosts.slice(0, boardShown);
        box.innerHTML = boardPosts.length
            ? list.map((p) => `
                <li class="py-4">
                    <div class="flex items-center gap-2 mb-1.5">
                        <span class="w-7 h-7 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center text-[11px] font-bold flex-shrink-0">${esc(p.name.slice(0, 1))}</span>
                        <span class="text-sm font-semibold text-slate-800 truncate">${esc(p.name.slice(0, 30))}</span>
                        <span class="text-[11px] text-slate-400 ml-auto flex-shrink-0">${p.time ? `${fmtDate(p.time)} ${String(p.time.getHours()).padStart(2, '0')}:${String(p.time.getMinutes()).padStart(2, '0')}` : esc(p.timeText)}</span>
                    </div>
                    <p class="text-sm text-slate-600 leading-relaxed whitespace-pre-line break-words pl-9">${esc(p.body)}</p>
                </li>`).join('') + (boardPosts.length > boardShown
                ? '<li class="pt-4 text-center"><button type="button" data-board-more class="text-xs px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium">더 보기</button></li>'
                : '')
            : `<li class="text-xs text-slate-400 text-center py-6">${boardConfig?.moderation ? '아직 공개된 글이 없습니다. 첫 글을 남겨 주세요!' : '아직 글이 없습니다. 첫 글을 남겨 주세요!'}</li>`;
    }

    async function loadBoardPosts() {
        const box = document.getElementById('boardPostList');
        const id = sheetId(boardConfig?.sheetUrl);
        if (!id) {
            box.innerHTML = '<li class="text-xs text-slate-400 text-center py-6">방문자 게시판을 준비하고 있습니다.</li>';
            return;
        }
        box.innerHTML = '<li class="text-xs text-slate-400 text-center py-6"><i class="fa-solid fa-spinner fa-spin mr-1"></i> 불러오는 중...</li>';
        try {
            boardPosts = tableToPosts(await loadSheet(id), !!boardConfig.moderation);
            renderBoardPosts();
        } catch {
            box.innerHTML = '<li class="text-xs text-slate-400 text-center py-6">글 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</li>';
        }
    }

    async function initBoard() {
        if (!document.getElementById('board')) return;
        renderNotices();
        try {
            boardConfig = await fetchJson('data/board-config.json');
        } catch {
            boardConfig = {};
        }
        const embed = formEmbedUrl(boardConfig.formUrl);
        const writeBtn = document.getElementById('boardWriteBtn');
        writeBtn.classList.toggle('hidden', !embed);
        const box = document.getElementById('boardWriteBox');
        const frame = document.getElementById('boardFormFrame');
        let frameLoads = 0;
        const closeWrite = () => {
            box.classList.add('hidden');
            frame.removeAttribute('src');
        };
        writeBtn.addEventListener('click', () => {
            if (!box.classList.contains('hidden')) return closeWrite();
            frameLoads = 0;
            frame.src = embed;
            box.classList.remove('hidden');
            box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        // 설문지 화면이 두 번째로 불러와지면(첫 번째는 양식, 두 번째는 '응답이 기록되었습니다') 제출된 것으로 보고 목록으로 돌아온다.
        // 시트에 글이 들어가는 데 몇 초 걸려서 목록을 두 번 읽는다.
        frame.addEventListener('load', () => {
            if (!frame.getAttribute('src') || ++frameLoads < 2) return;
            closeWrite();
            if (window.showToast) window.showToast('✅ 글이 등록되었습니다.');
            document.getElementById('boardPostList').scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(loadBoardPosts, 2000);
            setTimeout(loadBoardPosts, 7000);
        });
        document.getElementById('boardRefreshBtn').addEventListener('click', () => { renderNotices(); loadBoardPosts(); });
        document.getElementById('boardPostList').addEventListener('click', (e) => {
            if (!e.target.closest('[data-board-more]')) return;
            boardShown += BOARD_PAGE_SIZE;
            renderBoardPosts();
        });
        loadBoardPosts();
    }

    // ---------- 방문자 수 (구글 애널리틱스: data/analytics.json 의 측정 ID로 켠다) ----------

    async function initAnalytics() {
        let id = '';
        try {
            id = ((await fetchJson('data/analytics.json')).ga || '').trim().toUpperCase();
        } catch {}
        if (!/^G-[A-Z0-9]{4,20}$/.test(id) || ['localhost', '127.0.0.1'].includes(location.hostname)) return;
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
        document.head.appendChild(script);
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', id);
    }

    const PAGES = { profile: '이력', apps: '내 앱', links: '자료실', board: '게시판' };
    const BASE_TITLE = document.title;

    function route() {
        const hash = decodeURIComponent(location.hash.slice(1));
        const page = hash === 'inquiry' ? 'profile' : (PAGES[hash] ? hash : 'profile');
        document.querySelectorAll('[data-page]').forEach((el) => el.classList.toggle('hidden', el.dataset.page !== page));
        document.querySelectorAll('[data-nav]').forEach((el) => {
            const active = el.dataset.nav === (hash === 'inquiry' ? 'inquiry' : page);
            el.classList.toggle('ring-2', active);
            el.classList.toggle('ring-blue-500', active);
            el.classList.toggle('bg-blue-50', active);
            el.classList.toggle('bg-white', !active);
            if (active) el.setAttribute('aria-current', 'page');
            else el.removeAttribute('aria-current');
        });
        document.title = page === 'profile' ? BASE_TITLE : `${PAGES[page]} - ${BASE_TITLE}`;
        if (hash === 'inquiry') document.getElementById('inquiry')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else window.scrollTo(0, 0);
    }

    window.addEventListener('hashchange', route);

    document.addEventListener('DOMContentLoaded', () => {
        route();
        renderApps();
        initLinks();
        initBoard();
        initAnalytics();
        initVersion();
    });
})();
