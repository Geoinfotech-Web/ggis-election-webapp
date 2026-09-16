(async () => {
  const loginPath = '/admin-login.html';

  try {
    const response = await fetch('/api/admin/me', {
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Admin session required.');
    }
  } catch {
    window.location.replace(loginPath);
  }
})();
