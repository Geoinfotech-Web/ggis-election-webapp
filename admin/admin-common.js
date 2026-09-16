(function () {
  const LOGIN_PATH = '/admin-login.html';
  const PORTAL_HOME = '/admin/';

  let csrfToken = '';
  let currentAdmin = null;
  let sessionPromise = null;

  const NAV_ITEMS = [
    { id: 'home', label: 'Home', href: '/admin/' },
    { id: 'content', label: 'Content', href: '/admin/content.html' },
    { id: 'pages', label: 'Pages', href: '/admin/pages.html' },
    { id: 'dashboards', label: 'Dashboards', href: '/admin/dashboards.html' },
    { id: 'maps', label: 'Maps', href: '/admin/maps.html' },
    { id: 'moderation', label: 'Moderation', href: '/admin/moderation.html' },
    { id: 'access', label: 'Access', href: '/admin/access.html' },
  ];

  function getCsrfToken() {
    return csrfToken;
  }

  function getAdmin() {
    return currentAdmin;
  }

  async function loadSession(force) {
    if (!force && currentAdmin && csrfToken) return currentAdmin;
    if (!force && sessionPromise) return sessionPromise;

    sessionPromise = fetch('/api/admin/me', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || 'Admin access required.');
        }
        currentAdmin = data;
        csrfToken = data.csrfToken || '';
        return data;
      })
      .catch((error) => {
        currentAdmin = null;
        csrfToken = '';
        throw error;
      })
      .finally(() => {
        sessionPromise = null;
      });

    return sessionPromise;
  }

  function authHeaders(extra, method) {
    const headers = { ...(extra || {}) };
    const verb = String(method || 'GET').toUpperCase();
    if (verb !== 'GET' && verb !== 'HEAD' && verb !== 'OPTIONS' && csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    return headers;
  }

  async function apiFetch(url, options = {}) {
    if (!csrfToken) {
      try {
        await loadSession();
      } catch {
        window.location.replace(LOGIN_PATH);
        throw new Error('Session expired. Sign in again.');
      }
    }

    const method = options.method || 'GET';
    const headers = authHeaders(options.headers || {}, method);
    if (!(options.body instanceof FormData) && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      method,
      credentials: 'include',
      headers,
    });
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      currentAdmin = null;
      csrfToken = '';
      window.location.replace(LOGIN_PATH);
      throw new Error('Session expired. Sign in again.');
    }

    if (response.status === 403 && /csrf/i.test(String(data.error || ''))) {
      await loadSession(true);
      const retryHeaders = authHeaders(options.headers || {}, method);
      if (!(options.body instanceof FormData) && method !== 'GET' && method !== 'HEAD') {
        retryHeaders['Content-Type'] = retryHeaders['Content-Type'] || 'application/json';
      }
      const retry = await fetch(url, {
        ...options,
        method,
        credentials: 'include',
        headers: retryHeaders,
      });
      const retryData = await retry.json().catch(() => ({}));
      if (!retry.ok) throw new Error(retryData.error || 'Request failed.');
      return retryData;
    }

    if (!response.ok) {
      throw new Error(data.error || 'Request failed.');
    }

    return data;
  }

  async function logout() {
    try {
      if (!csrfToken) await loadSession();
      await apiFetch('/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      /* still clear local state */
    }
    currentAdmin = null;
    csrfToken = '';
    window.location.replace(LOGIN_PATH);
  }

  function renderNav(active) {
    return NAV_ITEMS.map((item) => {
      const activeClass = item.id === active ? ' is-active' : '';
      return `<a class="admin-nav-link${activeClass}" href="${item.href}">${item.label}</a>`;
    }).join('');
  }

  function mountShell(options) {
    const opts = options || {};
    const active = opts.active || 'home';
    const title = opts.title || 'Admin portal';
    const kicker = opts.kicker || 'Admin portal';
    const navEl = document.getElementById('adminNav');
    const titleEl = document.getElementById('adminPageTitle');
    const kickerEl = document.getElementById('adminKicker');
    const userEl = document.getElementById('adminUser');
    const logoutBtn = document.getElementById('logoutButton');

    if (navEl) navEl.innerHTML = renderNav(active);
    if (titleEl) titleEl.textContent = title;
    if (kickerEl) kickerEl.textContent = kicker;
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    return loadSession()
      .then((admin) => {
        if (userEl) {
          userEl.textContent = admin.name || admin.email || 'Signed in';
          if (admin.email) userEl.title = admin.email;
        }
        return admin;
      })
      .catch(() => {
        window.location.replace(LOGIN_PATH);
      });
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function phaseStub(phaseLabel, summary, hooks) {
    const hookList = (hooks || [])
      .map((h) => `<li><code>${h}</code></li>`)
      .join('');
    return `
      <section class="admin-card">
        <div class="admin-phase-badge">${phaseLabel}</div>
        <h2>Coming in a later phase</h2>
        <p class="admin-muted">${summary}</p>
        ${hookList ? `<ul class="admin-hook-list">${hookList}</ul>` : ''}
      </section>`;
  }

  window.AdminCommon = {
    LOGIN_PATH,
    PORTAL_HOME,
    NAV_ITEMS,
    getCsrfToken,
    getAdmin,
    loadSession,
    apiFetch,
    logout,
    renderNav,
    mountShell,
    formatDate,
    phaseStub,
  };
})();
