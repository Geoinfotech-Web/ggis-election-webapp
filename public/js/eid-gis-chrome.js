(function () {
  const THEME_KEY = "electionDashboardTheme";
  const theme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  document.body.classList.add("eid-gis");
})();
