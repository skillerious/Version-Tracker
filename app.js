(() => {
  'use strict';

  // ------------------------------
  // Small DOM helpers
  // ------------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const qs = new URLSearchParams(location.search);

  // Single place to keep the JSON once loaded so multiple features can use it
  let VERSIONS_DATA = null;

  // ------------------------------
  // Load JSON from /repoversion.json
  // ------------------------------
  async function loadData() {
    try {
      const res = await fetch('repoversion.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      document.body.innerHTML =
        '<pre class="json-out">' +
        JSON.stringify(
          { error: 'Failed to load repoversion.json', detail: String(e) },
          null,
          2
        ) +
        '</pre>';
      document.title = 'versions.json';
      throw e;
    }
  }

  // ------------------------------
  // Machine-readable endpoints (json/txt/ini/code)
  // ------------------------------
  function handleMachineEndpoints(data) {
    const format = (qs.get('format') || '').toLowerCase();
    if (!format) return false;

    const appId = qs.get('app');
    const trackKey = (qs.get('track') || 'stable').toLowerCase();
    const latestOnly = qs.get('latest') === '1';
    const apps = data.apps || [];
    const pickLatest = (app) =>
      (app.tracks && (app.tracks[trackKey] || app.tracks.stable)) || null;

    if (format === 'code') {
      if (!appId) {
        const lines = apps
          .map((a) => `${a.id}=${pickLatest(a)?.code ?? 0}`)
          .join('\n');
        document.body.innerHTML =
          '<pre class="json-out">' + lines + '</pre>';
        document.title = 'versions.txt';
        return true;
      } else {
        const app = apps.find((a) => a.id === appId);
        const code = String(app ? pickLatest(app)?.code ?? 0 : 0);
        document.body.innerHTML =
          '<pre class="json-out">' + code + '</pre>';
        document.title = `${appId}.code`;
        return true;
      }
    }

    if (format === 'txt' || format === 'ini') {
      const block = (app) => {
        const L = pickLatest(app) || {};
        if (format === 'ini') {
          return `[${app.id}]
name=${app.name || app.id}
track=${app.tracks && (app.tracks[trackKey] ? trackKey : 'stable')}
version=${L.version ?? ''}
code=${L.code ?? 0}
date=${L.date ?? ''}
url=${L.url ?? ''}
download=${L.download ?? ''}\n`;
        }
        return `app=${app.id}
name=${app.name || app.id}
track=${app.tracks && (app.tracks[trackKey] ? trackKey : 'stable')}
version=${L.version ?? ''}
code=${L.code ?? 0}
date=${L.date ?? ''}
url=${L.url ?? ''}
download=${L.download ?? ''}\n`;
      };

      if (appId) {
        const app = apps.find((a) => a.id === appId);
        const out = app ? block(app) : `error=app_not_found\napp=${appId}\n`;
        document.body.innerHTML =
          '<pre class="json-out">' + out + '</pre>';
        document.title = `${appId}.${format}`;
        return true;
      }
      if (latestOnly) {
        const out = apps
          .map(
            (a) =>
              `${a.id} ${pickLatest(a)?.code ?? 0} ${
                pickLatest(a)?.version ?? ''
              }`
          )
          .join('\n');
        document.body.innerHTML =
          '<pre class="json-out">' + out + '</pre>';
        document.title = 'latest.txt';
        return true;
      }
      const out = apps.map(block).join('\n');
      document.body.innerHTML =
        '<pre class="json-out">' + out + '</pre>';
      document.title = `versions.${format}`;
      return true;
    }

    if (format === 'json') {
      if (latestOnly) {
        const latest = {};
        for (const a of apps) {
          const L =
            (a.tracks && (a.tracks[trackKey] || a.tracks.stable)) || null;
          if (L) latest[a.id] = { version: L.version, code: L.code };
        }
        const out = {
          schemaVersion: data.schemaVersion,
          generated: data.generated,
          latest,
        };
        document.body.innerHTML =
          '<pre class="json-out">' + JSON.stringify(out, null, 2) + '</pre>';
        document.title = 'versions.json';
        return true;
      }
      if (appId) {
        const app = apps.find((a) => a.id === appId);
        if (!app) {
          const out = {
            error: 'app_not_found',
            app: appId,
            available: apps.map((a) => a.id),
          };
          document.body.innerHTML =
            '<pre class="json-out">' +
            JSON.stringify(out, null, 2) +
            '</pre>';
          document.title = 'versions.json';
          return true;
        }
        const L =
          (app.tracks && (app.tracks[trackKey] || app.tracks.stable)) ||
          null;
        const trackName = L
          ? (Object.entries(app.tracks).find(([, v]) => v === L) || [
              trackKey,
            ])[0]
          : trackKey;
        const out = {
          schemaVersion: data.schemaVersion,
          generated: data.generated,
          app: app.id,
          track: trackName,
          latest: L,
        };
        document.body.innerHTML =
          '<pre class="json-out">' + JSON.stringify(out, null, 2) + '</pre>';
        document.title = `${app.id}.json`;
        return true;
      }
      document.body.innerHTML =
        '<pre class="json-out">' + JSON.stringify(data, null, 2) + '</pre>';
      document.title = 'versions.json';
      return true;
    }

    return false;
  }

  // ------------------------------
  // Interactive UI
  // ------------------------------
  function initInteractive(data) {
    VERSIONS_DATA = data;

    // Schema + counters in hero
    $('#schema-ver').textContent = String(data.schemaVersion || '2');

    const appCountEl = document.getElementById('app-count');
    if (appCountEl) appCountEl.textContent = (data.apps || []).length;

    // Updated timestamp (UTC)
    try {
      const dt = new Date(data.generated);
      const fmtDate = dt.toLocaleString('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const fmtTime = dt.toLocaleString('en-GB', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      $('#updated-badge').textContent = `Updated ${fmtDate} • ${fmtTime} UTC`;
    } catch {
      $('#updated-badge').textContent = data.generated || '—';
    }

    // Elements
    const qInput = $('#q'),
      trackSel = $('#track'),
      sortSel = $('#sort'),
      tbody = $('#apps-body'),
      list = $('#m-list');

    const display = {
      version: (v) => (v && String(v).trim() ? v : '—'),
      codeText: (c) => (c && Number(c) !== 0 ? String(c) : '—'),
      codeValue: (c) => c ?? 0,
    };

    function toRows() {
      const rows = [];
      for (const app of data.apps || []) {
        for (const [track, latest] of Object.entries(app.tracks || {})) {
          rows.push({ app, track, latest });
        }
      }
      return rows;
    }

    function applyFilters(rows) {
      const q = (qInput.value || '').toLowerCase().trim();
      const t = (trackSel.value || 'all').toLowerCase();
      let out = rows.filter((r) => {
        const hit =
          !q ||
          r.app.id.toLowerCase().includes(q) ||
          (r.app.name || '').toLowerCase().includes(q) ||
          String(r.latest.code ?? '').includes(q) ||
          String(r.latest.version || '').toLowerCase().includes(q);
        const tk = t === 'all' || r.track === t;
        return hit && tk;
      });
      switch (sortSel.value) {
        case 'code_asc':
          out.sort(
            (a, b) => (a.latest.code ?? 0) - (b.latest.code ?? 0)
          );
          break;
        case 'name_asc':
          out.sort((a, b) =>
            (a.app.name || a.app.id).localeCompare(b.app.name || b.app.id)
          );
          break;
        case 'name_desc':
          out.sort((a, b) =>
            (b.app.name || b.app.id).localeCompare(a.app.name || a.app.id)
          );
          break;
        default:
          out.sort(
            (a, b) => (b.latest.code ?? 0) - (a.latest.code ?? 0)
          );
      }
      return out;
    }

    function renderTable(rows) {
      tbody.innerHTML = '';
      for (const r of rows) {
        const tr = document.createElement('tr');
        const links = [];
        if (r.latest.url)
          links.push(
            `<a href="${r.latest.url}" target="_blank" rel="noopener">release</a>`
          );
        if (r.latest.download)
          links.push(
            `<a href="${r.latest.download}" target="_blank" rel="noopener">download</a>`
          );
        if (r.latest.notes)
          links.push(`<span title="${r.latest.notes}">notes</span>`);
        tr.innerHTML = `
          <td><strong>${r.app.name || r.app.id}</strong></td>
          <td class="id">${r.app.id}</td>
          <td><span class="pill ${r.track === 'beta' ? 'beta' : 'ok'}">${
          r.track
        }</span></td>
          <td class="mono">${display.version(r.latest.version)}</td>
          <td class="mono">${display.codeText(r.latest.code)}</td>
          <td>${r.latest.date ?? '—'}</td>
          <td class="links">${links.join(' · ')}</td>`;
        tbody.appendChild(tr);
      }
    }

    function chevronSVG() {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    }

    function renderMobile(rows) {
      list.innerHTML = '';
      for (const r of rows) {
        const li = document.createElement('li');
        li.className = 'm-item';
        li.setAttribute('aria-expanded', 'false');

        const links = [];
        if (r.latest.url)
          links.push(
            `<a href="${r.latest.url}" target="_blank" rel="noopener">release</a>`
          );
        if (r.latest.download)
          links.push(
            `<a href="${r.latest.download}" target="_blank" rel="noopener">download</a>`
          );
        if (r.latest.notes)
          links.push(`<span title="${r.latest.notes}">notes</span>`);

        const ver = display.version(r.latest.version);
        const codeDisplay = display.codeText(r.latest.code);
        const codeCopy = display.codeValue(r.latest.code);

        li.innerHTML = `
          <div class="m-top">
            <div class="m-name">${r.app.name || r.app.id}</div>
            <div class="m-meta"><span class="m-ver">${ver}</span><span class="m-code">${codeDisplay}</span></div>
            <button class="chev" aria-label="Toggle details">${chevronSVG()}</button>
          </div>

          <div class="m-details">
            <div class="m-divider"></div>
            <div class="m-grid">
              <div class="m-label">Track</div><div><span class="pill ${
                r.track === 'beta' ? 'beta' : 'ok'
              }">${r.track}</span></div>
              <div class="m-label">App ID</div><div class="mono">${r.app.id}</div>
              <div class="m-label">Date</div><div>${r.latest.date ?? '—'}</div>
              <div class="m-label">Links</div><div class="links">${
                links.join(' · ') || '—'
              }</div>
            </div>
            <div class="m-actions">
              <button class="btn-mini" data-copy="code" data-val="${codeCopy}">Copy code</button>
              <button class="btn-mini" data-copy="endpoint" data-val="?format=code&app=${
                r.app.id
              }">Copy endpoint</button>
              <a class="btn-mini" href="?format=json&app=${
                r.app.id
              }" target="_blank" rel="noopener">Open JSON</a>
            </div>
          </div>
        `;

        li.querySelector('.chev').addEventListener('click', (e) => {
          e.stopPropagation();
          const open = li.getAttribute('aria-expanded') === 'true';
          li.setAttribute('aria-expanded', open ? 'false' : 'true');
        });

        li.addEventListener('click', (e) => {
          const btn = e.target.closest('.btn-mini, a');
          if (btn) return;
          const open = li.getAttribute('aria-expanded') === 'true';
          li.setAttribute('aria-expanded', open ? 'false' : 'true');
        });

        list.appendChild(li);
      }
    }

    // ---------- Custom app picker ----------
    const picker = $('#app-picker'),
      pickerBtn = $('#picker-btn'),
      pickerPanel = $('#picker-panel');

    const pickerList = $('#picker-list'),
      pickerSearch = $('#picker-search'),
      pickerValue = $('#picker-value');

    function buildPicker(appIds) {
      pickerList.innerHTML = '';
      appIds.forEach(({ id, name }) => {
        const li = document.createElement('li');
        li.className = 'picker-item';
        li.tabIndex = 0;
        li.setAttribute('role', 'option');
        li.dataset.value = id;
        li.innerHTML = `<span>${name || id}</span> <small>(${id})</small>`;
        const choose = () => {
          setPicker(id, name || id);
          closePicker();
          updateEndpointBoxes();
        };
        li.addEventListener('click', choose);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') choose();
        });
        pickerList.appendChild(li);
      });
      const first = appIds[0];
      if (first) setPicker(first.id, first.name || first.id);
    }
    function setPicker(id, label) {
      picker.dataset.value = id;
      pickerValue.textContent = `${label} (${id})`;
    }
    function openPicker() {
      picker.setAttribute('aria-expanded', 'true');
      pickerBtn.setAttribute('aria-expanded', 'true');
      pickerPanel.style.display = 'grid';
      pickerSearch.value = '';
      pickerSearch.focus();
      filterPicker();
    }
    function closePicker() {
      picker.setAttribute('aria-expanded', 'false');
      pickerBtn.setAttribute('aria-expanded', 'false');
      pickerPanel.style.display = 'none';
    }
    function filterPicker() {
      const q = (pickerSearch.value || '').toLowerCase().trim();
      $$('.picker-item', pickerList).forEach((li) => {
        const text = li.textContent.toLowerCase();
        li.style.display = text.includes(q) ? '' : 'none';
      });
    }
    pickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = picker.getAttribute('aria-expanded') === 'true';
      open ? closePicker() : openPicker();
    });
    pickerSearch.addEventListener('input', filterPicker);
    document.addEventListener('click', (e) => {
      if (!picker.contains(e.target)) closePicker();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePicker();
    });

    // ---------- Endpoint boxes (absolute URLs) ----------
    function setEndpointBox(boxSel, path) {
      const box = $(boxSel);
      const pathSpan = box.querySelector('.path');
      const epScroll = box.querySelector('.ep-scroll');
      const u = new URL(location.href);
      u.search = path.replace('./index.html', '').replace('./', '');
      pathSpan.textContent = path;

      const openId = boxSel.replace('#', '') + '-open';
      const a = document.getElementById(openId);
      if (a) a.href = u.toString();

      if (epScroll) epScroll.scrollLeft = 0;
    }
    function updateEndpointBoxes() {
      const id =
        picker.dataset.value || data.apps?.[0]?.id || 'your-app-id';
      setEndpointBox('#ep-all', `./index.html?format=json`);
      setEndpointBox('#ep-compact', `./index.html?format=json&latest=1`);
      setEndpointBox('#ep-one', `./index.html?format=json&app=${id}`);
      setEndpointBox('#ep-code', `./index.html?format=code&app=${id}`);
    }

    // ---------- Copy handlers (endpoints + mobile mini buttons) ----------
    document.addEventListener('click', async (e) => {
      const copyBtn = e.target.closest('[data-ep-copy]');
      if (copyBtn) {
        const sel = copyBtn.getAttribute('data-ep-copy');
        const box = $(sel);
        const path = box.querySelector('.path').textContent.trim();
        const url = new URL(location.href);
        url.search = path.replace('./index.html', '').replace('./', '');
        await copyText(url.toString(), copyBtn);
        return;
      }

      const mini = e.target.closest('.btn-mini[data-copy]');
      if (mini) {
        const val = mini.getAttribute('data-val') || '';
        let text = val;
        if (mini.getAttribute('data-copy') === 'endpoint') {
          const url = new URL(location.href);
          url.search = val;
          text = url.toString();
        }
        await copyText(String(text), mini);
      }
    });

    // ---------- Toolbar actions (robust + fallback) ----------
    const copyBtn = $('#btn-copy-json');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const url = new URL(location.href);
        url.search = '?format=json';
        await copyText(url.toString(), copyBtn);
      });
    }

    const downloadBtn = $('#btn-download-json');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        try {
          const blob = new Blob(
            [JSON.stringify(VERSIONS_DATA || {}, null, 2)],
            { type: 'application/json' }
          );
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'versions.json';
          // Ensure it's clickable in WebView
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            URL.revokeObjectURL(a.href);
            a.remove();
          }, 0);
        } catch (err) {
          alert('Download failed: ' + String(err));
        }
      });
    }

    // Build UI initially + wire filters
    function build() {
      const rows = applyFilters(toRows());
      renderTable(rows);
      renderMobile(rows);

      // Build app list for picker from visible rows; fall back to all
      const uniq = [];
      const seen = new Set();
      for (const r of rows) {
        if (!seen.has(r.app.id)) {
          seen.add(r.app.id);
          uniq.push({ id: r.app.id, name: r.app.name });
        }
      }
      if (uniq.length === 0) {
        const all = (data.apps || []).map((a) => ({
          id: a.id,
          name: a.name,
        }));
        buildPicker(all);
      } else {
        buildPicker(uniq);
      }

      updateEndpointBoxes();
      if (picker.getAttribute('aria-expanded') === 'true') pickerBtn.click();
    }

    qInput.addEventListener('input', build);
    trackSel.addEventListener('change', build);
    sortSel.addEventListener('change', build);

    build();

    // ------------------------------
    // Bottom navigation actions
    // ------------------------------
    const navExpand = document.getElementById('nav-expand');
    const navExpandList = document.getElementById('nav-expand-list');
    const navExpandIcon = document.getElementById('nav-expand-icon');

    if (navExpand && navExpandList && navExpandIcon) {
      navExpand.addEventListener('click', () => {
        navExpandList.classList.toggle('show-list');
        navExpandIcon.classList.toggle('rotate-icon');
      });
    }

    // Delegated clicks for nav + quick actions
    document.addEventListener('click', (e) => {
      const actEl = e.target.closest('[data-act]');
      if (!actEl) return;

      const act = actEl.getAttribute('data-act');

      switch (act) {
        case 'back':
          if (history.length > 1) history.back();
          break;
        case 'forward':
          history.forward();
          break;
        case 'about':
          openAbout();
          break;
        case 'home': {
          const url = new URL(location.href);
          url.search = '';
          url.hash = '';
          location.href = url.toString();
          break;
        }
        case 'refresh':
          location.reload();
          break;
        case 'top':
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        default:
          break;
      }
    });

    // ------------------------------
    // About dialog
    // ------------------------------
    const aboutModal = $('#about');
    const aboutCard = $('#about-card');
    const aboutClose = $('#about-close');

    function fillAbout() {
      $('#about-schema').textContent = String(
        VERSIONS_DATA?.schemaVersion ?? '—'
      );
      try {
        const dt = new Date(VERSIONS_DATA?.generated);
        const fmt = dt.toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'UTC',
        });
        $('#about-generated').textContent = fmt + ' UTC';
      } catch {
        $('#about-generated').textContent =
          VERSIONS_DATA?.generated ?? '—';
      }
      $('#about-count').textContent = String(
        VERSIONS_DATA?.apps?.length ?? 0
      );
    }

    function openAbout() {
      if (!aboutModal) return;
      fillAbout();
      aboutModal.setAttribute('aria-hidden', 'false');
      // focus the close button for accessibility
      aboutClose?.focus();
      document.addEventListener('keydown', onAboutKeydown);
    }
    function closeAbout() {
      if (!aboutModal) return;
      aboutModal.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onAboutKeydown);
      // return focus to the + button if available
      navExpand?.focus();
    }
    function onAboutKeydown(e) {
      if (e.key === 'Escape') closeAbout();
    }

    aboutClose?.addEventListener('click', closeAbout);
    aboutModal?.addEventListener('click', (e) => {
      if (e.target === aboutModal) closeAbout(); // backdrop click
    });
    // Prevent clicks inside the card from closing
    aboutCard?.addEventListener('click', (e) => e.stopPropagation());
  }

  // ------------------------------
  // Utilities
  // ------------------------------
  async function copyText(text, buttonEl) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for WebView / non-secure contexts
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      if (buttonEl) {
        const orig = buttonEl.textContent || buttonEl.innerHTML;
        buttonEl.textContent = 'Copied!';
        setTimeout(() => {
          // Restore safely
          if (buttonEl) {
            if (orig.includes('<')) buttonEl.innerHTML = orig;
            else buttonEl.textContent = orig;
          }
        }, 900);
      }
    } catch {
      alert(String(text));
    }
  }

  // ------------------------------
  // Boot
  // ------------------------------
  (async function boot() {
    const data = await loadData();

    // If ?format=... show machine output and stop everything else
    if (handleMachineEndpoints(data)) return;

    // Otherwise render full interactive UI
    initInteractive(data);
  })();
})();
