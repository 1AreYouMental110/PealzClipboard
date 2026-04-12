// ── Emoji Tab Logic ──────────────────────────────────────────────────────────

const EmojiTab = (() => {

  let favorites    = new Set();
  let activeCategory = 'Favorites';
  let searchQuery  = '';
  let renderTimer  = null;

  const gridEl     = () => document.getElementById('emojiGrid');
  const searchEl   = () => document.getElementById('emojiSearch');
  const clearBtnEl = () => document.getElementById('emojiSearchClear');
  const catsEl     = () => document.getElementById('emojiCategories');
  const hintEl     = () => document.getElementById('emojiHint');

  // ── Load favorites ────────────────────────────────────────────────────────
  async function loadFavorites() {
    const favList = await window.api.getEmojiFavorites();
    favorites = new Set(favList);
  }

  // ── Category pills ────────────────────────────────────────────────────────
  function buildCategories() {
    const cats = catsEl();
    cats.textContent = '';

    EMOJI_CATEGORIES.forEach(cat => {
      const pill = document.createElement('button');
      pill.className   = 'cat-pill' + (cat === activeCategory ? ' active' : '');
      pill.textContent = cat === 'Favorites' ? '⭐ Favorites' : cat;
      pill.dataset.cat = cat;

      pill.addEventListener('click', () => {
        activeCategory = cat;
        searchEl().value = '';
        searchQuery = '';
        clearBtnEl().classList.add('hidden');
        cats.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        Sounds.tab();
        renderGrid();
      });

      cats.appendChild(pill);
    });
  }

  // ── Grid render ───────────────────────────────────────────────────────────
  function getVisibleEmojis() {
    if (searchQuery.trim()) {
      return searchEmojis(searchQuery);
    }
    if (activeCategory === 'Favorites') {
      return EMOJIS.filter(e => favorites.has(e.e));
    }
    return EMOJIS.filter(e => e.c === activeCategory);
  }

  function renderGrid() {
    const grid  = gridEl();
    grid.textContent = '';

    const visible = getVisibleEmojis();

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className   = 'empty-state';
      empty.style.gridColumn = '1/-1';

      const icon = document.createElement('div');
      icon.className   = 'empty-icon';
      icon.textContent = searchQuery ? '🔍' : '⭐';
      const title = document.createElement('div');
      title.className  = 'empty-title';
      title.textContent = searchQuery ? 'No emojis found' : 'No favorites yet';
      const sub = document.createElement('div');
      sub.className   = 'empty-sub';
      sub.textContent = searchQuery ? 'Try a different search term' : 'Long-press an emoji to star it';

      empty.appendChild(icon);
      empty.appendChild(title);
      empty.appendChild(sub);
      grid.appendChild(empty);

      hintEl().textContent = '';
      return;
    }

    const frag = document.createDocumentFragment();
    visible.forEach((emoji, idx) => {
      frag.appendChild(buildEmojiBtn(emoji, idx));
    });
    grid.appendChild(frag);

    hintEl().textContent = `${visible.length} emoji${visible.length !== 1 ? 's' : ''}`;
  }

  function buildEmojiBtn(emoji, idx) {
    const btn = document.createElement('button');
    btn.className   = 'emoji-btn' + (favorites.has(emoji.e) ? ' favorited' : '');
    btn.textContent = emoji.e;
    btn.title       = emoji.n + (emoji.a.length ? ` (${emoji.a.slice(0,3).join(', ')})` : '');
    btn.style.animationDelay = `${Math.min(idx * 8, 150)}ms`;

    // Click = copy (+ auto-paste if user was in a text field)
    btn.addEventListener('click', async () => {
      const result = await window.api.copyEmoji({ emoji: emoji.e });
      Sounds.emoji();
      showToast(result && result.willPaste ? `${emoji.e} Pasted!` : `${emoji.e} Copied!`);
    });

    // Right-click = toggle favorite
    btn.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const isFav = favorites.has(emoji.e);
      await window.api.toggleEmojiFavorite({ emoji: emoji.e, isFav: !isFav });
      if (!isFav) {
        favorites.add(emoji.e);
        btn.classList.add('favorited');
        showToast('⭐ Added to favorites');
      } else {
        favorites.delete(emoji.e);
        btn.classList.remove('favorited');
        showToast('Removed from favorites');
      }
      Sounds.favorite();
    });

    // Hover tooltip with name
    btn.addEventListener('mouseenter', () => {
      hintEl().textContent = `${emoji.e}  ${emoji.n}`;
    });
    btn.addEventListener('mouseleave', () => {
      hintEl().textContent = getVisibleEmojis().length + ' emojis';
    });

    return btn;
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    await loadFavorites();
    buildCategories();
    renderGrid();

    searchEl().addEventListener('input', (e) => {
      searchQuery = e.target.value;
      clearBtnEl().classList.toggle('hidden', !searchQuery);
      clearTimeout(renderTimer);
      renderTimer = setTimeout(renderGrid, 80);
    });

    clearBtnEl().addEventListener('click', () => {
      searchEl().value = '';
      searchQuery      = '';
      clearBtnEl().classList.add('hidden');
      renderGrid();
    });
  }

  function refresh() {
    loadFavorites().then(renderGrid);
  }

  return { init, refresh };
})();

window.EmojiTab = EmojiTab;
