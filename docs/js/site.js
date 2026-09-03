(() => {
  document.documentElement.classList.add('js');

  const menuButton = document.querySelector('[data-menu-button]');
  const menu = document.querySelector('[data-menu]');

  if (menuButton && menu) {
    menuButton.addEventListener('click', () => {
      const isOpen = menu.classList.toggle('open');
      menuButton.setAttribute('aria-expanded', String(isOpen));
    });
  }

  document.querySelectorAll('[data-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });

  const releaseElements = document.querySelectorAll('[data-latest-release]');
  if (!releaseElements.length) return;

  fetch('https://api.github.com/repos/dynamiccookies/retention-manager-for-gmail/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' }
  })
    .then((response) => {
      if (!response.ok) throw new Error('Release lookup failed');
      return response.json();
    })
    .then((release) => {
      if (!release.tag_name || !release.html_url) return;
      releaseElements.forEach((element) => {
        element.textContent = release.tag_name;
        element.href = release.html_url;
      });
    })
    .catch(() => {
      // Keep the useful static fallback link when GitHub's API is unavailable.
    });
})();
