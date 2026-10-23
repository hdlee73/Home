// 관리자: 홈페이지에서 '내 앱'에 노출할 앱을 고른다.
// 페이지 소스에는 비밀번호도 토큰도 없다. 관리자가 처음 한 번 GitHub 토큰(이 저장소 Contents 읽기/쓰기만)을 넣으면
// 관리자가 정한 비밀번호로 암호화(PBKDF2 + AES-GCM)해 그 브라우저에만 저장하고, 이후에는 비밀번호로 잠금을 푼다.
// 저장하면 data/apps-config.json 을 커밋하고, '앱 목록 갱신' 워크플로가 1~2분 뒤 홈페이지에 반영한다.
(() => {
    const OWNER = 'hdlee73';
    const REPO = 'Resume_LHD';
    const CONFIG_PATH = 'data/apps-config.json';
    const VAULT_KEY = 'hdlee_admin_vault_v1';
    const PBKDF2_ITERATIONS = 600000;

    let token = null;      // 잠금 해제된 동안 메모리에만 둔다
    let selected = [];     // 노출할 저장소 이름 (순서 = 표시 순서)
    let repos = [];        // 고를 수 있는 공개 저장소

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

    async function readConfig() {
        const file = await gh(`/repos/${OWNER}/${REPO}/contents/${CONFIG_PATH}?ref=main`);
        return { sha: file.sha, config: JSON.parse(decodeContent(file.content)) };
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
        ['adminSetupView', 'adminLoginView', 'adminPanelView'].forEach((id) => $(id).classList.toggle('hidden', id !== view));
        $('adminAppsModal').classList.remove('opacity-0', 'pointer-events-none');
        const focus = { adminSetupView: 'adminTokenInput', adminLoginView: 'adminPwInput' }[view];
        if (focus) setTimeout(() => $(focus).focus(), 50);
    }

    function close() {
        $('adminAppsModal').classList.add('opacity-0', 'pointer-events-none');
        ['adminTokenInput', 'adminNewPw', 'adminNewPw2', 'adminPwInput'].forEach((id) => { $(id).value = ''; });
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
                <li class="flex items-center gap-2 p-2.5 rounded-xl border ${on ? 'border-blue-200 bg-blue-50/60' : 'border-slate-100 bg-white'}">
                    <input type="checkbox" data-toggle="${esc(r.name)}" ${on ? 'checked' : ''} class="w-4 h-4 accent-blue-600 flex-shrink-0">
                    <div class="flex-1 min-w-0">
                        <div class="text-xs font-semibold text-slate-800 truncate">${on ? `<span class="text-blue-600 mr-1">${i + 1}.</span>` : ''}${esc(r.name)}</div>
                        <div class="text-[11px] text-slate-500 truncate">${esc(r.description) || '설명 없음'}</div>
                    </div>
                    ${on ? `
                        <button type="button" data-up="${i}" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-blue-600 disabled:opacity-30" ${i === 0 ? 'disabled' : ''} aria-label="위로"><i class="fa-solid fa-chevron-up text-[10px]"></i></button>
                        <button type="button" data-down="${i}" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-blue-600 disabled:opacity-30" ${i === chosen.length - 1 ? 'disabled' : ''} aria-label="아래로"><i class="fa-solid fa-chevron-down text-[10px]"></i></button>` : ''}
                </li>`;
        };

        $('adminAppList').innerHTML =
            chosen.map((r, i) => row(r, i)).join('') +
            (rest.length ? `<li class="pt-3 pb-1 text-[11px] font-semibold text-slate-400">숨김 (${rest.length})</li>` : '') +
            rest.map((r) => row(r, null)).join('');
    }

    async function openPanel() {
        show('adminPanelView');
        $('adminAppList').innerHTML = '<li class="text-xs text-slate-400 text-center py-6"><i class="fa-solid fa-spinner fa-spin mr-1"></i> 불러오는 중...</li>';
        try {
            const [{ config }, list] = await Promise.all([readConfig(), loadRepos()]);
            selected = [...(config.show || [])];
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
            const content = JSON.stringify(config, null, 2) + '\n';
            await gh(`/repos/${OWNER}/${REPO}/contents/${CONFIG_PATH}`, {
                method: 'PUT',
                body: JSON.stringify({
                    message: `홈페이지 관리자 화면에서 노출 앱 변경 (${selected.length}개)`,
                    content: encodeContent(content),
                    sha,
                    branch: 'main',
                }),
            });
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
        openPanel();
    }

    async function login() {
        const err = $('adminLoginError');
        err.textContent = '';
        try {
            token = await openVault($('adminPwInput').value);
            openPanel();
        } catch {
            err.textContent = '비밀번호가 일치하지 않습니다.';
        }
    }

    function reset() {
        if (!confirm('이 브라우저에 저장된 관리자 토큰을 지우고 다시 등록할까요?')) return;
        try { localStorage.removeItem(VAULT_KEY); } catch {}
        token = null;
        show('adminSetupView');
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!$('adminAppsBtn')) return;
        $('adminAppsBtn').addEventListener('click', () => {
            if (token) openPanel();
            else show(hasVault() ? 'adminLoginView' : 'adminSetupView');
        });
        $('adminAppsModal').addEventListener('click', (e) => {
            if (e.target.id === 'adminAppsModal' || e.target.closest('[data-admin-close]')) close();
        });
        $('adminSetupBtn').addEventListener('click', setup);
        $('adminLoginBtn').addEventListener('click', login);
        $('adminPwInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
        $('adminSaveBtn').addEventListener('click', save);
        $('adminLockBtn').addEventListener('click', () => { token = null; close(); toast('🔒 관리자 화면을 잠갔습니다.'); });
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
