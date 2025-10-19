(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const qs = new URLSearchParams(location.search);

  /* ----------------------- data ----------------------- */
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

  /* ---------------- machine endpoints ---------------- */
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
        document.body.innerHTML = '<pre class="json-out">' + lines + '</pre>';
        document.title = 'versions.txt';
        return true;
      } else {
        const app = apps.find((a) => a.id === appId);
        const code = String(app ? pickLatest(app)?.code ?? 0 : 0);
        document.body.innerHTML = '<pre class="json-out">' + code + '</pre>';
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
        document.body.innerHTML = '<pre class="json-out">' + out + '</pre>';
        document.title = `${appId}.${format}`;
        return true;
      }
      if (latestOnly) {
        const out = apps
          .map(
            (a) => `${a.id} ${pickLatest(a)?.code ?? 0} ${pickLatest(a)?.version ?? ''}`
          )
          .join('\n');
        document.body.innerHTML = '<pre class="json-out">' + out + '</pre>';
        document.title = 'latest.txt';
        return true;
      }
      const out = apps.map(block).join('\n');
      document.body.innerHTML = '<pre class="json-out">' + out + '</pre>';
      document.title = `versions.${format}`;
      return true;
    }

    if (format === 'json') {
      if (latestOnly) {
        const latest = {};
        for (const a of apps) {
          const L = (a.tracks && (a.tracks[trackKey] || a.tracks.stable)) || null;
          if (L) latest[a.id] = { version: L.version, code: L.code };
        }
        const out = {
          schemaVersion: data.schemaVersion,
          generated: data.generated,
          latest
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
            available: apps.map((a) => a.id)
          };
          document.body.innerHTML =
            '<pre class="json-out">' + JSON.stringify(out, null, 2) + '</pre>';
          document.title = 'versions.json';
          return true;
        }
        const L =
          (app.tracks && (app.tracks[trackKey] || app.tracks.stable)) || null;
        const trackName = L
          ? (Object.entries(app.tracks).find(([, v]) => v === L) || [trackKey])[0]
          : trackKey;
        const out = {
          schemaVersion: data.schemaVersion,
          generated: data.generated,
          app: app.id,
          track: trackName,
          latest: L
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

  /* -------------------- interactive UI -------------------- */
  function initInteractive(data) {
    const setText = (el, v) => { if (el) el.textContent = v; };

    setText($('#schema-ver'), String(data.schemaVersion || '2'));
    const appCountEl = $('#app-count');
    if (appCountEl) appCountEl.textContent = (data.apps || []).length;

    try {
      const dt = new Date(data.generated);
      const d = dt.toLocaleString('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
      const t = dt.toLocaleString('en-GB', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      setText($('#updated-badge'), `Updated ${d} • ${t} UTC`);
    } catch {
      setText($('#updated-badge'), data.generated || '—');
    }

    const qInput = $('#q'),
      trackSel = $('#track'),
      sortSel = $('#sort'),
      tbody = $('#apps-body'),
      list = $('#m-list');

    const display = {
      version: (v) => (v && String(v).trim() ? v : '—'),
      codeText: (c) => (c && Number(c) !== 0 ? String(c) : '—'),
      codeValue: (c) => c ?? 0
    };

    const toRows = () => {
      const rows = [];
      for (const app of data.apps || []) {
        for (const [track, latest] of Object.entries(app.tracks || {})) {
          rows.push({ app, track, latest });
        }
      }
      return rows;
    };

    function applyFilters(rows) {
      const q = (qInput?.value || '').toLowerCase().trim();
      const t = (trackSel?.value || 'all').toLowerCase();
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
      switch (sortSel?.value) {
        case 'code_asc':
          out.sort((a, b) => (a.latest.code ?? 0) - (b.latest.code ?? 0));
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
          out.sort((a, b) => (b.latest.code ?? 0) - (a.latest.code ?? 0));
      }
      return out;
    }

    function renderTable(rows) {
      if (!tbody) return;
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
        if (r.latest.notes) links.push(`<span title="${r.latest.notes}">notes</span>`);
        tr.innerHTML = `
          <td><strong>${r.app.name || r.app.id}</strong></td>
          <td class="id">${r.app.id}</td>
          <td><span class="pill ${r.track === 'beta' ? 'beta' : 'ok'}">${r.track}</span></td>
          <td class="mono">${display.version(r.latest.version)}</td>
          <td class="mono">${display.codeText(r.latest.code)}</td>
          <td>${r.latest.date ?? '—'}</td>
          <td class="links">${links.join(' · ')}</td>`;
        tbody.appendChild(tr);
      }
    }

    function chevronSVG() {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }

    function renderMobile(rows) {
      if (!list) return;
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
        if (r.latest.notes) links.push(`<span title="${r.latest.notes}">notes</span>`);

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
              <div class="m-label">Track</div><div><span class="pill ${r.track === 'beta' ? 'beta' : 'ok'}">${r.track}</span></div>
              <div class="m-label">App ID</div><div class="mono">${r.app.id}</div>
              <div class="m-label">Date</div><div>${r.latest.date ?? '—'}</div>
              <div class="m-label">Links</div><div class="links">${links.join(' · ') || '—'}</div>
            </div>
            <div class="m-actions">
              <button class="btn-mini" data-copy="code" data-val="${codeCopy}">Copy code</button>
              <button class="btn-mini" data-copy="endpoint" data-val="?format=code&app=${r.app.id}">Copy endpoint</button>
              <a class="btn-mini" href="?format=json&app=${r.app.id}" target="_blank" rel="noopener">Open JSON</a>
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

    /* ---------- custom picker ---------- */
    const picker = $('#app-picker'),
      pickerBtn = $('#picker-btn'),
      pickerPanel = $('#picker-panel'),
      pickerList = $('#picker-list'),
      pickerSearch = $('#picker-search'),
      pickerValue = $('#picker-value');

    function buildPicker(appIds) {
      if (!picker) return;
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
      if (!picker) return;
      picker.dataset.value = id;
      if (pickerValue) pickerValue.textContent = `${label} (${id})`;
    }
    function openPicker() {
      if (!picker) return;
      picker.setAttribute('aria-expanded', 'true');
      pickerBtn?.setAttribute('aria-expanded', 'true');
      pickerPanel.style.display = 'grid';
      if (pickerSearch) {
        pickerSearch.value = '';
        pickerSearch.focus();
        filterPicker();
      }
    }
    function closePicker() {
      if (!picker) return;
      picker.setAttribute('aria-expanded', 'false');
      pickerBtn?.setAttribute('aria-expanded', 'false');
      pickerPanel.style.display = 'none';
    }
    function filterPicker() {
      const q = (pickerSearch?.value || '').toLowerCase().trim();
      $$('.picker-item', pickerList).forEach((li) => {
        const text = li.textContent.toLowerCase();
        li.style.display = text.includes(q) ? '' : 'none';
      });
    }
    pickerBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = picker.getAttribute('aria-expanded') === 'true';
      open ? closePicker() : openPicker();
    });
    pickerSearch?.addEventListener('input', filterPicker);
    document.addEventListener('click', (e) => {
      if (picker && !picker.contains(e.target)) closePicker();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePicker();
    });

    /* ---------- endpoint boxes ---------- */
    function setEndpointBox(boxSel, path) {
      const box = $(boxSel);
      if (!box) return;
      const pathSpan = box.querySelector('.path');
      const epScroll = box.querySelector('.ep-scroll');
      const u = new URL(location.href);
      u.search = path.replace('./index.html', '').replace('./', '');
      if (pathSpan) pathSpan.textContent = path;

      const openId = boxSel.replace('#', '') + '-open';
      const a = document.getElementById(openId);
      if (a) a.href = u.toString();

      if (epScroll) epScroll.scrollLeft = 0;
    }
    function updateEndpointBoxes() {
      const id = picker?.dataset.value || data.apps?.[0]?.id || 'your-app-id';
      setEndpointBox('#ep-all', `./index.html?format=json`);
      setEndpointBox('#ep-compact', `./index.html?format=json&latest=1`);
      setEndpointBox('#ep-one', `./index.html?format=json&app=${id}`);
      setEndpointBox('#ep-code', `./index.html?format=code&app=${id}`);
    }

    // Copy handlers
    document.addEventListener('click', async (e) => {
      const copyBtn = e.target.closest('[data-ep-copy]');
      if (copyBtn) {
        const sel = copyBtn.getAttribute('data-ep-copy');
        const box = $(sel);
        const path = box?.querySelector('.path')?.textContent?.trim() || '';
        const url = new URL(location.href);
        url.search = path.replace('./index.html', '').replace('./', '');
        try {
          await navigator.clipboard.writeText(url.toString());
          const orig = copyBtn.innerHTML;
          copyBtn.textContent = '✓';
          setTimeout(() => (copyBtn.innerHTML = orig), 900);
        } catch {
          alert(url.toString());
        }
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
        try {
          await navigator.clipboard.writeText(String(text));
          const t = mini.textContent;
          mini.textContent = 'Copied!';
          setTimeout(() => (mini.textContent = t), 900);
        } catch {
          alert(String(text));
        }
      }
    });

    // Toolbar actions
    $('#btn-copy-json')?.addEventListener('click', async () => {
      const url = new URL(location.href);
      url.search = '?format=json';
      try {
        await navigator.clipboard.writeText(url.toString());
        const b = $('#btn-copy-json');
        const t = b.textContent;
        b.textContent = 'Copied!';
        setTimeout(() => (b.textContent = t), 900);
      } catch {
        alert('Copy failed. ' + url.toString());
      }
    });
    $('#btn-download-json')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'versions.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    function build() {
      const rows = applyFilters(toRows());
      renderTable(rows);
      renderMobile(rows);

      // picker list
      const seen = new Set();
      const uniq = [];
      for (const r of rows) {
        if (!seen.has(r.app.id)) {
          seen.add(r.app.id);
          uniq.push({ id: r.app.id, name: r.app.name });
        }
      }
      if (uniq.length === 0) {
        const all = (data.apps || []).map((a) => ({ id: a.id, name: a.name }));
        buildPicker(all);
      } else {
        buildPicker(uniq);
      }

      updateEndpointBoxes();
      if (picker?.getAttribute('aria-expanded') === 'true') pickerBtn.click();
    }

    qInput?.addEventListener('input', build);
    trackSel?.addEventListener('change', build);
    sortSel?.addEventListener('change', build);
    build();

    /* ----------------- bottom bar ----------------- */
    const nav = $('#mobile-nav');
    const navExpand = $('#nav-expand');
    const navExpandList = $('#nav-expand-list');
    const navExpandIcon = $('#nav-expand-icon');

    navExpand?.addEventListener('click', (e) => {
      e.stopPropagation();
      navExpandList?.classList.toggle('show-list');
      navExpandIcon?.classList.toggle('rotate-icon');
    });
    document.addEventListener('click', (ev) => {
      if (!nav?.contains(ev.target)) {
        navExpandList?.classList.remove('show-list');
        navExpandIcon?.classList.remove('rotate-icon');
      }
    });

    nav?.addEventListener('click', (e) => {
      const link = e.target.closest('.nav__link, .nav__expand-link');
      if (!link) return;
      const act = link.getAttribute('data-act');
      if (!act) return;
      e.preventDefault();

      switch (act) {
        case 'back':
          history.length > 1
            ? history.back()
            : window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'forward':
          history.forward();
          break;
        case 'about':
          openAbout();
          break;
        case 'home':
          location.href = 'index.html';
          break;
        case 'refresh':
          location.reload();
          break;
        case 'top':
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
      }

      if (act !== 'about') {
        navExpandList?.classList.remove('show-list');
        navExpandIcon?.classList.remove('rotate-icon');
      }
    });

    /* ----------------- about dialog ----------------- */
    const about = $('#about');
    const aboutClose = $('#about-close');

    function ensureAboutDOM() {
      const head = $('.about-head');
      const body = $('.about-body');
      if (head?.querySelector('.about-badge') && body?.querySelector('#ab-schema')) {
        return;
      }
      // add small icon + premium title block
      if (head && !head.querySelector('.about-icon')) {
        const icon = document.createElement('div');
        icon.className = 'about-icon';
        icon.innerHTML =
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8h.01M11 12h2v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        head.prepend(icon);
      }
      if (head && !head.querySelector('.about-title')) {
        const t = document.createElement('div');
        t.className = 'about-title';
        t.innerHTML =
          '<span class="t1">Skillerious Version Tracker</span><span class="t2">by Robin Doak • machine-readable endpoints for apps</span>';
        head.insertBefore(t, $('#about-close'));
      }

      // body
      if (body && !body.querySelector('#ab-schema')) {
        body.innerHTML = `
          <div class="about-stats">
            <div class="stat"><div class="k">Schema</div><div class="v" id="ab-schema">—</div></div>
            <div class="stat"><div class="k">Generated (UTC)</div><div class="v" id="ab-gen">—</div><div class="subl" id="ab-gen-sub">—</div></div>
            <div class="stat"><div class="k">Apps</div><div class="v" id="ab-apps">—</div></div>
            <div class="stat"><div class="k">Tracks</div><div class="track-row"><span class="badge-small ok">stable</span><span class="badge-small beta">beta</span></div></div>
          </div>
          <div class="meta-grid" style="margin-top:12px">
            <div class="meta">
              <h4>What is this?</h4>
              <p>This service exposes public endpoints (JSON / TXT / INI / CODE) that your apps can read to decide if an update is available.</p>
              <ul class="foot-list" style="margin-top:8px">
                <li><strong>No push installs</strong> — the site never installs software.</li>
                <li><strong>Public metadata</strong> — versions, release links, and integer codes.</li>
                <li><strong>Client-driven</strong> — update logic runs in each app.</li>
              </ul>
            </div>
            <div class="meta">
              <h4>Quick links</h4>
              <div class="quick-links">
                <a class="json" href="?format=json">JSON</a>
                <a class="txt"  href="?format=txt">TXT</a>
                <a class="ini"  href="?format=ini">INI</a>
                <a class="code" href="?format=code">CODE</a>
              </div>
              <p style="margin-top:10px;color:var(--muted)">Made by <a class="foot-link" href="https://github.com/skillerious" target="_blank" rel="noopener">Robin Doak</a></p>
            </div>
          </div>`;
      }
    }

    function fillAbout(d) {
      ensureAboutDOM();

      // Support both new (#ab-*) and legacy (#about-*) IDs
      const el = (idNew, idOld) => document.getElementById(idNew) || document.getElementById(idOld);

      const schemaEl = el('ab-schema', 'about-schema');
      const genEl = el('ab-gen', 'about-generated');
      const genSub = document.getElementById('ab-gen-sub') || document.getElementById('about-generated-ago');
      const appsEl = el('ab-apps', 'about-count');

      if (schemaEl) schemaEl.textContent = String(d.schemaVersion || '2');
      try {
        const dt = new Date(d.generated);
        const dStr = dt.toLocaleString('en-GB', {
          timeZone: 'UTC',
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        });
        const tStr = dt.toLocaleString('en-GB', {
          timeZone: 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        if (genEl) genEl.textContent = `${dStr}, ${tStr}`;
        if (genSub) {
          const diffMs = Date.now() - dt.getTime();
          let rel = '';
          if (Number.isFinite(diffMs) && diffMs >= 0) {
            const mins = Math.floor(diffMs / 60000);
            if (mins < 60) rel = `${mins} min ago`;
            else if (mins < 60 * 24) rel = `${Math.floor(mins / 60)} hr ago`;
            else rel = `${Math.floor(mins / (60 * 24))} d ago`;
          }
          genSub.textContent = rel ? `UTC | ${rel}` : 'UTC';
        }
      } catch {
        if (genEl) genEl.textContent = d.generated || '--';
        if (genSub) genSub.textContent = 'UTC';
      }
      if (appsEl) appsEl.textContent = String(d.apps?.length || 0);

      const stableEl = el('ab-track-stable', 'about-stable');
      const betaEl = el('ab-track-beta', 'about-beta');
      const maxCodeEl = el('ab-max-code', 'about-maxcode');
      const newestDateEl = el('ab-newest-date', 'about-newest');
      const newestAppEl = el('ab-newest-app', 'about-newest-app');
      const baseUrlEl = el('ab-base-url', 'about-baseurl');
      const sampleAppEl = el('ab-sample-app', 'about-sample-app');
      const jsonSizeEl = el('ab-json-size', 'about-size');
      const contactEl = document.getElementById('ab-contact');
      const linkJson = document.getElementById('ab-link-json') || document.getElementById('about-link-json');
      const linkTxt = document.getElementById('ab-link-txt') || document.getElementById('about-link-txt');
      const linkIni = document.getElementById('ab-link-ini') || document.getElementById('about-link-ini');
      const linkCode = document.getElementById('ab-link-code') || document.getElementById('about-link-code');

      const apps = Array.isArray(d.apps) ? d.apps : [];
      const trackCounts = Object.create(null);
      let maxCode = 0;
      let newest = null;
      for (const app of apps) {
        const tracks = app.tracks || {};
        for (const [trackName, info] of Object.entries(tracks)) {
          if (!info) continue;
          const key = (trackName || '').toLowerCase();
          trackCounts[key] = (trackCounts[key] || 0) + 1;
          const codeNum = Number(info.code);
          if (Number.isFinite(codeNum) && codeNum > maxCode) maxCode = codeNum;
          if (info.date) {
            const dt = new Date(info.date);
            if (!Number.isNaN(dt.valueOf())) {
              if (!newest || dt > newest.date) {
                newest = { date: dt, info, app, track: key || trackName };
              }
            }
          }
        }
      }

      if (stableEl) stableEl.textContent = String(trackCounts.stable || 0);
      if (betaEl) betaEl.textContent = String(trackCounts.beta || 0);
      if (maxCodeEl) maxCodeEl.textContent = maxCode ? display.codeText(maxCode) : '--';
      if (newestDateEl) {
        newestDateEl.textContent = newest
          ? newest.date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : '--';
      }
      if (newestAppEl) {
        if (newest) {
          const ver = display.version(newest.info.version);
          const parts = [newest.app.name || newest.app.id];
          if (ver !== '-') parts.push(ver);
          if (newest.track) parts.push(newest.track);
          newestAppEl.textContent = parts.join(' | ');
        } else {
          newestAppEl.textContent = '--';
        }
      }

      const pageUrl = new URL(location.href);
      pageUrl.search = '';
      pageUrl.hash = '';
      const baseHref = `${pageUrl.origin}${pageUrl.pathname}`.replace(/index\.html$/i, 'index.html');
      if (baseUrlEl) {
        baseUrlEl.textContent = baseHref;
        baseUrlEl.setAttribute('title', baseHref);
      }
      if (sampleAppEl) {
        const selectedId = picker?.dataset.value || apps[0]?.id || 'n/a';
        const selected = apps.find((a) => a.id === selectedId);
        const label =
          pickerValue?.textContent?.trim() ||
          `${selected?.name || selectedId} (${selectedId})`;
        sampleAppEl.textContent = label;
      }
      if (jsonSizeEl) {
        let label = '--';
        try {
          const blob = new Blob([JSON.stringify(d)]);
          let bytes = blob.size;
          const units = ['B', 'KB', 'MB'];
          let unit = 0;
          while (bytes >= 1024 && unit < units.length - 1) {
            bytes /= 1024;
            unit += 1;
          }
          const value = unit === 0 ? Math.round(bytes) : bytes < 10 ? bytes.toFixed(1) : Math.round(bytes);
          label = `${value} ${units[unit]}`;
        } catch {
          const str = JSON.stringify(d) || '';
          label = `${str.length} chars`;
        }
        jsonSizeEl.textContent = label;
      }
      if (contactEl) {
        const cleaned = (d.contact || 'Skillerious - Robin Doak').replace(/[\u2013\u2014]/g, '-');
        contactEl.textContent = cleaned;
      }
      const linkPairs = [
        [linkJson, '?format=json'],
        [linkTxt, '?format=txt'],
        [linkIni, '?format=ini'],
        [linkCode, '?format=code']
      ];
      linkPairs.forEach(([anchor, path]) => {
        if (!anchor) return;
        anchor.setAttribute('href', path);
      });
    }

    function openAbout() {
      fillAbout(data);
      $('#about')?.setAttribute('aria-hidden', 'false');
    }
    function closeAbout() {
      $('#about')?.setAttribute('aria-hidden', 'true');
    }

    $('#about-close')?.addEventListener('click', closeAbout);
    $('#about')?.addEventListener('click', (e) => {
      if (e.target === $('#about')) closeAbout();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAbout();
    });
  }

  /* ----------------------- boot ----------------------- */
  (async function boot() {
    const data = await loadData();
    if (handleMachineEndpoints(data)) return;
    initInteractive(data);
  })();
})();



