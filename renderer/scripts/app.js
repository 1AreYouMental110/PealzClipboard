// ── Main App Controller ──────────────────────────────────────────────────────

(async () => {

  const appEl     = document.getElementById('app');
  const tabBtns   = document.querySelectorAll('.tab-btn');
  const indicator = document.querySelector('.tab-indicator');
  const panels    = {
    clipboard: document.getElementById('panel-clipboard'),
    emoji:     document.getElementById('panel-emoji')
  };

  let activeTab = 'clipboard';

  // ── Animation helpers ─────────────────────────────────────────────────────
  function animateIn() {
    appEl.classList.remove('hiding');
    appEl.classList.add('showing');
    Sounds.open();
    const searchInput = panels[activeTab].querySelector('input[type="text"]');
    if (searchInput) setTimeout(() => searchInput.focus(), 220);
  }

  function animateOut() {
    appEl.classList.remove('showing');
    appEl.classList.add('hiding');
    Sounds.close();
  }

  // ── Window events from main process ──────────────────────────────────────
  window.api.onWindowShowing(animateIn);
  window.api.onWindowHiding(animateOut);

  // Play entry animation on first load
  animateIn();

  // ── Close button ─────────────────────────────────────────────────────────
  document.getElementById('btnClose').addEventListener('click', () => {
    window.api.hideWindow();
  });

  // Escape key closes; Ctrl+1/2 switch tabs
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape')  window.api.hideWindow();
    if (e.ctrlKey && e.key === '1') switchTab('clipboard');
    if (e.ctrlKey && e.key === '2') switchTab('emoji');
    if (e.key === 'Tab' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      switchTab(activeTab === 'clipboard' ? 'emoji' : 'clipboard');
    }
  });

  // ── Tab switching ─────────────────────────────────────────────────────────
  function switchTab(tabName) {
    if (tabName === activeTab) return;

    const fromPanel = panels[activeTab];
    const toPanel   = panels[tabName];
    const goRight   = tabName === 'emoji';

    fromPanel.classList.remove('active');
    fromPanel.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
    fromPanel.style.opacity    = '0';
    fromPanel.style.transform  = goRight ? 'translateX(-16px)' : 'translateX(16px)';

    toPanel.style.transition = 'none';
    toPanel.style.opacity    = '0';
    toPanel.style.transform  = goRight ? 'translateX(16px)' : 'translateX(-16px)';

    requestAnimationFrame(() => requestAnimationFrame(() => {
      toPanel.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      toPanel.style.opacity    = '1';
      toPanel.style.transform  = 'translateX(0)';
      toPanel.classList.add('active');

      setTimeout(() => {
        fromPanel.style.transition = '';
        fromPanel.style.opacity    = '';
        fromPanel.style.transform  = '';
      }, 200);
    }));

    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    indicator.classList.toggle('right', goRight);

    activeTab = tabName;
    Sounds.tab();

    if (tabName === 'emoji') EmojiTab.refresh();

    const searchInput = toPanel.querySelector('input[type="text"]');
    if (searchInput) setTimeout(() => searchInput.focus(), 230);
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ── Update banner ─────────────────────────────────────────────────────────
  const updateBanner  = document.getElementById('updateBanner');
  const updateText    = document.getElementById('updateBannerText');
  const updateBtn     = document.getElementById('updateBannerBtn');
  let   updateReady   = false;

  window.api.onUpdateAvailable((info) => {
    updateText.textContent = `Update v${info.version} downloading…`;
    updateBtn.textContent  = 'Downloading';
    updateBtn.disabled     = true;
    updateBanner.classList.remove('hidden');
  });

  window.api.onUpdateProgress((data) => {
    updateText.textContent = `Downloading update… ${data.percent}%`;
  });

  window.api.onUpdateDownloaded((info) => {
    updateText.textContent = `v${info.version} ready — restart to apply`;
    updateBtn.textContent  = 'Restart now';
    updateBtn.disabled     = false;
    updateReady            = true;
    Sounds.favorite();
    showToast('Update ready — restart to apply');
  });

  updateBtn.addEventListener('click', () => {
    if (updateReady) window.api.installUpdate();
  });

  // ── Init modules ──────────────────────────────────────────────────────────
  ClipboardTab.init();
  EmojiTab.init();

})();
