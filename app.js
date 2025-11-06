(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const qs = new URLSearchParams(location.search);

  const STORAGE_KEY = 'vc.filters.v2';
  const CACHE_KEY = 'vc.cache.primary';
  const CACHE_TS_KEY = 'vc.cache.primary.ts';
  const STATE_PERSIST_DELAY = 220;
  const STALE_AFTER_DAYS = 90;
  const FUTURE_GRACE_DAYS = 2;
  const SEVERITY_ORDER = { error: 0, warn: 1, info: 2, ok: 3 };

  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const escapeAttribute = (value) =>
    escapeHtml(value).replace(/`/g, '&#96;');

  const clamp = (value, min, max) =>
    Math.min(max, Math.max(min, value));

  function sanitizeLink(url) {
    if (!url) return null;
    const str = String(url).trim();
    if (!str) return null;
    const lowered = str.toLowerCase();
    if (lowered.startsWith('javascript:') || lowered.startsWith('data:')) return null;
    return str;
  }

  function formatRelativeDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'moments ago';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks} wk${weeks === 1 ? '' : 's'} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} mo${months === 1 ? '' : 's'} ago`;
    const years = Math.floor(days / 365);
    return `${years} yr${years === 1 ? '' : 's'} ago`;
  }

  function safeLocalStorage(fn) {
    try {
      return fn();
    } catch {
      return null;
    }
  }

  /* ----------------------- data ----------------------- */
  async function loadData(runtime = {}) {
    const run = (runtime && typeof runtime === 'object') ? runtime : {};
    run.messages = Array.isArray(run.messages) ? run.messages : [];

    const cached = safeLocalStorage(() => {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const tsRaw = localStorage.getItem(CACHE_TS_KEY);
      const ts = tsRaw ? Number(tsRaw) : null;
      return { data, ts: Number.isFinite(ts) ? ts : null };
    });

    try {
      const res = await fetch('repoversion.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      safeLocalStorage(() => {
        localStorage.setItem(CACHE_KEY, JSON.stringify(json));
        localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
      });
      run.source = 'live';
      run.usedCache = false;
      return json;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      run.messages.push({
        type: 'error',
        text: `Live fetch failed (${message})`
      });
      if (cached?.data) {
        run.source = 'cache';
        run.usedCache = true;
        if (cached.ts && Number.isFinite(cached.ts)) {
          run.cacheTimestamp = cached.ts;
          const age = Date.now() - cached.ts;
          run.cacheAge = age;
          const rel = formatRelativeDuration(age) || 'earlier';
          run.messages.push({
            type: 'warn',
            text: `Serving cached data (${rel}).`
          });
        } else {
          run.messages.push({
            type: 'warn',
            text: 'Serving cached data from a previous visit.'
          });
        }
        return cached.data;
      }

      document.body.innerHTML =
        '<pre class="json-out">' +
        JSON.stringify(
          { error: 'Failed to load repoversion.json', detail: String(err) },
          null,
          2
        ) +
        '</pre>';
      document.title = 'versions.json';
      throw err;
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
          .map((a) => `${a.id}=${pickLatest(a)?.version ?? ''}`)
          .join('\n');
        document.body.innerHTML = '<pre class="json-out">' + lines + '</pre>';
        document.title = 'versions.txt';
        return true;
      } else {
        const app = apps.find((a) => a.id === appId);
        const latest = app ? pickLatest(app) : null;
        const version =
          latest && typeof latest.version !== 'undefined' && latest.version !== null
            ? String(latest.version)
            : '';
        document.body.innerHTML = '<pre class="json-out">' + version + '</pre>';
        document.title = `${appId}.version`;
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
  function initInteractive(data, runtime = {}) {
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
      setText($('#updated-badge'), data.generated || '--');
    }

    const qInput = $('#q'),
      trackSel = $('#track'),
      sortSel = $('#sort'),
      tbody = $('#apps-body'),
      list = $('#m-list'),
      noticeEl = $('#notice'),
      diagnosticsEl = $('#diagnostics'),
      diagnosticsListEl = $('#diagnostics-list'),
      metrics = {
        total: $('#metric-total'),
        visible: $('#metric-visible'),
        issues: $('#metric-issues'),
        stale: $('#metric-stale'),
        healthy: $('#metric-healthy')
      },
      toggleIssues = $('#filter-issues'),
      toggleStale = $('#filter-stale'),
      toggleMissing = $('#filter-missing'),
      toggleFuture = $('#filter-future'),
      resetFiltersBtn = $('#btn-reset-filters');

    const display = {
      version: (v) => (v && String(v).trim() ? v : '--'),
      codeText: (c) => (c && Number(c) !== 0 ? String(c) : '--'),
      codeValue: (c) => c ?? 0
    };

    const runtimeInfo =
      runtime && typeof runtime === 'object' ? runtime : {};
    const baseRows = buildRows(data);
    const datasetSummary = summariseRows(baseRows.rows);
    if (metrics.total) metrics.total.textContent = String(datasetSummary.total);
    if (metrics.visible) metrics.visible.textContent = String(datasetSummary.total);
    if (metrics.issues) metrics.issues.textContent = String(datasetSummary.issues);
    if (metrics.stale) metrics.stale.textContent = String(datasetSummary.stale);
    if (metrics.healthy) metrics.healthy.textContent = String(datasetSummary.healthy);
    const DEFAULT_FILTER_STATE = normalizeState({
      q: '',
      track: trackSel?.value || 'stable',
      sort: sortSel?.value || 'code_desc',
      toggles: {
        issues: false,
        stale: false,
        missing: false,
        future: false
      }
    });
    const state = loadInitialState();
    applyStateToControls();
    showDiagnostics(baseRows.warnings);

    const toRows = () => baseRows.rows.slice();

    function applyFilters(rows) {
      const parsed = parseQuery(state.q);
      const out = rows.filter((r) => {
        if (state.track !== 'all' && r.track !== state.track) return false;
        if (state.toggles.issues && !r.meta.hasIssues) return false;
        if (state.toggles.stale && !r.meta.flags.stale) return false;
        if (state.toggles.missing && !r.meta.flags.missingLinks) return false;
        if (state.toggles.future && !r.meta.flags.future) return false;
        return matchesQuery(r, parsed);
      });
      const sorter = sortRows(state.sort);
      out.sort(sorter);
      return out;
    }

    function buildRows(source) {
      const warnings = [];
      const rows = [];
      const appList = [];

      const apps = Array.isArray(source.apps) ? source.apps : [];
      if (!Array.isArray(source.apps)) {
        warnings.push('apps array missing or invalid.');
      }

      apps.forEach((app, index) => {
        if (!app || typeof app !== 'object') {
          warnings.push(`App at index ${index} is not an object.`);
          return;
        }
        const appId = (app.id && String(app.id).trim()) || '';
        if (!appId) {
          warnings.push(`App entry ${index + 1} is missing an id.`);
          return;
        }
        const appName = typeof app.name === 'string' ? app.name : '';
        const tracks = app.tracks && typeof app.tracks === 'object' ? app.tracks : null;
        if (!tracks) {
          warnings.push(`App "${appId}" has no tracks.`);
          return;
        }
        const entries = Object.entries(tracks).filter(([, info]) => info && typeof info === 'object');
        if (!entries.length) {
          warnings.push(`App "${appId}" has empty track metadata.`);
          return;
        }
        appList.push({ id: appId, name: appName });
        const stableTrack = tracks.stable && typeof tracks.stable === 'object' ? tracks.stable : null;
        const stableCode = stableTrack ? toNumber(stableTrack.code) : null;

        entries.forEach(([trackName, info]) => {
          const trackKey = (trackName || '').toLowerCase() || 'stable';
          const latest = info && typeof info === 'object' ? info : {};
          const meta = analyseEntry(appId, appName, trackKey, latest, stableCode);
          rows.push({ app, track: trackKey, latest, meta });
        });
      });

      return { rows, apps: appList, warnings };
    }

    function analyseEntry(appId, appName, trackKey, latest, stableCode) {
      const versionText = display.version(latest.version);
      const codeNum = toNumber(latest.code);
      const codeLabel = codeNum === null ? '--' : String(codeNum);
      const codeTitle = codeNum === null ? 'Code not provided' : `Code ${codeNum}`;
      const notes = typeof latest.notes === 'string' ? latest.notes : '';
      const hasDownload = !!sanitizeLink(latest.download);
      const hasUrl = !!sanitizeLink(latest.url);

      const dateInfo = parseRowDate(latest.date);

      const badges = [];
      const flags = {
        stale: dateInfo.stale,
        future: dateInfo.future,
        missingLinks: false,
        missingVersion: versionText === '--',
        missingCode: codeNum === null,
        missingDate: dateInfo.missing,
        hasNotes: !!notes,
        hasDownload,
        hasUrl,
        behindStable: false
      };

      if (flags.missingVersion) {
        badges.push({ id: 'missing-version', label: 'Missing version', tone: 'error' });
      }
      if (flags.missingCode) {
        badges.push({ id: 'missing-code', label: 'Invalid code', tone: 'error' });
      } else if (codeNum !== null && codeNum <= 0) {
        badges.push({ id: 'low-code', label: 'Code <= 0', tone: 'warn' });
      }

      if (dateInfo.missing) {
        badges.push({ id: 'missing-date', label: 'Missing date', tone: 'warn' });
      } else if (dateInfo.invalid) {
        badges.push({ id: 'invalid-date', label: 'Invalid date', tone: 'warn' });
      }
      if (flags.stale) {
        badges.push({ id: 'stale', label: `Stale (${dateInfo.staleDays}d)`, tone: 'warn' });
      }
      if (flags.future) {
        badges.push({ id: 'future', label: `In ${dateInfo.futureDays}d`, tone: 'warn' });
      }

      if (!hasUrl && !hasDownload) {
        badges.push({ id: 'missing-links', label: 'Missing links', tone: 'warn' });
        flags.missingLinks = true;
      } else if (!hasUrl || !hasDownload) {
        badges.push({
          id: hasUrl ? 'missing-download' : 'missing-release',
          label: hasUrl ? 'No download link' : 'No release link',
          tone: 'info'
        });
      }
      if (notes) {
        badges.push({ id: 'notes', label: 'Notes available', tone: 'info' });
      }

      if (stableCode !== null && trackKey !== 'stable' && codeNum !== null) {
        if (codeNum < stableCode) {
          badges.push({ id: 'behind-stable', label: 'Behind stable', tone: 'warn' });
          flags.behindStable = true;
        } else if (codeNum > stableCode) {
          badges.push({ id: 'ahead-stable', label: 'Ahead of stable', tone: 'info' });
        }
      }

      let severity = 'ok';
      for (const badge of badges) {
        if (badge.tone === 'error') {
          severity = 'error';
          break;
        }
        if (badge.tone === 'warn' && severity !== 'error') {
          severity = 'warn';
        } else if (badge.tone === 'info' && severity === 'ok') {
          severity = 'info';
        }
      }
      const hasIssues = severity === 'error' || severity === 'warn';

      badges.sort((a, b) => {
        const rank = (tone) =>
          tone === 'error' ? 0 : tone === 'warn' ? 1 : tone === 'info' ? 2 : 3;
        return rank(a.tone) - rank(b.tone);
      });

      const searchParts = [
        appId,
        appName || '',
        trackKey,
        versionText,
        codeLabel,
        dateInfo.original || '',
        notes,
        String(latest.url || ''),
        String(latest.download || '')
      ];

      return {
        versionText,
        code: codeNum,
        codeLabel,
        codeTitle,
        dateValue: dateInfo.value,
        dateDisplay: dateInfo.display,
        dateTitle: dateInfo.title,
        badges,
        flags,
        hasIssues,
        severity,
        searchText: searchParts.join(' ').toLowerCase()
      };
    }

    function parseRowDate(raw) {
      if (!raw) {
        return {
          original: '',
          value: null,
          display: '--',
          title: 'No release date provided',
          missing: true,
          invalid: false,
          stale: false,
          future: false,
          staleDays: 0,
          futureDays: 0
        };
      }
      const dt = new Date(raw);
      if (Number.isNaN(dt.valueOf())) {
        return {
          original: raw,
          value: null,
          display: '--',
          title: `Invalid date: ${raw}`,
          missing: false,
          invalid: true,
          stale: false,
          future: false,
          staleDays: 0,
          futureDays: 0
        };
      }
      const value = dt.getTime();
      const diffMs = Date.now() - value;
      const diffDays = Math.round(diffMs / 86400000);
      const stale = diffDays > STALE_AFTER_DAYS;
      const future = diffDays < -FUTURE_GRACE_DAYS;
      let relative = '';
      if (diffDays === 0) relative = 'today';
      else if (diffDays > 0) relative = `${diffDays}d ago`;
      else relative = `in ${Math.abs(diffDays)}d`;
      const iso = dt.toISOString().slice(0, 10);
      return {
        original: raw,
        value,
        display: relative ? `${iso} (${relative})` : iso,
        title: `Release date ${iso}`,
        missing: false,
        invalid: false,
        stale,
        future,
        staleDays: diffDays,
        futureDays: Math.abs(diffDays)
      };
    }

    function summariseRows(rows) {
      const summary = {
        total: rows.length,
        issues: 0,
        stale: 0,
        healthy: 0,
        missingLinks: 0,
        future: 0
      };
      rows.forEach((r) => {
        if (r.meta.hasIssues) summary.issues += 1;
        else if (r.meta.severity === 'ok') summary.healthy += 1;
        if (r.meta.flags.stale) summary.stale += 1;
        if (r.meta.flags.future) summary.future += 1;
        if (r.meta.flags.missingLinks) summary.missingLinks += 1;
      });
      return summary;
    }

    function parseQuery(raw) {
      const tokens = (raw || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const terms = [];
      const filters = [];
      tokens.forEach((token) => {
        const match = token.match(/^([a-z_]+)(:|<=|>=|=|<|>)(.+)$/i);
        if (match) {
          filters.push({
            key: match[1].toLowerCase(),
            op: match[2],
            value: match[3].toLowerCase()
          });
        } else {
          terms.push(token.toLowerCase());
        }
      });
      return { terms, filters };
    }

    function matchesQuery(row, parsed) {
      if (!parsed.terms.length && !parsed.filters.length) return true;
      for (const term of parsed.terms) {
        if (!row.meta.searchText.includes(term)) return false;
      }
      for (const filter of parsed.filters) {
        if (!matchFilter(row, filter)) return false;
      }
      return true;
    }

    function matchFilter(row, filter) {
      const { key, op, value } = filter;
      switch (key) {
        case 'id':
        case 'app':
          return textMatch(row.app.id, value, op);
        case 'name':
          return textMatch(row.app.name || '', value, op);
        case 'track':
          return textMatch(row.track, value, op, true);
        case 'status':
          if (value === 'issues') return row.meta.hasIssues;
          if (value === 'error') return row.meta.severity === 'error';
          if (value === 'warn' || value === 'warning') return row.meta.severity === 'warn';
          if (value === 'info') return row.meta.severity === 'info';
          if (value === 'ok' || value === 'healthy') return row.meta.severity === 'ok';
          if (value === 'stale') return row.meta.flags.stale;
          if (value === 'future') return row.meta.flags.future;
          if (value === 'missing') return row.meta.flags.missingLinks;
          return false;
        case 'has':
          if (value === 'notes') return row.meta.flags.hasNotes;
          if (value === 'download') return row.meta.flags.hasDownload;
          if (value === 'url' || value === 'release') return row.meta.flags.hasUrl;
          return false;
        case 'missing':
          if (value === 'notes') return !row.meta.flags.hasNotes;
          if (value === 'download') return !row.meta.flags.hasDownload;
          if (value === 'url' || value === 'release') return !row.meta.flags.hasUrl;
          if (value === 'date') return row.meta.flags.missingDate;
          return false;
        case 'code':
          return compareNumber(row.meta.code, value, op);
        case 'date':
        case 'released':
          return compareDate(row.meta.dateValue, value, op);
        default:
          return row.meta.searchText.includes(value);
      }
    }

    function textMatch(actual, target, op, exactOnly = false) {
      const a = String(actual || '').toLowerCase();
      const b = String(target || '').toLowerCase();
      if (!op || op === ':') {
        return exactOnly ? a === b : a.includes(b);
      }
      if (op === '=') {
        return a === b;
      }
      return exactOnly ? a === b : a.includes(b);
    }

    function compareNumber(actual, rawValue, op) {
      const expected = toNumber(rawValue);
      if (expected === null || actual === null) return false;
      switch (op) {
        case '>':
          return actual > expected;
        case '<':
          return actual < expected;
        case '>=':
          return actual >= expected;
        case '<=':
          return actual <= expected;
        case '=':
        case ':':
          return actual === expected;
        default:
          return false;
      }
    }

    function compareDate(actualValue, rawValue, op) {
      if (!rawValue || actualValue === null) return false;
      const parsed = new Date(rawValue);
      if (Number.isNaN(parsed.valueOf())) return false;
      const expected = parsed.getTime();
      switch (op) {
        case '>':
          return actualValue > expected;
        case '<':
          return actualValue < expected;
        case '>=':
          return actualValue >= expected;
        case '<=':
          return actualValue <= expected;
        case '=':
        case ':':
          return Math.abs(actualValue - expected) < 86400000;
        default:
          return false;
      }
    }

    function sortRows(key) {
      switch (key) {
        case 'code_asc':
          return (a, b) => (a.meta.code ?? Number.POSITIVE_INFINITY) - (b.meta.code ?? Number.POSITIVE_INFINITY);
        case 'name_asc':
          return (a, b) => (a.app.name || a.app.id).localeCompare(b.app.name || b.app.id);
        case 'name_desc':
          return (a, b) => (b.app.name || b.app.id).localeCompare(a.app.name || a.app.id);
        case 'date_asc':
          return (a, b) => (a.meta.dateValue ?? Number.POSITIVE_INFINITY) - (b.meta.dateValue ?? Number.POSITIVE_INFINITY);
        case 'date_desc':
          return (a, b) => (b.meta.dateValue ?? Number.NEGATIVE_INFINITY) - (a.meta.dateValue ?? Number.NEGATIVE_INFINITY);
        case 'issues_first':
          return (a, b) => {
            const severityRank = (s) =>
              s === 'error' ? 0 : s === 'warn' ? 1 : s === 'info' ? 2 : 3;
            const diff = severityRank(a.meta.severity) - severityRank(b.meta.severity);
            if (diff !== 0) return diff;
            return (b.meta.dateValue ?? Number.NEGATIVE_INFINITY) - (a.meta.dateValue ?? Number.NEGATIVE_INFINITY);
          };
        default:
          return (a, b) => (b.meta.code ?? Number.NEGATIVE_INFINITY) - (a.meta.code ?? Number.NEGATIVE_INFINITY);
      }
    }

    function loadInitialState() {
      const base = {
        q: qInput?.value || '',
        track: trackSel?.value || 'stable',
        sort: sortSel?.value || 'code_desc',
        toggles: {
          issues: !!toggleIssues?.checked,
          stale: !!toggleStale?.checked,
          missing: !!toggleMissing?.checked,
          future: !!toggleFuture?.checked
        }
      };
      const stored = readStoredState();
      const fromUrl = readUrlState();
      return normalizeState(DEFAULT_FILTER_STATE, base, stored, fromUrl);
    }

    function applyStateToControls() {
      if (qInput) qInput.value = state.q;
      if (trackSel) trackSel.value = state.track;
      if (sortSel) sortSel.value = state.sort;
      if (toggleIssues) toggleIssues.checked = state.toggles.issues;
      if (toggleStale) toggleStale.checked = state.toggles.stale;
      if (toggleMissing) toggleMissing.checked = state.toggles.missing;
      if (toggleFuture) toggleFuture.checked = state.toggles.future;
    }

    let persistHandle = null;
    function persistState(immediate = false) {
      if (immediate) {
        writeStoredState();
        writeUrlState();
        return;
      }
      clearTimeout(persistHandle);
      persistHandle = setTimeout(() => {
        writeStoredState();
        writeUrlState();
      }, STATE_PERSIST_DELAY);
    }

    function normalizeState(...sources) {
      const result = {
        q: '',
        track: 'stable',
        sort: 'code_desc',
        toggles: {
          issues: false,
          stale: false,
          missing: false,
          future: false
        }
      };
      sources.forEach((src) => {
        if (!src) return;
        if (typeof src.q === 'string') result.q = src.q.slice(0, 200);
        if (typeof src.track === 'string') result.track = normalizeTrackValue(src.track);
        if (typeof src.sort === 'string') result.sort = normalizeSortValue(src.sort);
        const toggles = src.toggles || src;
        if (toggles) {
          if (typeof toggles.issues !== 'undefined') result.toggles.issues = !!toggles.issues;
          if (typeof toggles.stale !== 'undefined') result.toggles.stale = !!toggles.stale;
          if (typeof toggles.missing !== 'undefined') result.toggles.missing = !!toggles.missing;
          if (typeof toggles.future !== 'undefined') result.toggles.future = !!toggles.future;
        }
      });
      return result;
    }

    function normalizeTrackValue(value) {
      const v = String(value || '').toLowerCase();
      return v === 'all' || v === 'beta' || v === 'stable' ? v : 'stable';
    }

    function normalizeSortValue(value) {
      const allowed = new Set([
        'code_desc',
        'code_asc',
        'name_asc',
        'name_desc',
        'date_asc',
        'date_desc',
        'issues_first'
      ]);
      return allowed.has(value) ? value : 'code_desc';
    }

    function readStoredState() {
      return (
        safeLocalStorage(() => {
          const raw = localStorage.getItem(STORAGE_KEY);
          return raw ? JSON.parse(raw) : null;
        }) || {}
      );
    }

    function writeStoredState() {
      safeLocalStorage(() => {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            q: state.q,
            track: state.track,
            sort: state.sort,
            toggles: state.toggles
          })
        );
      });
    }

    function readUrlState() {
      const params = new URLSearchParams(location.search);
      if (params.get('format')) return {};
      const out = {};
      if (params.has('q')) out.q = params.get('q');
      if (params.has('track')) out.track = params.get('track');
      if (params.has('sort')) out.sort = params.get('sort');
      ['issues', 'stale', 'missing', 'future'].forEach((key) => {
        if (params.has(key)) {
          const value = params.get(key);
          out[key] = value === '1' || value === 'true' || value === 'yes';
        }
      });
      return out;
    }

    function writeUrlState() {
      const url = new URL(location.href);
      const params = url.searchParams;
      params.delete('format');
      params.delete('app');
      params.delete('latest');
      ['q', 'track', 'sort', 'issues', 'stale', 'missing', 'future'].forEach((key) => {
        params.delete(key);
      });
      if (state.q) params.set('q', state.q);
      if (state.track && state.track !== 'stable') params.set('track', state.track);
      if (state.sort && state.sort !== 'code_desc') params.set('sort', state.sort);
      if (state.toggles.issues) params.set('issues', '1');
      if (state.toggles.stale) params.set('stale', '1');
      if (state.toggles.missing) params.set('missing', '1');
      if (state.toggles.future) params.set('future', '1');
      url.search = params.toString();
      history.replaceState(null, '', url);
    }

    function renderTable(rows) {
      if (!tbody) return;
      tbody.innerHTML = '';
      for (const r of rows) {
        const tr = document.createElement('tr');
        applySeverityClass(tr, r.meta.severity);
        const linkContent = buildLinksHtml(r);
        tr.innerHTML = `
          <td><strong>${escapeHtml(r.app.name || r.app.id)}</strong></td>
          <td class="id">${escapeHtml(r.app.id)}</td>
          <td><span class="pill ${r.track === 'beta' ? 'beta' : 'ok'}">${escapeHtml(r.track)}</span></td>
          <td class="mono">${escapeHtml(r.meta.versionText)}</td>
          <td class="mono" title="${escapeAttribute(r.meta.codeTitle)}">${escapeHtml(r.meta.codeLabel)}</td>
          <td title="${escapeAttribute(r.meta.dateTitle)}">${escapeHtml(r.meta.dateDisplay)}</td>
          <td class="status-cell">${renderStatusBadges(r.meta)}</td>
          <td class="links">${linkContent}</td>`;
        tbody.appendChild(tr);
      }
    }

    function renderStatusBadges(meta) {
      if (!meta.badges.length) {
        return '<span class="status-pill ok">Healthy</span>';
      }
      return meta.badges
        .map((badge) => {
          const tone = badge.tone || 'info';
          const title = badge.description ? ` title="${escapeAttribute(badge.description)}"` : '';
          return `<span class="status-pill ${tone}"${title}>${escapeHtml(badge.label)}</span>`;
        })
        .join(' ');
    }

    function buildLinksHtml(row) {
      const parts = [];
      const release = sanitizeLink(row.latest.url);
      if (release) {
        parts.push(
          `<a href="${escapeAttribute(release)}" target="_blank" rel="noopener">release</a>`
        );
      }
      const download = sanitizeLink(row.latest.download);
      if (download) {
        parts.push(
          `<a href="${escapeAttribute(download)}" target="_blank" rel="noopener">download</a>`
        );
      }
      if (row.meta.flags.hasNotes) {
        parts.push(
          `<span title="${escapeAttribute(row.latest.notes || '')}">notes</span>`
        );
      }
      return parts.length ? parts.join(' | ') : '--';
    }

    function applySeverityClass(el, severity) {
      if (!el) return;
      if (severity === 'error') el.classList.add('row-error');
      else if (severity === 'warn') el.classList.add('row-warn');
      else if (severity === 'info') el.classList.add('row-info');
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
        applySeverityClass(li, r.meta.severity);
        li.setAttribute('aria-expanded', 'false');

        const versionDisplay = escapeHtml(r.meta.versionText);
        const codeDisplay = escapeHtml(r.meta.codeLabel);
        const codeValue = r.meta.code === null ? '' : r.meta.code;
        const dateDisplay = escapeHtml(r.meta.dateDisplay);
        const dateTitle = escapeAttribute(r.meta.dateTitle);
        const linkHtml = buildLinksHtml(r);
        const trackBadge = `<span class="pill ${r.track === 'beta' ? 'beta' : 'ok'}">${escapeHtml(r.track)}</span>`;
        const endpointVal = `?format=code&app=${encodeURIComponent(r.app.id)}`;

        li.innerHTML = `
          <div class="m-top">
            <div class="m-name">${escapeHtml(r.app.name || r.app.id)}</div>
            <div class="m-meta"><span class="m-ver">${versionDisplay}</span><span class="m-code">${codeDisplay}</span></div>
            <button class="chev" aria-label="Toggle details">${chevronSVG()}</button>
          </div>

          <div class="m-details">
            <div class="m-divider"></div>
            <div class="m-grid">
              <div class="m-label">Track</div><div>${trackBadge}</div>
              <div class="m-label">App ID</div><div class="mono">${escapeHtml(r.app.id)}</div>
              <div class="m-label">Date</div><div title="${dateTitle}">${dateDisplay}</div>
              <div class="m-label">Status</div><div class="status-cell">${renderStatusBadges(r.meta)}</div>
              <div class="m-label">Links</div><div class="links">${linkHtml}</div>
            </div>
            <div class="m-actions">
              <button class="btn-mini" data-copy="code" data-val="${codeValue}">Copy code</button>
              <button class="btn-mini" data-copy="endpoint" data-val="${escapeAttribute(endpointVal)}">Copy endpoint</button>
              <a class="btn-mini" href="?format=json&app=${encodeURIComponent(r.app.id)}" target="_blank" rel="noopener">Open JSON</a>
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
      const previous = picker.dataset.value;
      let fallback = null;
      appIds.forEach(({ id, name }) => {
        const li = document.createElement('li');
        li.className = 'picker-item';
        li.tabIndex = 0;
        li.setAttribute('role', 'option');
        li.dataset.value = id;
        li.innerHTML = `<span>${escapeHtml(name || id)}</span> <small>(${escapeHtml(id)})</small>`;
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
        if (previous && previous === id) fallback = { id, name };
      });
      const target = fallback || appIds[0];
      if (target) setPicker(target.id, target.name || target.id);
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

    function build(mode) {
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
        buildPicker(baseRows.apps);
      } else {
        buildPicker(uniq);
      }

      updateEndpointBoxes();
      if (picker?.getAttribute('aria-expanded') === 'true') pickerBtn.click();
      updateSummaryMetrics(rows);
      showNotice(composeNoticeMessages(rows, mode === 'init'));
    }

    function updateSummaryMetrics(rows) {
      const summary = summariseRows(rows);
      if (metrics.visible) metrics.visible.textContent = String(summary.total);
      if (metrics.issues) metrics.issues.textContent = String(summary.issues);
      if (metrics.stale) metrics.stale.textContent = String(summary.stale);
      if (metrics.healthy) metrics.healthy.textContent = String(summary.healthy);
    }

    function composeNoticeMessages(rows, includeDatasetWarning) {
      const messages = [];
      if (Array.isArray(runtimeInfo.messages)) {
        runtimeInfo.messages.forEach((msg) => {
          if (msg && msg.text) messages.push(msg);
        });
      }
      if (includeDatasetWarning && baseRows.warnings.length) {
        messages.push({
          type: 'warn',
          text: `${baseRows.warnings.length} data warning${baseRows.warnings.length === 1 ? '' : 's'} listed below.`
        });
      }
      if (!rows.length) {
        messages.push({
          type: 'info',
          text: 'No rows match the current filters.'
        });
      }
      return messages;
    }

    function showNotice(messages) {
      if (!noticeEl) return;
      if (!messages || !messages.length) {
        noticeEl.hidden = true;
        noticeEl.className = 'notice';
        noticeEl.textContent = '';
        return;
      }
      const priority = { error: 0, warn: 1, warning: 1, success: 2, info: 3 };
      const sorted = messages.slice().sort(
        (a, b) => (priority[a.type] ?? 3) - (priority[b.type] ?? 3)
      );
      const highest = sorted[0] || { type: 'info' };
      const cls =
        highest.type === 'error'
          ? 'notice error'
          : highest.type === 'warn' || highest.type === 'warning'
          ? 'notice warn'
          : highest.type === 'success'
          ? 'notice success'
          : 'notice info';
      noticeEl.className = cls;
      noticeEl.textContent = sorted.map((m) => m.text).join(' | ');
      noticeEl.hidden = false;
    }

    function showDiagnostics(list) {
      if (!diagnosticsEl || !diagnosticsListEl) return;
      diagnosticsListEl.innerHTML = '';
      if (!list || !list.length) {
        diagnosticsEl.hidden = true;
        return;
      }
      const frag = document.createDocumentFragment();
      list.forEach((entry) => {
        const li = document.createElement('li');
        li.textContent = entry;
        frag.appendChild(li);
      });
      diagnosticsListEl.innerHTML = '';
      diagnosticsListEl.appendChild(frag);
      diagnosticsEl.hidden = false;
    }

    qInput?.addEventListener('input', () => {
      state.q = qInput.value || '';
      persistState();
      build();
    });
    trackSel?.addEventListener('change', () => {
      state.track = normalizeTrackValue(trackSel.value);
      applyStateToControls();
      persistState();
      build();
    });
    sortSel?.addEventListener('change', () => {
      state.sort = normalizeSortValue(sortSel.value);
      applyStateToControls();
      persistState();
      build();
    });
    toggleIssues?.addEventListener('change', () => {
      state.toggles.issues = !!toggleIssues.checked;
      persistState();
      build();
    });
    toggleStale?.addEventListener('change', () => {
      state.toggles.stale = !!toggleStale.checked;
      persistState();
      build();
    });
    toggleMissing?.addEventListener('change', () => {
      state.toggles.missing = !!toggleMissing.checked;
      persistState();
      build();
    });
    toggleFuture?.addEventListener('change', () => {
      state.toggles.future = !!toggleFuture.checked;
      persistState();
      build();
    });
    resetFiltersBtn?.addEventListener('click', () => {
      const reset = normalizeState(DEFAULT_FILTER_STATE);
      state.q = reset.q;
      state.track = reset.track;
      state.sort = reset.sort;
      state.toggles = reset.toggles;
      applyStateToControls();
      persistState();
      build();
    });
    build('init');
    persistState(true);

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
    const runtime = {};
    const data = await loadData(runtime);
    if (handleMachineEndpoints(data)) return;
    initInteractive(data, runtime);
  })();
})();



