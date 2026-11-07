// ── State ──────────────────────────────────────────────────────
const MODEL_DEFAULTS = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-6-luna',
  gemini: 'gemini-3.8-flash',
  openrouter: 'openrouter/free',
  ollama: 'qwen3.5:4b',
};

const MODEL_OPTIONS = {
  anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-4-6'],
  openai: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.6-luna'],
  gemini: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.6-flash'],
  openrouter: ['openrouter/free', 'nvidia/nemotron-3.5-lightning:free', 'inclusionai/ling-3.0-flash-vl:free', 'google/gemini-3.8-flash', 'openai/gpt-6-luna'],
  ollama: ['qwen3.5:4b', 'gemma4:e2b', 'lfm2.5:8b', 'qwen3.5:9b', 'qwen3.6:27b'],
};

const LEGACY_DEFAULTS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5-mini-2025-08-07',
  gemini: 'gemini-2.5-flash',
  openrouter: 'google/gemini-2.0-flash-exp:free',
  ollama: 'qwen2.5:3b',
};

const STATIC_CACHE_BASE = '/static/projects/webofbabel/cache/';

// Default bookmarks. `cache` key maps to a static HTML file for pre-generated content.
const DEFAULT_BOOKMARKS = [
  { url: 'http://www.google.com', title: 'Google', cache: 'google' },
  { url: 'http://www.google.com/search?q=the+library+of+babel', title: 'library of babel - Google Search',
    cache: 'google_search'},
  { url: 'http://news.ycombinator.com', title: 'Hacker News', cache: 'hackernews' },
  { url: 'http://news.bbc.co.uk/1815/06/18/europe', title: 'BBC News - 18 June 1815', cache: 'bbc_1815' },
  { url: 'http://x.com/elonmusk', title: 'Elon Musk (@elonmusk) / X', cache: 'x_elonmusk' },
  { url: 'http://calendar.google.com/calendar/u/0/r/week', title: 'Google Calendar', cache: 'google_calendar' },
  { url: 'http://www.lonelyplanet.com/europe/berlin', title: 'Berlin - Lonely Planet', cache: 'lonelyplanet_berlin' },
  { url: 'http://www.geocities.com/~magic_crystals', title: 'GeoCities: Magic Crystals', cache: 'geocities_crystals' },
  { url: 'https://apps.apple.com/us/iphone/apps', title: 'Appstore - iPhone Apps', cache: 'app_store' },
  { url: 'https://apps.apple.com/us/app/luminary-ai-photo-editor/id1591756870',
    title: 'Luminary AI Photo Editor', cache: 'luminary_ai' },
  {url: 'http://www.internetlastpage.com/', title: 'The Last Page of the Internet - InternetLastPage.com',
    cache: 'last_page'},
  { url: 'https://douwe.com/projects/webofbabel', title: 'The Web of Babel (as seen by itself)', cache: 'webofbabel' },
];

const state = {
  history: [],       // [{ url, title, summary, html }]
  historyIndex: -1,
  currentUrl: '',
  currentHtml: '',
  pageCache: {},    // url → html
  loading: false,
  abortController: null,
  bookmarks: [],
  config: {
    provider: 'anthropic',
    providers: {
      anthropic: { model: MODEL_DEFAULTS.anthropic, key: '' },
      openai:    { model: MODEL_DEFAULTS.openai, key: '' },
      gemini:    { model: MODEL_DEFAULTS.gemini, key: '' },
      openrouter: { model: MODEL_DEFAULTS.openrouter, key: '' },
      ollama:    { model: MODEL_DEFAULTS.ollama, key: '', ollamaUrl: 'http://localhost:11434' },
    },
  },
};

// Flat view of current provider's config for the generation layer
function getActiveConfig() {
  const p = state.config.provider;
  const pc = state.config.providers[p];
  return { provider: p, model: pc.model, key: pc.key, ollamaUrl: pc.ollamaUrl || '' };
}

// ── Config persistence ─────────────────────────────────────────
function loadConfig() {
  try {
    const savedV3 = localStorage.getItem('webofbabel_config_v3');
    const saved = JSON.parse(savedV3 || localStorage.getItem('webofbabel_config_v2'));
    if (saved) {
      state.config.provider = saved.provider || state.config.provider;
      for (const p of ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama']) {
        if (saved.providers?.[p]) Object.assign(state.config.providers[p], saved.providers[p]);
      }
      if (!savedV3) {
        for (const p of Object.keys(LEGACY_DEFAULTS)) {
          if (state.config.providers[p].model === LEGACY_DEFAULTS[p]) {
            state.config.providers[p].model = MODEL_DEFAULTS[p];
          }
        }
        localStorage.setItem('webofbabel_config_v3', JSON.stringify(state.config));
      }
    }
  } catch {}
  populateConfigUI();
}

function populateConfigUI() {
  const p = state.config.provider;
  const pc = state.config.providers[p];
  document.getElementById('cfg-provider').value = p;
  document.getElementById('cfg-key').value = pc.key;
  document.getElementById('cfg-ollama-url').value = state.config.providers.ollama.ollamaUrl;
  const isOllama = p === 'ollama';
  document.getElementById('ollama-url-row').classList.toggle('show', isOllama);
  document.getElementById('ollama-help-row').classList.toggle('show', isOllama);
  document.getElementById('anthropic-help-row').classList.toggle('show', p === 'anthropic');
  document.getElementById('gemini-help-row').classList.toggle('show', p === 'gemini');
  document.getElementById('openrouter-help-row').classList.toggle('show', p === 'openrouter');
  document.getElementById('api-key-row').style.display = isOllama ? 'none' : '';

  const select = document.getElementById('cfg-model');
  select.innerHTML = '';
  for (const m of (MODEL_OPTIONS[p] || [])) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = 'Custom...';
  select.appendChild(customOpt);

  const models = MODEL_OPTIONS[p] || [];
  if (models.includes(pc.model)) {
    select.value = pc.model;
    document.getElementById('custom-model-row').style.display = 'none';
  } else {
    select.value = '__custom__';
    document.getElementById('cfg-custom-model').value = pc.model;
    document.getElementById('custom-model-row').style.display = '';
  }
}

function onModelSelectChange() {
  const val = document.getElementById('cfg-model').value;
  document.getElementById('custom-model-row').style.display = val === '__custom__' ? '' : 'none';
}

function getSelectedModel() {
  const val = document.getElementById('cfg-model').value;
  return val === '__custom__' ? document.getElementById('cfg-custom-model').value : val;
}

function saveConfig() {
  const p = document.getElementById('cfg-provider').value;
  state.config.provider = p;
  state.config.providers[p].model = getSelectedModel();
  state.config.providers[p].key = document.getElementById('cfg-key').value;
  if (p === 'ollama') {
    state.config.providers.ollama.ollamaUrl = document.getElementById('cfg-ollama-url').value;
  }
  localStorage.setItem('webofbabel_config_v3', JSON.stringify(state.config));
  closeConfig();
  // If we're on a page that failed to load (no cached content), retry
  if (state.currentUrl && state.currentUrl !== 'about:babel' && !state.currentHtml) {
    generate(state.currentUrl);
  }
}

function onProviderChange() {
  const oldP = state.config.provider;
  state.config.providers[oldP].model = getSelectedModel();
  state.config.providers[oldP].key = document.getElementById('cfg-key').value;
  if (oldP === 'ollama') {
    state.config.providers.ollama.ollamaUrl = document.getElementById('cfg-ollama-url').value;
  }
  state.config.provider = document.getElementById('cfg-provider').value;
  populateConfigUI();
}

function openConfig() {
  document.getElementById('config-overlay').classList.add('open');
  loadConfig();
}

function closeConfig() {
  document.getElementById('config-overlay').classList.remove('open');
}

// ── Bookmarks ──────────────────────────────────────────────────
const BOOKMARKS_VERSION = 7;

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch {}
  return url;
}

function loadBookmarks() {
  try {
    const ver = localStorage.getItem('webofbabel_bookmarks_version');
    if (ver && parseInt(ver) >= BOOKMARKS_VERSION) {
      const saved = JSON.parse(localStorage.getItem('webofbabel_bookmarks'));
      if (Array.isArray(saved)) {
        state.bookmarks = saved.map(b => ({ ...b, url: normalizeUrl(b.url) }));
        return;
      }
    }
  } catch {}
  state.bookmarks = DEFAULT_BOOKMARKS.map(b => ({ ...b, url: normalizeUrl(b.url) }));
  localStorage.setItem('webofbabel_bookmarks_version', String(BOOKMARKS_VERSION));
  saveBookmarks();
}

function saveBookmarks() {
  localStorage.setItem('webofbabel_bookmarks', JSON.stringify(state.bookmarks));
}

// Load cached HTML for a bookmark — check localStorage first, then static files
async function loadBookmarkCache(bookmark) {
  const url = bookmark.url;
  // Already in page cache?
  if (state.pageCache[url]) return;
  // Check localStorage
  const lsKey = 'webofbabel_page_' + url;
  const stored = localStorage.getItem(lsKey);
  if (stored) { state.pageCache[url] = stored; return; }
  // Try static cache file
  if (bookmark.cache) {
    try {
      const res = await fetch(STATIC_CACHE_BASE + bookmark.cache + '.html');
      if (res.ok) {
        const html = await res.text();
        state.pageCache[url] = html;
      }
    } catch {}
  }
}

// Preload all bookmark caches
async function preloadBookmarkCaches() {
  await Promise.all(state.bookmarks.map(b => loadBookmarkCache(b)));
}

function addBookmark() {
  if (!state.currentUrl || state.currentUrl === 'about:babel') return;
  const existing = state.bookmarks.find(b => b.url === state.currentUrl);
  if (existing) return;
  const entry = state.history[state.historyIndex];
  const title = entry?.title || state.currentUrl;
  state.bookmarks.push({ url: state.currentUrl, title });
  // Save the page HTML to localStorage for this bookmark
  if (state.currentHtml) {
    localStorage.setItem('webofbabel_page_' + state.currentUrl, state.currentHtml);
  }
  saveBookmarks();
  renderBookmarks();
}

function removeBookmark(idx) {
  const bookmark = state.bookmarks[idx];
  if (bookmark) {
    try { localStorage.removeItem('webofbabel_page_' + bookmark.url); } catch {}
  }
  state.bookmarks.splice(idx, 1);
  saveBookmarks();
  renderBookmarks();
}

function renderBookmarks() {
  const list = document.getElementById('bookmarks-list');
  list.innerHTML = '';
  state.bookmarks.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'dropdown-item';
    el.innerHTML = `<span class="remove-btn" onclick="event.stopPropagation(); removeBookmark(${i})">x</span>${esc(b.title || b.url)}<span class="url">${esc(b.url)}</span>`;
    el.onclick = () => { closeAllDropdowns(); navigate(b.url); };
    list.appendChild(el);
  });
}

// ── View Source ────────────────────────────────────────────────
function showViewSource() {
  if (!state.currentHtml) return;
  document.getElementById('source-title').textContent = 'Source of: ' + state.currentUrl;
  document.getElementById('source-content').textContent = state.currentHtml;
  document.getElementById('source-overlay').classList.add('open');
}

function copySource() {
  navigator.clipboard.writeText(state.currentHtml).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy HTML', 1500);
  });
}

function savePage() {
  if (!state.currentHtml) return;
  const blob = new Blob([state.currentHtml], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  // Turn URL into a reasonable filename
  let name = state.currentUrl.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_+$/, '');
  a.download = (name || 'page') + '.html';
  a.click();
  URL.revokeObjectURL(a.href);
}

function closeViewSource() {
  document.getElementById('source-overlay').classList.remove('open');
}

// ── Title bar & favicon ────────────────────────────────────────
function setTitleBar(title) {
  const text = title ? title + ' - The Web of Babel' : 'The Web of Babel';
  document.getElementById('titlebar-text').textContent = text;
  document.title = text;
}

function updateFavicon(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const iconLink = doc.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
  const href = iconLink?.getAttribute('href');
  const favicon = document.getElementById('titlebar-favicon');
  if (href && href.startsWith('data:')) {
    favicon.src = href;
    favicon.style.display = '';
  } else {
    favicon.style.display = 'none';
  }
}

// ── UI helpers ─────────────────────────────────────────────────
function setStatus(text) {
  document.getElementById('status-text').textContent = text;
}

function setProgress(pct) {
  document.getElementById('progress-bar').style.width = pct + '%';
}

function setLoading(on) {
  state.loading = on;
  if (!on) {
    setProgress(100);
    setTimeout(() => setProgress(0), 400);
  }
}

function updateNavButtons() {
  document.getElementById('btn-back').classList.toggle('disabled', state.historyIndex <= 0);
  document.getElementById('btn-forward').classList.toggle('disabled', state.historyIndex >= state.history.length - 1);
}

// ── Dropdown menus ─────────────────────────────────────────────
function closeAllDropdowns() {
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
}

function toggleDropdown(id) {
  const dd = document.getElementById(id);
  const wasOpen = dd.classList.contains('open');
  closeAllDropdowns();
  if (!wasOpen) dd.classList.add('open');
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.menu-wrapper')) closeAllDropdowns();
});

function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  if (state.history.length === 0) {
    list.innerHTML = '<div class="dropdown-empty">No history yet</div>';
    return;
  }
  for (let i = state.history.length - 1; i >= 0; i--) {
    const h = state.history[i];
    const el = document.createElement('div');
    el.className = 'dropdown-item';
    el.innerHTML = `${esc(h.title || h.url)}<span class="url">${esc(h.url)}</span>`;
    el.onclick = () => { closeAllDropdowns(); navigate(h.url); };
    list.appendChild(el);
  }
}

// ── Iframe rendering ───────────────────────────────────────────
function addInterceptor(html, baseUrl) {
  const safeBaseUrl = JSON.stringify(baseUrl).replace(/</g, '\\u003c');
  const safeParentOrigin = JSON.stringify(window.location.origin);
  return html + `<script>
    var __baseUrl = ${safeBaseUrl};
    var __parentOrigin = ${safeParentOrigin};
    document.addEventListener('click', function(e) {
      var a = e.target.closest('a');
      if (!a) return;
      var raw = a.getAttribute('href');
      if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) return;
      e.preventDefault();
      var resolved;
      try { resolved = new URL(raw, __baseUrl).href; } catch { resolved = raw; }
      var linkText = (a.textContent || '').trim().substring(0, 200);
      window.parent.postMessage({ type: 'navigate', url: resolved, linkText: linkText }, __parentOrigin);
    });
    document.addEventListener('submit', function(e) {
      e.preventDefault();
      var form = e.target;
      var data = {};
      new FormData(form).forEach(function(v, k) { data[k] = v; });
      var action = form.getAttribute('action') || '';
      var resolved;
      try { resolved = new URL(action, __baseUrl).href; } catch { resolved = action || __baseUrl; }
      var method = (form.method || 'GET').toUpperCase();
      if (method === 'GET') {
        var qs = new URLSearchParams(data).toString();
        resolved = resolved.split('?')[0] + (qs ? '?' + qs : '');
        window.parent.postMessage({ type: 'navigate', url: resolved }, __parentOrigin);
      } else {
        window.parent.postMessage({ type: 'navigate', url: resolved, formData: data }, __parentOrigin);
      }
    });
  <\/script>`;
}

function writeToIframe(iframe, html, baseUrl) {
  iframe.srcdoc = addInterceptor(html, baseUrl || 'about:blank');
}

// ── Navigation ─────────────────────────────────────────────────
function stopGeneration() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  setLoading(false);
  setStatus('Stopped');
}

function setCacheBadge(visible) {
  document.getElementById('cache-badge').classList.toggle('visible', visible);
}

function regenerateCurrent() {
  if (!state.currentUrl || state.currentUrl === 'about:babel') return;
  delete state.pageCache[state.currentUrl];
  try { localStorage.removeItem('webofbabel_page_' + state.currentUrl); } catch {}
  setCacheBadge(false);
  generate(state.currentUrl);
}

function showCachedPage(url) {
  const cached = state.pageCache[url];
  if (!cached) return false;
  if (state.loading) stopGeneration();
  state.currentUrl = url;
  state.currentHtml = cached;
  document.getElementById('url-input').value = url;
  location.hash = url;
  const iframe = document.getElementById('viewport');
  writeToIframe(iframe, cached, url);
  const titleMatch = cached.match(/<title[^>]*>(.*?)<\/title>/is);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : url;
  setTitleBar(title);
  updateFavicon(cached);
  setCacheBadge(true);
  setStatus(`Document: Done (${formatBytes(cached.length)}) - cached`);
  return true;
}

function goBack() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    showHistoryEntry(state.history[state.historyIndex]);
  }
}

function goForward() {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    showHistoryEntry(state.history[state.historyIndex]);
  }
}

function showHistoryEntry(entry) {
  updateNavButtons();
  if (entry.url === 'about:babel') {
    showAbout();
    return;
  }
  if (!showCachedPage(entry.url)) {
    state.currentUrl = entry.url;
    document.getElementById('url-input').value = entry.url;
    location.hash = entry.url;
    generate(entry.url);
  }
}

function navigate(url, linkText, formData) {
  url = url.trim();
  if (!url) return;
  if (!/^[a-z]+:/i.test(url)) url = 'http://' + url;
  url = normalizeUrl(url);

  if (url === 'about:config') {
    openConfig();
    return;
  }

  state.historyIndex++;
  state.history.splice(state.historyIndex);
  state.history.push({ url, title: url, summary: '', linkText: linkText || '', formData: formData || null });
  updateNavButtons();
  renderHistory();

  if (url === 'about:babel') {
    showAbout();
    return;
  }

  // Use cache if available and no form data (form submissions always regenerate)
  if (!formData && showCachedPage(url)) return;

  state.currentUrl = url;
  document.getElementById('url-input').value = url;
  location.hash = url;

  generate(url);
}

function reload() {
  if (state.loading || !state.currentUrl || state.currentUrl === 'about:babel') return;
  delete state.pageCache[state.currentUrl];
  generate(state.currentUrl);
}

// ── Netscape-style status sequence ─────────────────────────────
function extractHost(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function startConnectionStatus(url) {
  const host = extractHost(url);
  const steps = [
    { text: `Looking up host: ${host}...`, delay: 0, progress: 5 },
    { text: `Contacting host: ${host}...`, delay: 400, progress: 15 },
    { text: `Host contacted. Waiting for reply...`, delay: 800, progress: 25 },
  ];
  let cancelled = false;
  const timers = [];
  for (const step of steps) {
    timers.push(setTimeout(() => {
      if (!cancelled) {
        setStatus(step.text);
        setProgress(step.progress);
      }
    }, step.delay));
  }
  return () => { cancelled = true; timers.forEach(clearTimeout); };
}

function formatBytes(n) {
  if (n < 1024) return n + ' bytes';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'K';
  return (n / (1024 * 1024)).toFixed(1) + 'M';
}

// ── Page generation ────────────────────────────────────────────
async function generate(url) {
  if (state.loading) stopGeneration();

  setLoading(true);
  setCacheBadge(false);
  setTitleBar(url);
  const cancelStatus = startConnectionStatus(url);

  // Snapshot the history index — it may change during async generation
  const entryIndex = state.historyIndex;
  state.abortController = new AbortController();
  const currentEntry = state.history[entryIndex];
  const messages = buildMessages(url, state.history, entryIndex, currentEntry?.linkText, currentEntry?.formData);
  const iframe = document.getElementById('viewport');
  state.currentHtml = '';
  iframe.srcdoc = '<p style="font-family: sans-serif">Loading...</p>';
  let html = '';
  let lastRender = 0;
  let firstChunk = true;
  let transferStart = 0;
  const RENDER_INTERVAL = 150;

  try {
    for await (const chunk of complete(messages, getActiveConfig(), state.abortController.signal)) {
      if (firstChunk) {
        cancelStatus();
        transferStart = Date.now();
        firstChunk = false;
        setStatus('Transferring data from ' + extractHost(url) + '...');
        setProgress(30);
      }

      html += chunk;
      const now = Date.now();
      if (now - lastRender >= RENDER_INTERVAL) {
        lastRender = now;

        const elapsed = (now - transferStart) / 1000;
        const rate = elapsed > 0 ? html.length / elapsed : 0;
        setStatus(`Transferring data... ${formatBytes(html.length)} (${formatBytes(Math.round(rate))}/sec)`);
        setProgress(Math.min(90, 30 + html.length * 0.004));

        // Update title bar progressively if we see a <title>
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
        if (titleMatch) setTitleBar(titleMatch[1].replace(/<[^>]*>/g, '').trim());

        await new Promise(r => setTimeout(r, 0));
      }
    }
    cancelStatus();
    writeToIframe(iframe, html, url);
    setLoading(false);

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
    const pageTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : url;

    state.currentHtml = html;
    state.pageCache[url] = html;
    // Persist to localStorage if this URL is bookmarked
    if (state.bookmarks.some(b => b.url === url)) {
      try { localStorage.setItem('webofbabel_page_' + url, html); } catch {}
    }
    const entry = state.history[entryIndex];
    if (entry) {
      entry.title = pageTitle.slice(0, 80);
      const textContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      entry.summary = textContent.slice(0, 150);
    }
    renderHistory();
    setTitleBar(pageTitle);
    updateFavicon(html);
    setStatus(`Document: Done (${formatBytes(html.length)})`);

  } catch (err) {
    cancelStatus();
    if (err.name === 'AbortError') {
      setStatus('Stopped');
    } else if (err.message === '__NO_KEY__') {
      setStatus('API key required');
      openConfig();
    } else {
      setStatus('Error: ' + err.message);
      writeToIframe(iframe, `<h2>Error</h2><pre>${esc(err.message)}</pre>`);
      if (err.openConfig) openConfig();
    }
    setLoading(false);
  }
}

// ── About page ─────────────────────────────────────────────────
async function loadHomePage() {
  if (state.pageCache['about:babel']) return;
  try {
    const res = await fetch(STATIC_CACHE_BASE + 'home.html');
    if (res.ok) state.pageCache['about:babel'] = await res.text();
  } catch {}
}

function showAbout() {
  const html = state.pageCache['about:babel'] || '<h1>The Web of Babel</h1><p>Loading...</p>';
  const iframe = document.getElementById('viewport');
  writeToIframe(iframe, html);
  state.currentUrl = 'about:babel';
  state.currentHtml = html;
  document.getElementById('url-input').value = 'about:babel';
  location.hash = 'about:babel';
  setCacheBadge(false);
  setTitleBar(null);
  setStatus('Ready');
}

// ── Message listener for iframe link clicks ────────────────────
window.addEventListener('message', function(e) {
  const iframe = document.getElementById('viewport');
  if (e.source === iframe.contentWindow && e.origin === 'null' && e.data && e.data.type === 'navigate' && e.data.url) {
    navigate(e.data.url, e.data.linkText, e.data.formData);
  }
});

// ── Init ───────────────────────────────────────────────────────
loadConfig();
loadBookmarks();
renderBookmarks();
(async function() {
  await Promise.all([loadHomePage(), preloadBookmarkCaches()]);
  const startUrl = location.hash.slice(1);
  if (startUrl) {
    navigate(startUrl);
  } else {
    navigate('about:babel');
  }
})();
