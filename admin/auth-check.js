(async () => {
  const loginPath = '/admin/index.html';
  const token = sessionStorage.getItem('admin_token');

  if (!token) {
    window.location.replace(loginPath);
    return;
  }

  try {
    const response = await fetch('/api/admin/verify', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Invalid admin session.');
    }
  } catch {
    sessionStorage.removeItem('admin_token');
    window.location.replace(loginPath);
  }
})();
