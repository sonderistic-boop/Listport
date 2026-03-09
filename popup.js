// Reading List Exporter v3.0.0

let allItems = [];
let filtered = [];
let activeStatus = 'all';

// ── Helpers ──────────────────────────────────────────────

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function normalizeMs(ts) {
  if (!ts) return null;
  return ts > 32503680000000 ? Math.floor(ts / 1000) : ts;
}

function toDateStr(ts) {
  // Returns "YYYY-MM-DD" for date input comparison
  const ms = normalizeMs(ts);
  if (!ms) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function formatIso(ts) {
  const ms = normalizeMs(ts);
  return ms ? new Date(ms).toISOString() : null;
}

function daysSince(ts) {
  const ms = normalizeMs(ts);
  return ms ? Math.floor((Date.now() - ms) / 86400000) : null;
}

function setStatus(msg, type = '') {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  if (msg && type === 'ok') setTimeout(() => { el.textContent = ''; el.className = 'status-msg'; }, 2500);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

// ── Fetch ─────────────────────────────────────────────────

async function fetchReadingList() {
  const entries = await chrome.readingList.query({});
  return entries.map(e => ({
    title:       e.title || e.url,
    url:         e.url,
    domain:      getDomain(e.url),
    dateAdded:   e.creationTime || null,
    dateStr:     toDateStr(e.creationTime),
    hasBeenRead: e.hasBeenRead || false,
  }));
}

// ── Filter + Sort ─────────────────────────────────────────

function applyFilters() {
  const site    = document.getElementById('siteFilter').value;
  const keyword = document.getElementById('searchInput').value.trim().toLowerCase();
  const sort    = document.getElementById('sortSelect').value;
  const from    = document.getElementById('dateFrom').value;   // "YYYY-MM-DD" or ""
  const to      = document.getElementById('dateTo').value;

  filtered = allItems.filter(item => {
    if (activeStatus === 'read'   && !item.hasBeenRead) return false;
    if (activeStatus === 'unread' &&  item.hasBeenRead) return false;
    if (site !== 'all' && item.domain !== site) return false;
    if (keyword && !item.title.toLowerCase().includes(keyword) && !item.url.toLowerCase().includes(keyword)) return false;
    if (from && item.dateStr && item.dateStr < from) return false;
    if (to   && item.dateStr && item.dateStr > to)   return false;
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    if (sort === 'newest') return (b.dateAdded || 0) - (a.dateAdded || 0);
    if (sort === 'oldest') return (a.dateAdded || 0) - (b.dateAdded || 0);
    if (sort === 'az')     return a.title.localeCompare(b.title);
    if (sort === 'za')     return b.title.localeCompare(a.title);
    return 0;
  });

  renderPreview();
  document.getElementById('filteredCount').textContent = filtered.length;
}

// ── Preview ───────────────────────────────────────────────

function renderPreview() {
  const list = document.getElementById('previewList');

  if (!filtered.length) {
    list.innerHTML = '<div class="preview-empty">No items match</div>';
    return;
  }

  list.innerHTML = filtered.map(item => `
    <div class="preview-item">
      <div class="status-dot ${item.hasBeenRead ? 'read' : ''}"></div>
      <span class="item-title" title="${item.title.replace(/"/g, '&quot;')}">${item.title}</span>
      <span class="item-domain">${item.domain}</span>
    </div>
  `).join('');
}

// ── Export helpers ────────────────────────────────────────

function buildJsonPayload() {
  return {
    exportedAt: new Date().toISOString(),
    source: 'Chrome/Brave Reading List',
    count: filtered.length,
    items: filtered.map(item => ({
      title:       item.title,
      url:         item.url,
      domain:      item.domain,
      dateAdded:   formatIso(item.dateAdded),
      hasBeenRead: item.hasBeenRead,
    })),
  };
}

function buildHtml() {
  const rows = filtered.map(item => {
    const ms = normalizeMs(item.dateAdded);
    const ts = ms ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
    const title = item.title.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const url   = item.url.replace(/&/g, '&amp;');
    return `        <DT><A HREF="${url}" ADD_DATE="${ts}">${title}</A>`;
  }).join('\n');

  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- Exported by Reading List Exporter v3.0.0 -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="${Math.floor(Date.now() / 1000)}">Reading List</H3>
    <DL><p>
${rows}
    </DL><p>
</DL><p>`;
}

// ── Init ──────────────────────────────────────────────────

async function init() {
  try {
    allItems = await fetchReadingList();
  } catch (err) {
    document.getElementById('previewList').innerHTML =
      `<div class="preview-empty">Error: ${err.message}</div>`;
    return;
  }

  // Stats
  const unread  = allItems.filter(i => !i.hasBeenRead).length;
  const domains = [...new Set(allItems.map(i => i.domain))].sort();

  document.getElementById('statTotal').textContent  = allItems.length;
  document.getElementById('statUnread').textContent = unread;

  // Site dropdown
  const siteSelect = document.getElementById('siteFilter');
  domains.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    siteSelect.appendChild(opt);
  });

  // Initial render
  applyFilters();

  // ── Listeners ──

  document.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeStatus = pill.dataset.status;
      applyFilters();
    });
  });

  ['siteFilter', 'sortSelect'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilters));

  ['searchInput', 'dateFrom', 'dateTo'].forEach(id =>
    document.getElementById(id).addEventListener('input', applyFilters));

  document.getElementById('btnExportJson').addEventListener('click', () => {
    if (!filtered.length) { setStatus('Nothing to export', 'err'); return; }
    downloadFile(JSON.stringify(buildJsonPayload(), null, 2), `reading-list-${Date.now()}.json`, 'application/json');
    setStatus(`Saved ${filtered.length} items`, 'ok');
  });

  document.getElementById('btnExportHtml').addEventListener('click', () => {
    if (!filtered.length) { setStatus('Nothing to export', 'err'); return; }
    downloadFile(buildHtml(), `reading-list-${Date.now()}.html`, 'text/html');
    setStatus(`Saved ${filtered.length} items`, 'ok');
  });

  document.getElementById('btnCopyUrls').addEventListener('click', async () => {
    if (!filtered.length) { setStatus('Nothing to copy', 'err'); return; }
    await copyText(filtered.map(i => i.url).join('\n'));
    setStatus(`Copied ${filtered.length} URLs`, 'ok');
  });

  document.getElementById('btnCopyJson').addEventListener('click', async () => {
    if (!filtered.length) { setStatus('Nothing to copy', 'err'); return; }
    await copyText(JSON.stringify(buildJsonPayload(), null, 2));
    setStatus(`Copied JSON`, 'ok');
  });
}

init();
