// 관리자: 홈페이지에서 'My Apps'에 노출할 앱을 고르고, 자료실 링크를 추가·삭제한다.
// 페이지 소스에는 비밀번호도 토큰도 없다. 관리자가 처음 한 번 GitHub 토큰(이 저장소 Contents 읽기/쓰기만)을 넣으면
// 관리자가 정한 비밀번호로 암호화(PBKDF2 + AES-GCM)해 그 브라우저에만 저장하고, 이후에는 비밀번호로 잠금을 푼다.
// 앱 선택은 data/apps-config.json 을, 링크 삭제는 data/links.json 을, 공지는 data/notices.json 을,
// 방문자 게시판·방문자 수 설정은 data/board-config.json·data/analytics.json 을 바로 커밋한다.
// 링크 추가는 브라우저에서 다른 사이트의 제목·요약을 읽을 수 없으므로 data/link-requests/ 에 요청 파일을 커밋하고,
// '링크 요청 처리' 워크플로가 제목·요약을 가져와 links.json 에 넣는다. 모두 1~2분 뒤 홈페이지에 반영된다.
(() => {
    const OWNER = 'hdlee73';
    const REPO = 'Home';
    const CONFIG_PATH = 'data/apps-config.json';
    const LINKS_PATH = 'data/links.json';
    const REQUEST_DIR = 'data/link-requests';
    const NOTICES_PATH = 'data/notices.json';
    const BOARD_PATH = 'data/board-config.json';
    const ANALYTICS_PATH = 'data/analytics.json';
    const PROFILE_PATH = 'data/profile.json';
    const PHOTO_PATH = 'assets/profile.jpg';
    const RESUME_PATH = 'resume.pdf';
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
        ['adminSetupView', 'adminLoginView', 'adminPanelView', 'adminLinksView', 'adminBoardView', 'adminProfileView'].forEach((id) => $(id).classList.toggle('hidden', id !== view));
        $('adminModalTitle').textContent = { links: '자료실 링크 관리', board: '게시판 관리', profile: '사진 · 이력서 변경' }[target] || '앱 선택 · 소개';
        $('adminAppsModal').classList.remove('opacity-0', 'pointer-events-none');
        const focus = { adminSetupView: 'adminTokenInput', adminLoginView: 'adminPwInput' }[view];
        if (focus) setTimeout(() => $(focus).focus(), 50);
    }

    function close() {
        $('adminAppsModal').classList.add('opacity-0', 'pointer-events-none');
        ['adminTokenInput', 'adminNewPw', 'adminNewPw2', 'adminPwInput', 'adminLinkUrls', 'adminLinkTitle', 'adminLinkSummary', 'adminLinkTags', 'adminNoticeTitle', 'adminNoticeBody', 'adminPhotoFile', 'adminResumeFile'].forEach((id) => { $(id).value = ''; });
        $('adminPhotoPreview').classList.add('hidden');
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

    // ---------- 자료실 링크: 분류 · 세부분류 · 정렬 ----------

    const CATEGORIES_PATH = 'data/link-categories.json';
    const GROUP_NAMES = ['참고자료', '유튜브 링크', '블로그 링크', '기타자료'];
    const SORT_MODES = { newest: '최근 추가순', oldest: '오래된 순', title: '제목 가나다순', manual: '직접 순서 (↑↓로 지정)' };
    let cats = { groups: GROUP_NAMES.map((name) => ({ name, sort: 'newest', subs: [] })) };
    let linkRows = [];

    const fmtDate = (iso) => (iso ? iso.slice(0, 10).replace(/-/g, '.') : '');

    // 사이트(site.js)와 같은 규칙: 저장된 group, 없으면 링크 종류로
    function groupOf(l) {
        if (GROUP_NAMES.includes(l.group)) return l.group;
        if (l.type === 'gdrive' || l.category === '자료') return '참고자료';
        if (l.type === 'youtube') return '유튜브 링크';
        if (l.type === 'blog') return '블로그 링크';
        return '기타자료';
    }

    const groupCfg = (name) => cats.groups.find((g) => g.name === name) || { name, sort: 'newest', subs: [] };
    const subOptions = (group, current) => {
        const subs = [...groupCfg(group).subs];
        if (current && !subs.includes(current)) subs.push(current);
        return `<option value="">세부분류: 없음</option>${subs.map((x) => `<option value="${esc(x)}"${x === current ? ' selected' : ''}>${esc(x)}</option>`).join('')}`;
    };

    const catError = (e) => (e.status === 409 ? '목록이 방금 바뀌었습니다. 다시 시도해 주세요.' : '저장하지 못했습니다. 토큰 권한(Contents 쓰기)을 확인해 주세요.');

    async function readCategories() {
        try {
            const { sha, data } = await readJson(CATEGORIES_PATH);
            const groups = GROUP_NAMES.map((name) => ({ name, sort: 'newest', subs: [], ...(data.groups || []).find((g) => g.name === name) }));
            return { sha, data: { ...data, groups } };
        } catch (e) {
            if (e.status !== 404) throw e;
            return { sha: null, data: { groups: GROUP_NAMES.map((name) => ({ name, sort: 'newest', subs: [] })) } };
        }
    }

    function renderCatManager() {
        $('adminCatManager').innerHTML = GROUP_NAMES.map((g) => {
            const cfg = groupCfg(g);
            return `
                <div class="p-2.5 rounded-xl bg-white border border-slate-100 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-xs font-bold text-slate-700">${esc(g)}</span>
                        <label class="flex items-center gap-1 text-[11px] text-slate-500">정렬
                        <select data-sort-group="${esc(g)}" class="text-[11px] px-2 py-1.5 rounded-lg border border-slate-200 bg-white">
                            ${Object.entries(SORT_MODES).map(([k, v]) => `<option value="${k}"${cfg.sort === k ? ' selected' : ''}>${v}</option>`).join('')}
                        </select></label>
                    </div>
                    <ul class="space-y-1">
                        ${cfg.subs.length ? cfg.subs.map((x) => `
                            <li class="flex items-center gap-1.5 text-xs text-slate-700">
                                <i class="fa-solid fa-angle-right text-slate-300 w-3"></i>
                                <span class="flex-1 min-w-0 break-words">${esc(x)}</span>
                                <button type="button" data-sub-ren="${esc(g)}" data-name="${esc(x)}" class="px-2 py-1 rounded-lg border border-slate-200 text-[11px] text-slate-500 hover:text-blue-600">이름 변경</button>
                                <button type="button" data-sub-del="${esc(g)}" data-name="${esc(x)}" class="px-2 py-1 rounded-lg border border-slate-200 text-[11px] text-slate-500 hover:text-red-600">삭제</button>
                            </li>`).join('') : '<li class="text-[11px] text-slate-400">세부분류가 없습니다.</li>'}
                    </ul>
                    <div class="flex gap-1.5">
                        <input type="text" maxlength="40" data-sub-input="${esc(g)}" placeholder="새 세부분류 이름" class="flex-1 min-w-0 text-xs px-2.5 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <button type="button" data-sub-add="${esc(g)}" class="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap">+ 만들기</button>
                    </div>
                </div>`;
        }).join('');
    }

    function fillAddSub() {
        const g = $('adminLinkCategory').value;
        const sel = $('adminLinkSub');
        sel.disabled = g === '자동';
        sel.innerHTML = g === '자동' ? '<option value="">세부분류: 없음</option>' : subOptions(g, '') + '<option value="__new__">+ 새 세부분류 만들기</option>';
    }

    function renderLinkRows() {
        const box = $('adminLinkList');
        $('adminLinkCount').textContent = `${linkRows.length}개`;
        const groupSelect = (id, g) => `<select data-link-group="${esc(id)}" class="w-full text-[11px] px-2 py-1.5 rounded-lg border border-slate-200 bg-white">${GROUP_NAMES.map((n) => `<option${n === g ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
        box.innerHTML = linkRows.length
            ? linkRows.map((l) => {
                const g = groupOf(l);
                const manual = groupCfg(g).sort === 'manual';
                return `
                    <li class="p-2.5 rounded-xl border border-slate-100 bg-white space-y-1.5">
                        <div class="flex items-center gap-2">
                            <i class="${l.type === 'youtube' ? 'fa-brands fa-youtube text-red-500' : l.type === 'blog' ? 'fa-solid fa-pen-nib text-emerald-500' : l.type === 'gdrive' ? 'fa-brands fa-google-drive text-amber-500' : 'fa-solid fa-link text-blue-500'} text-xs w-4 text-center flex-shrink-0"></i>
                            <div class="flex-1 min-w-0">
                                <div class="text-xs font-semibold text-slate-800 break-words">${esc(l.title)}</div>
                                <div class="text-[11px] text-slate-400 break-all">${fmtDate(l.addedAt)} · ${esc(l.url)}</div>
                            </div>
                            ${manual ? `
                                <button type="button" data-move-up="${esc(l.id)}" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-blue-600 flex-shrink-0" aria-label="위로"><i class="fa-solid fa-arrow-up text-[10px]"></i></button>
                                <button type="button" data-move-down="${esc(l.id)}" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-blue-600 flex-shrink-0" aria-label="아래로"><i class="fa-solid fa-arrow-down text-[10px]"></i></button>` : ''}
                            <button type="button" data-del-link="${esc(l.id)}" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 flex-shrink-0" aria-label="삭제"><i class="fa-solid fa-trash text-[10px]"></i></button>
                        </div>
                        <div class="grid grid-cols-2 gap-1.5">
                            ${groupSelect(l.id, g)}
                            <select data-link-sub="${esc(l.id)}" class="w-full text-[11px] px-2 py-1.5 rounded-lg border border-slate-200 bg-white">${subOptions(g, l.sub || '')}</select>
                        </div>
                    </li>`;
            }).join('')
            : '<li class="text-xs text-slate-400 text-center py-4">저장된 링크가 없습니다.</li>';
    }

    async function loadLinkList() {
        const box = $('adminLinkList');
        box.innerHTML = '<li class="text-xs text-slate-400 text-center py-4"><i class="fa-solid fa-spinner fa-spin mr-1"></i> 불러오는 중...</li>';
        try {
            const [{ data: links }, { data: c }] = await Promise.all([readJson(LINKS_PATH), readCategories()]);
            linkRows = links;
            cats = c;
            renderCatManager();
            fillAddSub();
            renderLinkRows();
        } catch (e) {
            box.innerHTML = `<li class="text-xs text-red-500 text-center py-4">${authError(e)
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
                sub: $('adminLinkCategory').value === '자동' ? '' : $('adminLinkSub').value,
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

    // links.json 을 다시 읽어 고친 뒤 저장한다 (그 사이 워크플로가 바꿨으면 409 로 알려 준다).
    async function editLinks(mutate, message) {
        const { sha, data } = await readJson(LINKS_PATH);
        const next = mutate(data);
        if (!next) return false;
        await writeJson(LINKS_PATH, next, sha, message.slice(0, 100));
        return true;
    }

    async function deleteLink(id) {
        if (!confirm('이 링크를 자료실에서 삭제할까요?')) return;
        try {
            const title = linkRows.find((l) => l.id === id)?.title || '';
            await editLinks((d) => (d.some((l) => l.id === id) ? d.filter((l) => l.id !== id) : null), `홈페이지에서 링크 삭제: ${title}`);
            toast('🗑️ 삭제했습니다. 1~2분 뒤 자료실에서 사라집니다.');
        } catch (e) {
            toast(e.status === 409 ? '목록이 방금 바뀌었습니다. 다시 시도해 주세요.' : '삭제하지 못했습니다.');
        }
        loadLinkList();
    }

    async function updateLink(id, patch) {
        try {
            await editLinks((d) => d.map((l) => (l.id === id ? { ...l, ...patch } : l)), '홈페이지에서 링크 분류 변경');
            toast('✅ 분류를 바꿨습니다. 1~2분 뒤 자료실에 반영됩니다.');
        } catch (e) {
            toast(catError(e));
        }
        loadLinkList();
    }

    // 직접 순서: 같은 분류 안에서 바로 위·아래 링크와 자리를 바꾼다 (links.json 의 순서가 곧 직접 순서)
    async function moveLink(id, dir) {
        try {
            const moved = await editLinks((d) => {
                const i = d.findIndex((l) => l.id === id);
                if (i < 0) return null;
                const g = groupOf(d[i]);
                let j = i + dir;
                while (j >= 0 && j < d.length && groupOf(d[j]) !== g) j += dir;
                if (j < 0 || j >= d.length) return null;
                const next = d.slice();
                [next[i], next[j]] = [next[j], next[i]];
                return next;
            }, '홈페이지에서 링크 순서 변경');
            if (moved) toast('✅ 순서를 바꿨습니다.');
        } catch (e) {
            toast(catError(e));
        }
        loadLinkList();
    }

    async function editCategories(mutate, message) {
        const { sha, data } = await readCategories();
        mutate(data);
        await writeJson(CATEGORIES_PATH, data, sha, message);
    }

    async function addSub(group) {
        const input = document.querySelector(`[data-sub-input="${CSS.escape(group)}"]`);
        const name = input.value.trim().slice(0, 40);
        if (!name) return toast('세부분류 이름을 입력해 주세요.');
        if (groupCfg(group).subs.includes(name)) return toast('이미 있는 세부분류입니다.');
        try {
            await editCategories((d) => d.groups.find((g) => g.name === group).subs.push(name), `홈페이지에서 세부분류 추가: ${group} / ${name}`);
            toast('✅ 세부분류를 추가했습니다.');
        } catch (e) {
            toast(catError(e));
        }
        loadLinkList();
    }

    async function renameSub(group, oldName) {
        const name = (prompt('새 이름', oldName) || '').trim().slice(0, 40);
        if (!name || name === oldName) return;
        if (groupCfg(group).subs.includes(name)) return toast('이미 있는 세부분류입니다.');
        try {
            await editCategories((d) => {
                const g = d.groups.find((x) => x.name === group);
                g.subs = g.subs.map((x) => (x === oldName ? name : x));
            }, `홈페이지에서 세부분류 이름 변경: ${group} / ${oldName} → ${name}`);
            await editLinks((d) => d.map((l) => (groupOf(l) === group && l.sub === oldName ? { ...l, sub: name } : l)), '홈페이지에서 세부분류 이름 변경 반영');
            toast('✅ 이름을 바꿨습니다.');
        } catch (e) {
            toast(catError(e));
        }
        loadLinkList();
    }

    async function deleteSub(group, name) {
        if (!confirm(`세부분류 "${name}"을 지울까요? 그 안의 링크는 세부분류 없음으로 옮겨집니다.`)) return;
        try {
            await editCategories((d) => {
                const g = d.groups.find((x) => x.name === group);
                g.subs = g.subs.filter((x) => x !== name);
            }, `홈페이지에서 세부분류 삭제: ${group} / ${name}`);
            await editLinks((d) => (d.some((l) => groupOf(l) === group && l.sub === name)
                ? d.map((l) => { if (groupOf(l) === group && l.sub === name) { const { sub, ...rest } = l; return rest; } return l; })
                : null), '홈페이지에서 세부분류 삭제 반영');
            toast('🗑️ 삭제했습니다.');
        } catch (e) {
            toast(catError(e));
        }
        loadLinkList();
    }

    async function setSort(group, sort) {
        try {
            await editCategories((d) => { d.groups.find((g) => g.name === group).sort = sort; }, `홈페이지에서 정렬 방식 변경: ${group} / ${sort}`);
            toast('✅ 정렬 방식을 바꿨습니다. 1~2분 뒤 자료실에 반영됩니다.');
        } catch (e) {
            toast(catError(e));
        }
        loadLinkList();
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

    // ---------- 프로필 사진 · 이력서 ----------

    const MAX_RESUME_BYTES = 20 * 1024 * 1024;
    let photoBlob = null;

    function bytesToB64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    }

    // 가운데를 정사각형으로 잘라 640px JPEG 로 줄인다.
    async function resizePhoto(file) {
        const bmp = await createImageBitmap(file);
        const side = Math.min(bmp.width, bmp.height);
        const size = Math.min(640, side);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
        return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('resize'))), 'image/jpeg', 0.88));
    }

    async function putFile(path, base64, message) {
        let sha;
        try {
            sha = (await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=main`)).sha;
        } catch (e) {
            if (e.status !== 404) throw e;
        }
        return gh(`/repos/${OWNER}/${REPO}/contents/${path}`, {
            method: 'PUT',
            body: JSON.stringify({ message, content: base64, branch: 'main', ...(sha ? { sha } : {}) }),
        });
    }

    async function touchProfile(patch) {
        let sha = null;
        let data = {};
        try { ({ sha, data } = await readJson(PROFILE_PATH)); } catch (e) { if (e.status !== 404) throw e; }
        await writeJson(PROFILE_PATH, { ...data, ...patch }, sha, '홈페이지에서 프로필 정보 변경');
    }

    function openProfilePanel() {
        show('adminProfileView');
    }

    async function onPhotoPicked() {
        const file = $('adminPhotoFile').files[0];
        photoBlob = null;
        $('adminPhotoPreview').classList.add('hidden');
        if (!file) return;
        try {
            photoBlob = await resizePhoto(file);
            $('adminPhotoPreview').src = URL.createObjectURL(photoBlob);
            $('adminPhotoPreview').classList.remove('hidden');
        } catch {
            toast('이미지를 읽지 못했습니다. JPG·PNG 사진을 골라 주세요.');
        }
    }

    async function withBusy(btnId, work) {
        const btn = $(btnId);
        btn.disabled = true;
        btn.classList.add('opacity-60');
        try { await work(); } finally {
            btn.disabled = false;
            btn.classList.remove('opacity-60');
        }
    }

    const uploadPhoto = () => withBusy('adminPhotoBtn', async () => {
        if (!photoBlob) return toast('먼저 사진을 골라 주세요.');
        try {
            await putFile(PHOTO_PATH, bytesToB64(new Uint8Array(await photoBlob.arrayBuffer())), '홈페이지에서 프로필 사진 변경');
            await touchProfile({ photo: PHOTO_PATH, photoUpdatedAt: new Date().toISOString() });
            toast('✅ 사진을 올렸습니다. 1~2분 뒤 홈페이지에 반영됩니다.');
        } catch (e) {
            toast(e.status === 409 ? '파일이 방금 바뀌었습니다. 다시 시도해 주세요.' : '올리지 못했습니다. 토큰 권한(Contents 쓰기)을 확인해 주세요.');
        }
    });

    const uploadResume = () => withBusy('adminResumeBtn', async () => {
        const file = $('adminResumeFile').files[0];
        if (!file) return toast('먼저 PDF 파일을 골라 주세요.');
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast('PDF 파일만 올릴 수 있습니다.');
        if (file.size > MAX_RESUME_BYTES) return toast('20MB 이하 파일만 올릴 수 있습니다.');
        try {
            await putFile(RESUME_PATH, bytesToB64(new Uint8Array(await file.arrayBuffer())), '홈페이지에서 이력서 변경');
            await touchProfile({ resumeUpdatedAt: new Date().toISOString() });
            $('adminResumeFile').value = '';
            toast('✅ 이력서를 올렸습니다. 1~2분 뒤 다운로드에 반영됩니다.');
        } catch (e) {
            toast(e.status === 409 ? '파일이 방금 바뀌었습니다. 다시 시도해 주세요.' : '올리지 못했습니다. 토큰 권한(Contents 쓰기)을 확인해 주세요.');
        }
    });

    function openTarget() {
        if (target === 'profile') openProfilePanel();
        else if (target === 'links') openLinksPanel();
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
        $('profileAdminBtn').addEventListener('click', () => openFor('profile'));
        $('adminPhotoFile').addEventListener('change', onPhotoPicked);
        $('adminPhotoBtn').addEventListener('click', uploadPhoto);
        $('adminResumeBtn').addEventListener('click', uploadResume);
        $('adminNoticeAddBtn').addEventListener('click', addNotice);
        $('adminBoardSaveBtn').addEventListener('click', saveBoardSettings);
        $('adminGaId').addEventListener('input', updateStatsLink);
        $('adminNoticeList').addEventListener('click', (e) => {
            const del = e.target.closest('[data-del-notice]');
            if (del) deleteNotice(del.dataset.delNotice);
        });
        $('adminLinkList').addEventListener('click', (e) => {
            const del = e.target.closest('[data-del-link]');
            if (del) return deleteLink(del.dataset.delLink);
            const up = e.target.closest('[data-move-up]');
            if (up) return moveLink(up.dataset.moveUp, -1);
            const down = e.target.closest('[data-move-down]');
            if (down) moveLink(down.dataset.moveDown, 1);
        });
        $('adminLinkList').addEventListener('change', (e) => {
            const gSel = e.target.closest('[data-link-group]');
            if (gSel) return updateLink(gSel.dataset.linkGroup, { group: gSel.value, category: gSel.value, sub: '' });
            const sSel = e.target.closest('[data-link-sub]');
            if (sSel) updateLink(sSel.dataset.linkSub, { sub: sSel.value });
        });
        $('adminLinkCategory').addEventListener('change', fillAddSub);
        $('adminLinkSub').addEventListener('change', async (e) => {
            if (e.target.value !== '__new__') return;
            const group = $('adminLinkCategory').value;
            const name = (prompt(`"${group}"에 만들 세부분류 이름`) || '').trim().slice(0, 40);
            if (!name) return fillAddSub();
            if (!groupCfg(group).subs.includes(name)) {
                try {
                    await editCategories((d) => d.groups.find((g) => g.name === group).subs.push(name), `홈페이지에서 세부분류 추가: ${group} / ${name}`);
                    toast('✅ 세부분류를 만들었습니다.');
                } catch (err) {
                    toast(catError(err));
                    return fillAddSub();
                }
            }
            await loadLinkList();
            $('adminLinkCategory').value = group;
            fillAddSub();
            $('adminLinkSub').value = name;
        });
        $('adminCatManager').addEventListener('click', (e) => {
            const add = e.target.closest('[data-sub-add]');
            if (add) return addSub(add.dataset.subAdd);
            const ren = e.target.closest('[data-sub-ren]');
            if (ren) return renameSub(ren.dataset.subRen, ren.dataset.name);
            const del = e.target.closest('[data-sub-del]');
            if (del) deleteSub(del.dataset.subDel, del.dataset.name);
        });
        $('adminCatManager').addEventListener('change', (e) => {
            const sel = e.target.closest('[data-sort-group]');
            if (sel) setSort(sel.dataset.sortGroup, sel.value);
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
