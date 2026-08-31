(function () {
  const STORAGE_KEY = 'electionDashboardTheme';
  const root = document.body;

  if (!root) {
    return;
  }

  const savedTheme = localStorage.getItem(STORAGE_KEY);
  const initialTheme = savedTheme === 'light' ? 'light' : 'dark';

  function applyTheme(theme) {
    const isLight = theme === 'light';
    root.classList.toggle('theme-light', isLight);
    root.classList.toggle('theme-dark', !isLight);
    localStorage.setItem(STORAGE_KEY, isLight ? 'light' : 'dark');

    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.setAttribute('aria-pressed', String(isLight));
      button.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
      button.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
      button.querySelector('.theme-toggle-icon').textContent = isLight ? 'D' : 'L';
    });
  }

  function createThemeToggle() {
    const header = document.querySelector('.dashboard-header');

    if (!header || header.querySelector('[data-theme-toggle]')) {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    button.dataset.themeToggle = 'true';
    button.setAttribute('aria-label', 'Toggle page theme');
    button.innerHTML = `
      <span class="theme-toggle-icon" aria-hidden="true"></span>
    `;

    let actions = header.querySelector('.dashboard-header-actions');

    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'dashboard-header-actions';

      const trailingItems = Array.from(header.children).slice(1);
      trailingItems.forEach((item) => actions.appendChild(item));
      header.appendChild(actions);
    }

    actions.prepend(button);

    button.addEventListener('click', () => {
      applyTheme(root.classList.contains('theme-light') ? 'dark' : 'light');
    });
  }

  root.classList.add(initialTheme === 'light' ? 'theme-light' : 'theme-dark');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createThemeToggle();
      applyTheme(initialTheme);
    });
  } else {
    createThemeToggle();
    applyTheme(initialTheme);
  }
})();
