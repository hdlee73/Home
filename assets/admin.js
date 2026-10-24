// 관리자: 홈페이지에서 '내 앱'에 노출할 앱을 고르고, 자료실 링크를 추가·삭제한다.
// 페이지 소스에는 비밀번호도 토큰도 없다. 관리자가 처음 한 번 GitHub 토큰(이 저장소 Contents 읽기/쓰기만)을 넣으면
// 관리자가 정한 비밀번호로 암호화(PBKDF2 + AES-GCM)해 그 브라우저에만 저장하고, 이후에는 비밀번호로 잠금을 푼다.
// 앱 선택은 data/apps-config.json 을, 링크 삭제는 data/links.json 을, 공지는 data/notices.json 을,
// 방문자 게시판·방문자 수 설정은 data/board-config.json·data/analytics.json 을 바로 커밋한다.
// 링크 추가는 브라우저에서 다른 사이트의 제목·요약을 읽을 수 없으므로 data/link-requests/ 에 요청 파일을 커밋하고,
// '링크 요청 처리' 워크플로가 제목·요약을 가져와 links.json 에 넣는다. 모두 1~2분 뒤 홈페이지에 반영된다.
(() => {
    const OWNER = 'hdlee73';
    const REPO = 'Resume_LHD';
    const CONFIG_PATH = 'data/apps-config.json';
    const LINKS_PATH = 'data/links.json';
    const REQUEST_DIR = 'data/link-requests';
    const NOTICES_PATH = 'data/notices.json';
    const BOARD_PATH = 'data/board-config.json';
    const ANALYTICS_PATH = 'data/analytics.json';
    const VAULT_KEY = 'hdlee_admin_vault_v1';
    const PBKDF2_ITERATIONS = 600000;

    let token = null;      // 잠금 해제된 동안 메모리에만 둔다
    let selected = [];     // 노출할 저장소 이름 (순서 = 표시 순서)
    let repos = [];        // 고를 수 있는 공개 저장소
    let intros = {};       // 저장소 이름(소문자) → 관리자가 쓴 소개 문구
    let target = 'apps';   // 잠금 해제 후 열 화면: apps | links | board

    const $ = (id) => document.getElementById(id);
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
    const toast = (msg) => (window.showToast ? window.showToast(msg) : alert(msg));

    // ---------- 암호화 금고 (이 브라우저의 localStorage) ----------

    const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

    async function deriveKey(password, salt) {
        const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
            base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }

    async function saveVault(secret, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt);
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));
        localStorage.setItem(VAULT_KEY, JSON.stringify({ salt: b64(salt), iv: b64(iv), data: b64(data) }));
    }

    async function openVault(password) {
        const v = JSON.parse(localStorage.getItem(VAULT_KEY));
        const key = await deriveKey(password, unb64(v.salt));
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.data));
        return new TextDecoder().decode(plain);
    }

    const hasVault = () => {
        try { return !!localStorage.getItem(VAULT_KEY); } catch { return false; }
    };

    // ---------- GitHub API ----------

    async function gh(path, options = {}) {
        const res = await fetch(`https://api.github.com${path}`, {
            ...options,
            headers: {
                Accept: 'application/vnd.github+json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            },
            cache: 'no-store',
        });
        if (!res.ok) {
            const err = new Error(`GitHub ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return res.json();
    }

    const decodeContent = (b) => new TextDecoder().decode(unb64(b.replace(/\n/g, '')));
    const encodeContent = (s) => b64(new TextEncoder().encode(s));

    async function readJson(path) {
        const file = await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=main`);
        return { sha: file.sha, data: JSON.parse(decodeContent(file.content)) };
    }

    function writeJson(path, data, sha, message) {
        return gh(`/repos/${OWNER}/${REPO}/contents/${path}`, {
            method: 'PUT',
            body: JSON.stringify({
                message,
                content: encodeContent(JSON.stringify(data, null, 2) + '\n'),
                branch: 'main',
                ...(sha ? { sha } : {}),
            }),
        });
    }

    async function readConfig() {
        const { sha, data } = await readJson(CONFIG_PATH);
        return { sha, config: data };
    }

    async function loadRepos() {
        const all = [];
        for (let page = 1; page <= 5; page++) {
            const batch = await gh(`/users/${OWNER}/repos?type=owner&per_page=100&page=${page}&sort=pushed`);
            all.push(...batch);
            if (batch.length < 100) break;
        }
        return all
            .filter((r) => !r.private && !r.fork && !r.archived && r.name.toLowerCase() !== REPO.toLowerCase())
            .map((r) => ({ name: r.name, description: r.description || '' }));
    }

    // ---------- 화면 ----------

    function show(view) {
        ['adminSetupView', 'adminLoginView', 'adminPanelView', 'adminLinksView', 'adminBoardView'].forEach((id) => $(id).classList.toggle('hidden', id !== view));
        $('adminModalTitle').textContent = { links: '자료실 링크 관리', board: '게시판 관리' }[target] || '앱 선택 · 소개';
        $('adminAppsModal').classList.remove('opacity-0', 'pointer-events-none');
        const focus = { adminSetupView: 'adminTokenInput', adminLoginView: 'adminPwInput' }[view];
        if (focus) setTimeout(() => $(focus).focus(), 50);
    }

    function close() {
        $('adminAppsModal').classList.add('opacity-0', 'pointer-events-none');
        ['adminTokenInput', 'adminNewPw', 'adminNewPw2', 'adminPwInput', 'adminLinkUrls', 'adminLinkTitle', 'adminLinkSummary', 'adminLinkTags', 'adminNoticeTitle', 'adminNoticeBody'].forEach((id) => { $(id).value = ''; });
        $('adminSetupError').textContent = '';
        $('adminLoginError').textContent = '';
    }

    function renderList() {
        const byName = Object.fromEntries(repos.map((r) => [r.name.toLowerCase(), r]));
        const chosen = selected.map((n) => byName[n.toLowerCase()] || { name: n, description: '(공개 저장소 목록에 없음)' });
        const rest = repos.filter((r) => !selected.some((n) => n.toLowerCase() === r.name.toLowerCase()))
            .sort((a, b) => a.name.localeCompare(b.name));
        $('adminSelectedCount').textContent = `${chosen.length}개 노출 중`;

        const row = (r, i) => {
            const on = i !== null;
            return `
                <li class="p-2.5 rounded-xl border ${on ? 'border-blue-200 bg-blue-50/60' : 'border-slate-100 bg-white'}">
                  <div class="flex items-center gap-2">
                    <input type="checkbox" data-toggle="${esc(r.name)}" ${on ? 'checked' : ''} class="w-4 h-4 accent-blue-600 flex-shrink-0">
                    <div class="flex-1 min-w-0">
                        <div class="text-xs font-semibold text-slate-800 truncate">${on ? `<span class="text-blue-600 mr-1">${i + 1}.</span>` : ''}${esc(r.name)}</div>
                        <div class="text-[11px] text-slate-500 truncate">${esc(r.description) || '설명 없음'}</div>
                    </div>
                    ${on ? `
                        <button type="button" data-up="${i}" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-blue-600 disabled:opacity-30" ${i === 0 ? 'disabled' : ''} aria-label="위로"><i class="fa-solid fa-chevron-up text-[10px]"></i></button>
                        <button type="button" data-down="${i}" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-blue-600 disabled:opacity-30" ${i === chosen.length - 1 ? 'disabled' : ''} aria-label="아래로"><i class="fa-solid fa-chevron-down text-[10px]"></i></button>` : ''}
                  </div>
                  ${on ? `
                    <textarea data-intro="${esc(r.name)}" rows="2" placeholder="앱 소개를 직접 쓰세요. 비워 두면 GitHub 저장소 설명을 씁니다."
                              class="mt-2 w-full text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y">${esc(intros[r.name.toLowerCase()] || '')}</textarea>` : ''}
                </li>`;
        };

        $('adminAppList').innerHTML =
            chosen.map((r, i) => row(r, i)).join('') +
            (rest.length ? `<li class="pt-3 pb-1 text-[11px] font-semibold text-slate-400">숨김 (${rest.length})</li>` : '') +
            rest.map((r) => row(r, null)).join('');
    }

    async function openAppsPanel() {
        show('adminPanelView');
        $('adminAppList').innerHTML = '<li class="text-xs text-slate-400 text-center py-6"><i class="fa-solid fa-spinner fa-spin mr-1"></i> 불러오는 중...</li>';
        try {
            const [{ config }, list] = await Promise.all([readConfig(), loadRepos()]);
            selected = [...(config.show || [])];
            intros = Object.fromEntries(Object.entries(config.overrides || {})
                .filter(([, v]) => v && v.description)
                .map(([k, v]) => [k.toLowerCase(), v.description]));
            repos = list;
            renderList();
        } catch (e) {
            $('adminAppList').innerHTML = `<li class="text-xs text-red-500 text-center py-6">${e.status === 401 || e.status === 403 || e.status === 404
                ? '토큰이 만료되었거나 권한이 없습니다. "토큰 다시 등록"을 눌러 주세요.'
                : '목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}</li>`;
        }
    }

    async function save() {
        const btn = $('adminSaveBtn');
        btn.disabled = true;
        btn.classList.add('opacity-60');
        try {
            const { sha, config } = await readConfig();
            config.show = selected;
            // 노출 중인 앱의 소개 문구를 overrides 에 반영한다 (기존 키의 대소문자는 유지).
            const overrides = config.overrides || {};
            for (const name of selected) {
                const key = Object.keys(overrides).find((k) => k.toLowerCase() === name.toLowerCase()) || name;
                const intro = (intros[name.toLowerCase()] || '').trim();
                const entry = { ...(overrides[key] || {}) };
                if (intro) entry.description = intro;
                else delete entry.description;
                if (Object.keys(entry).length) overrides[key] = entry;
                else delete overrides[key];
            }
            config.overrides = overrides;
            await writeJson(CONFIG_PATH, config, sha, `홈페이지 관리자 화면에서 노출 앱·소개 변경 (${selected.length}개)`);
            close();
            toast('✅ 저장했습니다. 1~2분 뒤 홈페이지에 반영됩니다.');
        } catch (e) {
            toast(e.status === 409 ? '다른 곳에서 먼저 바뀌었습니다. 다시 열어 주세요.' : '저장하지 못했습니다. 토큰 권한(Contents 쓰기)을 확인해 주세요.');
        } finally {
            btn.disabled = false;
            btn.classList.remove('opacity-60');
        }
    }

    async function setup() {
        const t = $('adminTokenInput').value.trim();
        const p1 = $('adminNewPw').value;
        const p2 = $('adminNewPw2').value;
        const err = $('adminSetupError');
        err.textContent = '';
        if (!t) return (err.textContent = 'GitHub 토큰을 입력해 주세요.');
        if (p1.length < 8) return (err.textContent = '비밀번호는 8자 이상으로 정해 주세요.');
        if (p1 !== p2) return (err.textContent = '비밀번호 확인이 일치하지 않습니다.');
        token = t;
        try {
            await readConfig();
        } catch {
            token = null;
            return (err.textContent = '토큰으로 저장소를 읽지 못했습니다. 저장소 선택과 Contents 권한을 확인해 주세요.');
        }
        await saveVault(t, p1);
        openTarget();
    }

    async function login() {
        const err = $('adminLoginError');
        err.textContent = '';
        try {
            token = await openVault($('adminPwInput').value);
            openTarget();
        } catch {
            err.textContent = '비밀번호가 일치하지 않습니다.';
        }
    }

    // ---------- 자료실 링크 ----------

    const fmtDate = (iso) => (iso ? iso.slice(0, 10).replace(/-/g, '.') : '');

    async function loadLinkList() {
        const box = $('adminLinkList');
        box.innerHTML = '<li class="text-xs text-slate-400 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i> 불러오는 중...</li>';
        try {
            const { data } = await readJson(LINKS_PATH);
            $('adminLinkCount').textContent = `${data.length}개`;
            box.innerHTML = data.length
                ? data.map((l) => `
                    <li class="flex items-center gap-2 p-2.5 rounded-xl border border-slate-100 bg-white">
                        <i class="${l.type === 'youtube' ? 'fa-brands fa-youtube text-red-500' : l.type === 'blog' ? 'fa-solid fa-pen-nib text-emerald-500' : l.type === 'gdrive' ? 'fa-brands fa-google-drive text-amber-500' : 'fa-solid fa-link text-blue-500'} text-xs w-4 text-center flex-shrink-0"></i>
                        <div class="flex-1 min-w-0">
                            <div class="text-xs font-semibold text-slate-800 truncate">${esc(l.title)}</div>
                            <div class="text-[11px] text-slate-400 truncate">${esc(l.category || '')} · ${fmtDate(l.addedAt)} · ${esc(l.url)}</div>
                        </div>
                        <button type="button" data-del-link="${esc(l.id)}" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 flex-shrink-0" aria-label="삭제"><i class="fa-solid fa-trash text-[10px]"></i></button>
                    </li>`).join('')
                : '<li class="text-xs text-slate-400 text-center py-4">저장된 링크가 없습니다.</li>';
        } catch (e) {
            box.innerHTML = `<li class="text-xs text-red-500 text-center py-4">${e.status === 401 || e.status === 403 || e.status === 404
                ? '토큰이 만료되었거나 권한이 없습니다. "토큰 다시 등록"을 눌러 주세요.'
                : '목록을 불러오지 못했습니다.'}</li>`;
        }
    }

    function openLinksPanel() {
        show('adminLinksView');
        setTimeout(() => $('adminLinkUrls').focus(), 50);
        loadLinkList();
    }

    async function addLinks() {
        const urls = [...new Set(($('adminLinkUrls').value.match(/https?:\/\/[^\s<>()"'`]+/g) || []))];
        if (!urls.length) return toast('링크 주소(http/https)를 붙여 넣어 주세요.');
        const btn = $('adminLinkAddBtn');
        btn.disabled = true;
        btn.classList.add('opacity-60');
        try {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            await writeJson(`${REQUEST_DIR}/${id}.json`, {
                urls,
                category: $('adminLinkCategory').value,
                title: urls.length === 1 ? $('adminLinkTitle').value.trim() : '',
                summary: urls.length === 1 ? $('adminLinkSummary').value.trim() : '',
                tags: $('adminLinkTags').value.split(/[,#\s]+/).map((t) => t.trim()).filter(Boolean),
                requestedAt: new Date().toISOString(),
            }, null, `홈페이지에서 링크 추가 요청 (${urls.length}개)`);
            ['adminLinkUrls', 'adminLinkTitle', 'adminLinkSummary', 'adminLinkTags'].forEach((i) => { $(i).value = ''; });
            toast(`✅ 링크 ${urls.length}개를 보냈습니다. 제목·요약을 가져와 1~2분 뒤 자료실에 올라갑니다.`);
        } catch {
            toast('보내지 못했습니다. 토큰 권한(Contents 쓰기)을 확인해 주세요.');
        } finally {
            btn.disabled = false;
            btn.classList.remove('opacity-60');
        }
    }

    async function deleteLink(id) {
        if (!confirm('이 링크를 자료실에서 삭제할까요?')) return;
        try {
            const { sha, data } = await readJson(LINKS_PATH);
            const removed = data.find((l) => l.id === id);
            if (!removed) return loadLinkList();
            await writeJson(LINKS_PATH, data.filter((l) => l.id !== id), sha, `홈페이지에서 링크 삭제: ${removed.title}`.slice(0, 100));
            toast('🗑️ 삭제했습니다. 1~2분 뒤 자료실에서 사라집니다.');
            loadLinkList();
        } catch (e) {
            toast(e.status === 409 ? '목록이 방금 바뀌었습니다. 다시 시도해 주세요.' : '삭제하지 못했습니다.');
            loadLinkList();
        }
    }

    // ---------- 게시판: 공지 · 방문자 게시판 · 방문자 수 ----------

    const authError = (e) => e.status === 401 || e.status === 403 || e.status === 404;

    async function loadNoticeList() {
        const box = $('adminNoticeList');
        box.innerHTML = '<li class="text-xs text-slate-400 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i> 불러오는 중...</li>';
        try {
            const { data } = await readJson(NOTICES_PATH);
            $('adminNoticeCount').textContent = `${data.length}개`;
            box.innerHTML = data.length
                ? data.map((n) => `
                    <li class="flex items-center gap-2 p-2.5 rounded-xl border border-slate-100 bg-white">
                        <i class="fa-solid ${n.pinned ? 'fa-thumbtack text-violet-500' : 'fa-bullhorn text-slate-400'} text-xs w-4 text-center flex-shrink-0"></i>
                        <div class="flex-1 min-w-0">
                            <div class="text-xs font-semibold text-slate-800 truncate">${esc(n.title)}</div>
                            <div class="text-[11px] text-slate-400">${fmtDate(n.createdAt)}</div>
                        </div>
                        <button type="button" data-del-notice="${esc(n.id)}" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 flex-shrink-0" aria-label="삭제"><i class="fa-solid fa-trash text-[10px]"></i></button>
                    </li>`).join('')
                : '<li class="text-xs text-slate-400 text-center py-4">올린 공지가 없습니다.</li>';
        } catch (e) {
            box.innerHTML = `<li class="text-xs text-red-500 text-center py-4">${authError(e)
                ? '토큰이 만료되었거나 권한이 없습니다. "토큰 다시 등록"을 눌러 주세요.'
                : '목록을 불러오지 못했습니다.'}</li>`;
        }
    }

    async function loadBoardSettings() {
        try {
            const [{ data: board }, { data: stats }] = await Promise.all([readJson(BOARD_PATH), readJson(ANALYTICS_PATH)]);
            $('adminFormUrl').value = board.formUrl || '';
            $('adminSheetUrl').value = board.sheetUrl || '';
            $('adminModeration').checked = !!board.moderation;
            $('adminGaId').value = stats.ga || '';
            updateStatsLink();
        } catch {}
    }

    function updateStatsLink() {
        const id = $('adminGaId').value.trim();
        $('adminStatsLink').classList.toggle('hidden', !id);
        $('adminStatsLink').href = 'https://analytics.google.com';
    }

    function openBoardPanel() {
        show('adminBoardView');
        setTimeout(() => $('adminNoticeTitle').focus(), 50);
        loadNoticeList();
        loadBoardSettings();
    }

    async function addNotice() {
        const title = $('adminNoticeTitle').value.trim();
        const body = $('adminNoticeBody').value.trim();
        if (!title) return toast('공지 제목을 넣어 주세요.');
        const btn = $('adminNoticeAddBtn');
        btn.disabled = true;
        btn.classList.add('opacity-60');
        try {
            const { sha, data } = await readJson(NOTICES_PATH);
            const notice = {
                id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                title,
                body,
                pinned: $('adminNoticePinned').checked,
                createdAt: new Date().toISOString(),
            };
            await writeJson(NOTICES_PATH, [notice, ...data], sha, `홈페이지에서 공지 추가: ${title}`.slice(0, 100));
            $('adminNoticeTitle').value = '';
            $('adminNoticeBody').value = '';
            $('adminNoticePinned').checked = false;
            toast('✅ 공지를 올렸습니다. 1~2분 뒤 게시판에 나타납니다.');
            loadNoticeList();
        } catch (e) {
            toast(e.status === 409 ? '목록이 방금 바뀌었습니다. 다시 시도해 주세요.' : '올리지 못했습니다. 토큰 권한(Contents 쓰기)을 확인해 주세요.');
        } finally {
            btn.disabled = false;
            btn.classList.remove('opacity-60');
        }
    }

    async function deleteNotice(id) {
        if (!confirm('이 공지를 삭제할까요?')) return;
        try {
            const { sha, data } = await readJson(NOTICES_PATH);
            const removed = data.find((n) => n.id === id);
            if (!removed) return loadNoticeList();
            await writeJson(NOTICES_PATH, data.filter((n) => n.id !== id), sha, `홈페이지에서 공지 삭제: ${removed.title}`.slice(0, 100));
            toast('🗑️ 삭제했습니다. 1~2분 뒤 게시판에서 사라집니다.');
            loadNoticeList();
        } catch (e) {
            toast(e.status === 409 ? '목록이 방금 바뀌었습니다. 다시 시도해 주세요.' : '삭제하지 못했습니다.');
            loadNoticeList();
        }
    }

    async function saveBoardSettings() {
        const formUrl = $('adminFormUrl').value.trim();
        const sheetUrl = $('adminSheetUrl').value.trim();
        const gaId = $('adminGaId').value.trim().toUpperCase();
        if (formUrl && !/^https:\/\/docs\.google\.com\/forms\/d\//.test(formUrl)) return toast('설문지 주소는 https://docs.google.com/forms/d/... 형식이어야 합니다. (보내기 → 링크에서 URL 단축을 끄세요)');
        if (sheetUrl && !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]{20,}/.test(sheetUrl)) return toast('시트 주소는 https://docs.google.com/spreadsheets/d/... 형식이어야 합니다.');
        if (gaId && !/^G-[A-Z0-9]{4,20}$/.test(gaId)) return toast('측정 ID는 G-로 시작합니다. (예: G-AB12CD34EF)');
        const btn = $('adminBoardSaveBtn');
        btn.disabled = true;
        btn.classList.add('opacity-60');
        try {
            const [board, stats] = await Promise.all([readJson(BOARD_PATH), readJson(ANALYTICS_PATH)]);
            const nextBoard = { ...board.data, formUrl, sheetUrl, moderation: $('adminModeration').checked };
            if (JSON.stringify(nextBoard) !== JSON.stringify(board.data)) {
                await writeJson(BOARD_PATH, nextBoard, board.sha, '홈페이지에서 방문자 게시판 설정 변경');
            }
            if (gaId !== (stats.data.ga || '')) {
                await writeJson(ANALYTICS_PATH, { ga: gaId }, stats.sha, '홈페이지에서 방문자 수 설정 변경');
            }
            updateStatsLink();
            toast('✅ 저장했습니다. 1~2분 뒤 홈페이지에 반영됩니다.');
        } catch (e) {
            toast(e.status === 409 ? '설정이 방금 바뀌었습니다. 다시 시도해 주세요.' : '저장하지 못했습니다. 토큰 권한(Contents 쓰기)을 확인해 주세요.');
        } finally {
            btn.disabled = false;
            btn.classList.remove('opacity-60');
        }
    }

    function openTarget() {
        if (target === 'links') openLinksPanel();
        else if (target === 'board') openBoardPanel();
        else openAppsPanel();
    }

    function openFor(which) {
        target = which;
        if (token) openTarget();
        else show(hasVault() ? 'adminLoginView' : 'adminSetupView');
    }

    function reset() {
        if (!confirm('이 브라우저에 저장된 관리자 토큰을 지우고 다시 등록할까요?')) return;
        try { localStorage.removeItem(VAULT_KEY); } catch {}
        token = null;
        show('adminSetupView');
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!$('adminAppsBtn')) return;
        $('adminAppsBtn').addEventListener('click', () => openFor('apps'));
        $('linkAdminBtn').addEventListener('click', () => openFor('links'));
        $('adminLinkAddBtn').addEventListener('click', addLinks);
        $('boardAdminBtn').addEventListener('click', () => openFor('board'));
        $('adminNoticeAddBtn').addEventListener('click', addNotice);
        $('adminBoardSaveBtn').addEventListener('click', saveBoardSettings);
        $('adminGaId').addEventListener('input', updateStatsLink);
        $('adminNoticeList').addEventListener('click', (e) => {
            const del = e.target.closest('[data-del-notice]');
            if (del) deleteNotice(del.dataset.delNotice);
        });
        $('adminLinkList').addEventListener('click', (e) => {
            const del = e.target.closest('[data-del-link]');
            if (del) deleteLink(del.dataset.delLink);
        });
        $('adminAppsModal').addEventListener('click', (e) => {
            if (e.target.id === 'adminAppsModal' || e.target.closest('[data-admin-close]')) close();
        });
        $('adminSetupBtn').addEventListener('click', setup);
        $('adminLoginBtn').addEventListener('click', login);
        $('adminPwInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
        $('adminSaveBtn').addEventListener('click', save);
        document.querySelectorAll('[data-admin-lock]').forEach((b) => b.addEventListener('click', () => { token = null; close(); toast('🔒 관리자 화면을 잠갔습니다.'); }));
        document.querySelectorAll('[data-admin-reset]').forEach((b) => b.addEventListener('click', reset));
        $('adminAppList').addEventListener('click', (e) => {
            const up = e.target.closest('[data-up]');
            const down = e.target.closest('[data-down]');
            if (up || down) {
                const i = Number((up || down).dataset[up ? 'up' : 'down']);
                const j = up ? i - 1 : i + 1;
                [selected[i], selected[j]] = [selected[j], selected[i]];
                renderList();
            }
        });
        $('adminAppList').addEventListener('input', (e) => {
            const name = e.target.dataset.intro;
            if (name) intros[name.toLowerCase()] = e.target.value;
        });
        $('adminAppList').addEventListener('change', (e) => {
            const name = e.target.dataset.toggle;
            if (!name) return;
            selected = e.target.checked
                ? [...selected, name]
                : selected.filter((n) => n.toLowerCase() !== name.toLowerCase());
            renderList();
        });
    });
})();
