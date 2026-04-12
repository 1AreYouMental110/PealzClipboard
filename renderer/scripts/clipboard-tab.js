// ── Clipboard Tab Logic ──────────────────────────────────────────────────────

const ClipboardTab = (() => {

  let items = [];
  let searchQuery = '';
  let filterMode  = 'all';
  let renderTimer = null;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const listEl     = () => document.getElementById('clipList');
  const emptyEl    = () => document.getElementById('clipEmpty');
  const searchEl   = () => document.getElementById('clipSearch');
  const clearBtnEl = () => document.getElementById('clipSearchClear');
  const countEl    = () => document.getElementById('clipCount');

  // ── Format helpers ────────────────────────────────────────────────────────
  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const s  = Math.floor(diff / 1000);
    const m  = Math.floor(s / 60);
    const h  = Math.floor(m / 60);
    const d  = Math.floor(h / 24);
    if (s  < 10)  return 'just now';
    if (s  < 60)  return `${s}s ago`;
    if (m  < 60)  return `${m}m ago`;
    if (h  < 24)  return `${h}h ago`;
    if (d  < 7)   return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  // ── Fetch + render ────────────────────────────────────────────────────────
  async function load() {
    items = await window.api.getClipboardHistory({
      search:        searchQuery || undefined,
      favoritesOnly: filterMode === 'favorites',
      limit:         500,
      offset:        0
    });
    render();
  }

  function scheduleLoad() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(load, 120);
  }

  function render() {
    const list  = listEl();
    const empty = emptyEl();

    if (!items.length) {
      empty.style.display = '';
      [...list.children].forEach(c => { if (c !== empty) c.remove(); });
      countEl().textContent = '';
      return;
    }

    empty.style.display = 'none';

    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => frag.appendChild(buildCard(item, idx)));

    [...list.children].forEach(c => { if (c !== empty) c.remove(); });
    list.appendChild(frag);

    const favCount = items.filter(i => i.favorite).length;
    countEl().textContent =
      `${items.length} item${items.length !== 1 ? 's' : ''}` +
      (favCount ? ` · ${favCount} starred` : '');
  }

  // ── Build card using DOM (no innerHTML) ───────────────────────────────────
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)  e.className    = cls;
    if (text) e.textContent  = text;
    return e;
  }

  function buildActionBtn(icon, cls, title) {
    const btn = el('button', `clip-action ${cls}`);
    btn.title = title;
    btn.textContent = icon;
    return btn;
  }

  function buildCard(item, idx) {
    const card = el('div', 'clip-item' + (item.favorite ? ' favorited' : ''));
    card.style.animationDelay = `${Math.min(idx * 18, 200)}ms`;
    card.dataset.id = String(item.id);

    // Body
    const body = el('div', 'clip-item-body');
    const textEl = el('div', 'clip-item-text');
    textEl.textContent = item.content;        // safe: textContent only
    const meta = el('div', 'clip-item-meta', timeAgo(item.timestamp));
    body.appendChild(textEl);
    body.appendChild(meta);

    // Actions
    const actions = el('div', 'clip-item-actions');
    const copyBtn = buildActionBtn('📋', 'copy-btn', 'Copy');
    const favBtn  = buildActionBtn('⭐', `fav-btn${item.favorite ? ' active' : ''}`,
                                   item.favorite ? 'Unfavorite' : 'Favorite');
    const delBtn  = buildActionBtn('🗑', 'del-btn', 'Delete');
    actions.appendChild(copyBtn);
    actions.appendChild(favBtn);
    actions.appendChild(delBtn);

    card.appendChild(body);
    card.appendChild(actions);

    // ── Event handlers ────────────────────────────────────────────────────
    card.addEventListener('click', (e) => {
      if (e.target.closest('.clip-item-actions')) return;
      copyItem(item, card);
    });

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyItem(item, card);
    });

    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newFav = item.favorite ? 0 : 1;
      await window.api.toggleFavorite({ id: item.id, value: newFav });
      Sounds.favorite();
      showToast(newFav ? '⭐ Added to favorites' : 'Removed from favorites');
      load();
    });

    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      card.style.transition = 'opacity 0.15s, transform 0.15s';
      card.style.opacity    = '0';
      card.style.transform  = 'translateX(20px)';
      await new Promise(r => setTimeout(r, 150));
      await window.api.deleteItem({ id: item.id });
      Sounds.delete();
      load();
    });

    // Tooltip for long items
    if (item.content.length > 60) {
      card.addEventListener('mouseenter', (e) => {
        showTooltip(item.content.slice(0, 180) + (item.content.length > 180 ? '…' : ''), e);
      });
      card.addEventListener('mouseleave', hideTooltip);
    }

    return card;
  }

  async function copyItem(item, card) {
    await window.api.copyToClipboard({ content: item.content, type: item.type });
    Sounds.copy();
    showToast('📋 Copied!');

    if (card) {
      card.style.transition   = 'background 0.15s, border-color 0.15s';
      card.style.background   = 'rgba(200,149,108,0.15)';
      card.style.borderColor  = 'rgba(200,149,108,0.40)';
      setTimeout(() => {
        card.style.background  = '';
        card.style.borderColor = '';
      }, 500);
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    searchEl().addEventListener('input', (e) => {
      searchQuery = e.target.value;
      clearBtnEl().classList.toggle('hidden', !searchQuery);
      scheduleLoad();
    });

    clearBtnEl().addEventListener('click', () => {
      searchEl().value = '';
      searchQuery      = '';
      clearBtnEl().classList.add('hidden');
      load();
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterMode = btn.dataset.filter;
        Sounds.tab();
        load();
      });
    });

    document.getElementById('btnClearHistory').addEventListener('click', async () => {
      if (!confirm('Clear all non-favorite clipboard history?')) return;
      await window.api.clearHistory();
      Sounds.delete();
      showToast('🗑 History cleared');
      load();
    });

    window.api.onClipboardUpdated(() => load());

    load();
  }

  return { init, load };
})();

window.ClipboardTab = ClipboardTab;

// ── Shared utilities ─────────────────────────────────────────────────────────

function showToast(msg, duration = 1600) {
  const container = document.getElementById('toastContainer');
  const toastEl = document.createElement('div');
  toastEl.className   = 'toast';
  toastEl.textContent = msg;
  container.appendChild(toastEl);
  setTimeout(() => {
    toastEl.classList.add('out');
    toastEl.addEventListener('animationend', () => toastEl.remove(), { once: true });
  }, duration);
}

let tooltipTimer = null;
function showTooltip(text, e) {
  const tt = document.getElementById('tooltip');
  tt.textContent = text;
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => {
    const r = e.currentTarget.getBoundingClientRect();
    tt.style.left = r.left + 'px';
    tt.style.top  = (r.top - tt.offsetHeight - 8) + 'px';
    tt.classList.add('visible');
  }, 450);
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  document.getElementById('tooltip').classList.remove('visible');
}

window.showToast   = showToast;
window.showTooltip = showTooltip;
window.hideTooltip = hideTooltip;
