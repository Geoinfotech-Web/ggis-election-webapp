(function () {
  const LOGIN_PATH = '/admin/index.html';

  function getToken() {
    return sessionStorage.getItem('admin_token') || '';
  }

  function authHeaders(extra) {
    const token = getToken();
    return {
      ...(extra || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async function apiFetch(url, options = {}) {
    const headers = { ...authHeaders(options.headers || {}) };
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      sessionStorage.removeItem('admin_token');
      window.location.replace(LOGIN_PATH);
      throw new Error('Session expired. Sign in again.');
    }

    if (!response.ok) {
      throw new Error(data.error || 'Request failed.');
    }

    return data;
  }

  function logout() {
    sessionStorage.removeItem('admin_token');
    window.location.replace(LOGIN_PATH);
  }

  function renderNav(active) {
    const items = [
      { id: 'dashboard', label: 'Dashboard', href: '/admin/dashboard.html' },
      { id: 'upload', label: 'Upload boundaries', href: '/admin/upload.html' },
    ];

    return items
      .map((item) => {
        const activeClass = item.id === active ? ' is-active' : '';
        return `<a class="admin-nav-link${activeClass}" href="${item.href}">${item.label}</a>`;
      })
      .join('');
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  window.AdminCommon = {
    LOGIN_PATH,
    getToken,
    apiFetch,
    logout,
    renderNav,
    formatDate,
  };
})();
