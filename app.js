import {
  parse, transposeChord, transposeChordText, cleanPasted, chordsOverLyricsToInline,
  hasChordsOverLyrics, splitHeader, buildSong, slugify,
} from './chordpro.js';

// ================================================================ state

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('storage', e); } },
};

const settings = Object.assign({
  repo: '', branch: 'main', token: '', theme: 'auto',
  fs: 19, chords: true, cols: false, speed: 25,
}, LS.get('sb.settings', {}));
const saveSettings = () => LS.set('sb.settings', settings);

let cache = LS.get('sb.cache', { commit: null, files: {} }); // files: {path: {sha, text}}
const transpose = LS.get('sb.transpose', {}); // path -> semitones
const S = {
  songs: [], query: LS.get('sb.query', ''), tags: new Set(LS.get('sb.filter', [])),
  status: '', error: '', syncing: false,
};

const LOCAL_DIR = 'songs/'; // local dev: checkout of the songs repo
const app = document.getElementById('app');

// Songs live in a separate (private) repo; the app itself can be hosted anywhere.
const DEFAULT_REPO = 'wuneli/songbook-songs';
const repo = () => settings.repo || DEFAULT_REPO;
const isLocalDev = () => !settings.token && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

// ================================================================ helpers

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  pause: '<path d="M7 4v16M17 4v16"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/>',
};

let toastTimer;
function toast(msg, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.run(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 7000 : 3000);
}

function songFromFile(path, sha, text) {
  const p = parse(text);
  const plain = p.blocks.map(b => b.segs ? b.segs.map(s => s.text).join('') : '').join(' ');
  return {
    path, sha, text, parsed: p,
    title: p.meta.title || path.replace(/^.*\/|\.\w+$/g, ''),
    artist: p.meta.artist || p.meta.subtitle || '',
    tags: p.tags,
    hay: norm(`${p.meta.title || ''} ${p.meta.artist || ''} ${p.tags.join(' ')}`),
    lyrics: norm(plain),
  };
}

function rebuildSongs() {
  S.songs = Object.entries(cache.files)
    .map(([path, f]) => songFromFile(path, f.sha, f.text))
    .sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
}
const findSong = path => S.songs.find(s => s.path === path);

function allTags() {
  const count = new Map();
  for (const s of S.songs) for (const t of s.tags) count.set(t, (count.get(t) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// ================================================================ GitHub

async function gh(path, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json', ...(opts.headers || {}) };
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
  const r = await fetch(`https://api.github.com${path}`, { ...opts, headers, cache: 'no-store' });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).message || msg; } catch {}
    const e = new Error(`GitHub ${r.status}: ${msg}`);
    e.status = r.status;
    throw e;
  }
  return opts.text ? r.text() : r.status === 204 ? null : r.json();
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

async function sync({ force = false } = {}) {
  if (S.syncing) return;
  S.syncing = true; S.error = ''; S.status = 'Synchronisiere…'; updateStatus();
  try {
    if (isLocalDev()) await syncLocal();
    else if (repo()) await syncGitHub(force);
    else throw new Error('Kein Repository eingestellt – siehe Einstellungen.');
    LS.set('sb.cache', cache);
    S.status = `${Object.keys(cache.files).length} Songs · Stand ${new Date().toLocaleTimeString('de', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    console.error(e);
    S.error = navigator.onLine === false ? 'Offline – zeige gespeicherte Songs.' : e.message;
    if (!settings.token && [401, 403, 404].includes(e.status)) S.error = 'Kein Zugriff auf die Songs – bitte unter Einstellungen den GitHub-Token eintragen.';
  } finally {
    S.syncing = false;
    const before = S.songs.map(x => x.sha + x.path).join();
    rebuildSongs();
    refreshView(before !== S.songs.map(x => x.sha + x.path).join());
  }
}

// Re-render after a sync without destroying what the user is doing.
function refreshView(changed) {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h || h === '/') { renderList(); updateStatus(); }
  else if (h.startsWith('/s/') && (changed || !app.querySelector('#song'))) {
    const y = window.scrollY; route(); window.scrollTo(0, y);
  } else if (h === '/settings') { const i = app.querySelector('#sInfo'); if (i) i.textContent = S.error || S.status; }
}

async function syncLocal() {
  const paths = await (await fetch(`${LOCAL_DIR}index.json`, { cache: 'no-store' })).json();
  const files = {};
  await pool(paths, 8, async p => {
    files[p] = { sha: 'local', text: await (await fetch(LOCAL_DIR + p, { cache: 'no-store' })).text() };
  });
  cache = { commit: 'local', files };
}

async function syncGitHub(force) {
  const r = repo();
  const br = await gh(`/repos/${r}/branches/${encodeURIComponent(settings.branch)}`);
  const commit = br.commit.sha;
  if (!force && commit === cache.commit) return;
  const tree = await gh(`/repos/${r}/git/trees/${commit}?recursive=1`);
  const entries = tree.tree.filter(t => t.type === 'blob' && /\.(pro|cho|chopro|chordpro|crd)$/i.test(t.path));
  const files = {};
  const todo = [];
  for (const e of entries) {
    const old = cache.files[e.path];
    if (old && old.sha === e.sha) files[e.path] = old;
    else todo.push(e);
  }
  await pool(todo, 8, async e => {
    const text = settings.token
      ? await gh(`/repos/${r}/git/blobs/${e.sha}`, { text: true, headers: { Accept: 'application/vnd.github.raw' } })
      : await fetch(`https://raw.githubusercontent.com/${r}/${commit}/${e.path.split('/').map(encodeURIComponent).join('/')}`)
          .then(x => { if (!x.ok) throw new Error(`Laden fehlgeschlagen: ${e.path}`); return x.text(); });
    files[e.path] = { sha: e.sha, text };
  });
  cache = { commit, files };
}

function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function canWrite() { return !!(repo() && settings.token); }

async function putFile(path, text, message, sha) {
  const res = await gh(`/repos/${repo()}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64(text), branch: settings.branch, ...(sha ? { sha } : {}) }),
  });
  cache.files[path] = { sha: res.content.sha, text };
  cache.commit = null; // force tree refresh on next sync
  LS.set('sb.cache', cache);
  rebuildSongs();
}

async function deleteFile(path, sha, message) {
  await gh(`/repos/${repo()}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'DELETE', body: JSON.stringify({ message, sha, branch: settings.branch }),
  });
  delete cache.files[path];
  cache.commit = null;
  LS.set('sb.cache', cache);
  rebuildSongs();
}

/** Commit several files at once (used for renaming/deleting tags). */
async function commitMany(changes, message) {
  const r = repo();
  const ref = await gh(`/repos/${r}/git/ref/heads/${encodeURIComponent(settings.branch)}`);
  const base = await gh(`/repos/${r}/git/commits/${ref.object.sha}`);
  const tree = await gh(`/repos/${r}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: base.tree.sha, tree: changes.map(c => ({ path: c.path, mode: '100644', type: 'blob', content: c.text })) }),
  });
  const commit = await gh(`/repos/${r}/git/commits`, {
    method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }),
  });
  await gh(`/repos/${r}/git/refs/heads/${encodeURIComponent(settings.branch)}`, {
    method: 'PATCH', body: JSON.stringify({ sha: commit.sha }),
  });
  await syncGitHub(true);
  LS.set('sb.cache', cache);
  rebuildSongs();
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ================================================================ router

let cleanup = () => {};
function go(hash, replace) {
  if (replace) history.replaceState(null, '', hash); else location.hash = hash;
  if (replace) route();
}
function route() {
  cleanup(); cleanup = () => {};
  const h = decodeURIComponent(location.hash.slice(1));
  window.scrollTo(0, 0);
  if (h.startsWith('/s/')) return viewSong(h.slice(3));
  if (h.startsWith('/e/')) return viewEdit(h.slice(3));
  if (h === '/new') return viewEdit(null);
  if (h === '/settings') return viewSettings();
  return viewList();
}
window.addEventListener('hashchange', route);

// ================================================================ list

function filtered() {
  const q = norm(S.query.trim());
  const words = q.split(/\s+/).filter(Boolean);
  const res = [];
  for (const s of S.songs) {
    if ([...S.tags].some(t => !s.tags.includes(t))) continue;
    if (!words.length) { res.push({ s, rank: 0 }); continue; }
    if (words.every(w => s.hay.includes(w))) res.push({ s, rank: 0 });
    else if (words.every(w => s.hay.includes(w) || s.lyrics.includes(w))) res.push({ s, rank: 1 });
  }
  return res.sort((a, b) => a.rank - b.rank);
}

function viewList() {
  document.title = 'Songbook';
  app.innerHTML = `
    <header class="bar">
      <input class="search" type="search" placeholder="Titel, Interpret, Text…" value="${esc(S.query)}" aria-label="Suchen">
      <a class="ib" href="#/new" title="Neuer Song" aria-label="Neuer Song">${icon('plus')}</a>
      <a class="ib" href="#/settings" title="Einstellungen" aria-label="Einstellungen">${icon('gear')}</a>
    </header>
    <div class="page">
      <div class="tags" id="tagbar"></div>
      <ul class="list" id="list"></ul>
      <div class="status" id="status"></div>
    </div>`;
  const input = app.querySelector('.search');
  input.addEventListener('input', () => { S.query = input.value; LS.set('sb.query', S.query); renderList(); });
  app.querySelector('#tagbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    const t = b.dataset.tag;
    S.tags.has(t) ? S.tags.delete(t) : S.tags.add(t);
    LS.set('sb.filter', [...S.tags]);
    renderList();
  });
  renderList();
  updateStatus();
}

function renderList() {
  const tagbar = app.querySelector('#tagbar');
  const list = app.querySelector('#list');
  if (!list) return;
  const tags = allTags();
  tagbar.innerHTML = [...[...S.tags].map(t => tags.find(([x]) => x === t) || [t, 0]), ...tags.filter(([t]) => !S.tags.has(t))]
    .map(([t, n]) => `<button class="chip ${S.tags.has(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}<small>${n}</small></button>`).join('');
  const items = filtered();
  const q = norm(S.query.trim());
  list.innerHTML = items.map(({ s, rank }) => `
    <li><a href="#/s/${encodeURIComponent(s.path)}">
      <div class="t">${esc(s.title)}</div>
      ${s.artist ? `<div class="a">${esc(s.artist)}</div>` : ''}
      ${rank ? `<div class="x">…${esc(snippet(s, q))}…</div>` : ''}
    </a></li>`).join('') || `<li class="status">${S.songs.length ? 'Nichts gefunden.' : S.syncing ? '' : 'Noch keine Songs.'}</li>`;
}

function snippet(s, q) {
  const w = q.split(/\s+/)[0];
  const lines = s.parsed.blocks.filter(b => b.segs).map(b => b.segs.map(x => x.text).join(''));
  return (lines.find(l => norm(l).includes(w)) || '').trim().slice(0, 80);
}

function updateStatus() {
  const el = app.querySelector('#status');
  if (!el) return;
  el.className = 'status' + (S.error ? ' err' : '');
  el.textContent = S.error || S.status;
}

// ================================================================ song view

function renderBody(song, { chords, tr }) {
  let blocks = song.parsed.blocks;
  if (!chords) {
    blocks = blocks.filter(b => !['chords', 'chordtext', 'tab'].includes(b.type));
    // drop section labels that now have no content (e.g. "Intro" with chords only)
    blocks = blocks.filter((b, i) => {
      if (b.type !== 'section') return true;
      const next = blocks.slice(i + 1).find(x => x.type !== 'empty');
      return next && next.type !== 'section';
    });
  }
  // collapse empty lines (and the blank line right after a section label)
  blocks = blocks.filter((b, i) => b.type !== 'empty' || (i > 0 && !['empty', 'section'].includes(blocks[i - 1].type)));
  while (blocks.length && blocks[0].type === 'empty') blocks.shift();

  let html = '';
  let tab = [];
  const flushTab = () => { if (tab.length) { html += `<pre class="tab">${esc(tab.join('\n'))}</pre>`; tab = []; } };
  for (const b of blocks) {
    if (b.type === 'tab') { tab.push(b.text); continue; }
    flushTab();
    const cho = b.chorus ? ' cho' : '';
    switch (b.type) {
      case 'empty': html += '<div class="gap"></div>'; break;
      case 'section': html += `<div class="sec">${esc(b.text)}</div>`; break;
      case 'comment': html += `<div class="l cmt${cho}">${esc(b.text)}</div>`; break;
      case 'chordtext': html += `<div class="l chordline${cho}">${esc(transposeChordText(b.text, tr))}</div>`; break;
      case 'chords':
        html += `<div class="l chordline${cho}">${b.segs.map(s => (s.chord != null ? `<b>${esc(transposeChord(s.chord, tr))}</b>` : '') + esc(transposeChordText(s.text.trim(), tr) + (s.text.trim() ? ' ' : ''))).join('')}</div>`;
        break;
      case 'lyrics': {
        const hasC = chords && b.segs.some(s => s.chord != null);
        html += `<div class="l${hasC ? ' hc' : ''}${cho}">${hasC ? lyricHtml(b.segs, tr) : esc(b.segs.map(s => s.text).join('').trimStart()) || '&nbsp;'}</div>`;
        break;
      }
    }
  }
  flushTab();
  return html;
}

// Words stay unbreakable so a chord never gets separated from its syllable.
function lyricHtml(segs, tr) {
  let html = '', word = '';
  const close = () => { if (word) { html += `<span class="w">${word}</span>`; word = ''; } };
  for (const seg of segs) {
    const parts = seg.text.split(/(\s+)/);
    // "I[F] focus": a chord right before a gap belongs to the next word
    let chordAt = 0;
    if (seg.chord != null && parts[0] === '' && parts.length > 2 && parts[2]) chordAt = 2;
    parts.forEach((p, i) => {
      if (i === chordAt && seg.chord != null) {
        word += `<span class="c"><b>${esc(transposeChord(seg.chord, tr))}</b>${esc(p) || '​'}</span>`;
      } else if (/^\s+$/.test(p)) {
        close(); html += p;
      } else if (p) {
        word += esc(p);
      }
    });
  }
  close();
  return html;
}

function viewSong(path) {
  const song = findSong(path);
  if (!song) {
    app.innerHTML = `<header class="bar"><a class="ib" href="#/">${icon('back')}</a><div class="grow"><h2>Nicht gefunden</h2></div></header>
      <div class="page"><p class="status">${S.syncing ? 'Lade…' : 'Diesen Song gibt es nicht (mehr).'}</p></div>`;
    return;
  }
  document.title = song.title;
  const m = song.parsed.meta;
  let tr = transpose[path] || 0;
  const hasChords = song.parsed.blocks.some(b => ['chords', 'chordtext', 'tab'].includes(b.type) || (b.segs && b.segs.some(s => s.chord != null)));

  app.innerHTML = `
    <header class="bar" id="bar">
      <a class="ib" href="#/" aria-label="Zurück">${icon('back')}</a>
      <div class="grow"><h2>${esc(song.title)}</h2>${song.artist ? `<div class="sub">${esc(song.artist)}</div>` : ''}</div>
      ${hasChords ? `<button class="ib ${settings.chords ? 'on' : ''}" id="tChords" title="Akkorde ein/aus">Akk</button>` : ''}
      <button class="ib" id="tTools" title="Anzeige" aria-label="Anzeige">${icon('sliders')}</button>
      <a class="ib" href="#/e/${encodeURIComponent(path)}" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit')}</a>
    </header>
    <div class="tools" id="tools" hidden>
      <div class="grp"><span class="lbl">Größe</span><button class="ib" data-a="fs-">A−</button><span class="val" id="vFs"></span><button class="ib" data-a="fs+">A+</button></div>
      ${hasChords ? `<div class="grp"><span class="lbl">Transp.</span><button class="ib" data-a="tr-">−</button><button class="ib val" id="vTr" data-a="tr0" title="Zurücksetzen"></button><button class="ib" data-a="tr+">+</button></div>` : ''}
      <div class="grp"><span class="lbl">Scroll</span><button class="ib" data-a="scroll">${icon('play')}</button></div>
      <div class="grp"><button class="ib ${settings.cols ? 'on' : ''}" data-a="cols" title="Spalten (Tablet/Desktop)">Spalten</button></div>
    </div>
    <div class="page">
      <article class="song ${settings.cols ? 'cols' : ''}" id="song">
        <h1>${esc(song.title)}</h1>
        ${song.artist ? `<div class="artist">${esc(song.artist)}</div>` : ''}
        <div class="meta" id="meta"></div>
        <div class="body" id="body"></div>
        ${song.tags.length ? `<div class="tags wrap song-tags">${song.tags.map(t => `<button class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      </article>
    </div>
    <div class="scrollctl" id="scrollctl" hidden>
      <button class="ib" data-a="slow" aria-label="Langsamer">−</button>
      <button class="ib" data-a="scroll" aria-label="Pause">${icon('pause')}</button>
      <button class="ib" data-a="fast" aria-label="Schneller">+</button>
    </div>`;

  const songEl = app.querySelector('#song');
  const bodyEl = app.querySelector('#body');
  const bar = app.querySelector('#bar');
  const tools = app.querySelector('#tools');
  const scrollctl = app.querySelector('#scrollctl');

  const draw = () => {
    songEl.style.setProperty('--fs', settings.fs + 'px');
    bodyEl.innerHTML = renderBody(song, { chords: settings.chords, tr });
    const key = m.key ? transposeChord(m.key, tr) : '';
    app.querySelector('#meta').textContent = [key && `Tonart ${key}`, m.capo && `Capo ${m.capo}`, m.tempo && `${m.tempo} bpm`].filter(Boolean).join(' · ');
    app.querySelector('#vFs').textContent = settings.fs;
    const vTr = app.querySelector('#vTr');
    if (vTr) vTr.textContent = tr > 0 ? `+${tr}` : tr;
  };
  draw();

  // --- autoscroll
  let scrolling = false, raf = 0, lastT = 0, acc = 0;
  const step = t => {
    if (!scrolling) return;
    if (lastT) {
      acc += settings.speed * (t - lastT) / 1000;
      const px = Math.floor(acc);
      if (px) { window.scrollBy(0, px); acc -= px; }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) return setScroll(false);
    }
    lastT = t;
    raf = requestAnimationFrame(step);
  };
  const setScroll = on => {
    scrolling = on; lastT = 0; acc = 0;
    cancelAnimationFrame(raf);
    scrollctl.hidden = !on;
    if (on) { tools.hidden = true; raf = requestAnimationFrame(step); toast(`Autoscroll ${settings.speed} px/s`); }
  };

  const act = a => {
    switch (a) {
      case 'fs-': settings.fs = Math.max(12, settings.fs - 1); break;
      case 'fs+': settings.fs = Math.min(48, settings.fs + 1); break;
      case 'tr-': tr = (tr - 1) % 12; break;
      case 'tr+': tr = (tr + 1) % 12; break;
      case 'tr0': tr = 0; break;
      case 'cols': settings.cols = !settings.cols; songEl.classList.toggle('cols', settings.cols); app.querySelector('[data-a=cols]').classList.toggle('on', settings.cols); break;
      case 'scroll': setScroll(!scrolling); return;
      case 'slow': settings.speed = Math.max(5, settings.speed - 5); toast(`${settings.speed} px/s`); break;
      case 'fast': settings.speed = Math.min(200, settings.speed + 5); toast(`${settings.speed} px/s`); break;
    }
    if (tr) transpose[path] = tr; else delete transpose[path];
    LS.set('sb.transpose', transpose);
    saveSettings();
    draw();
  };
  app.addEventListener('click', onClick);
  function onClick(e) {
    const b = e.target.closest('[data-a]');
    if (b) return act(b.dataset.a);
    const tag = e.target.closest('.song-tags [data-tag]');
    if (tag) { S.tags = new Set([tag.dataset.tag]); S.query = ''; LS.set('sb.filter', [...S.tags]); LS.set('sb.query', ''); go('#/'); return; }
    if (e.target.closest('#tChords')) {
      settings.chords = !settings.chords; saveSettings();
      e.target.closest('#tChords').classList.toggle('on', settings.chords);
      draw(); return;
    }
    if (e.target.closest('#tTools')) { tools.hidden = !tools.hidden; bar.classList.remove('away'); return; }
    if (e.target.closest('#song')) {
      if (scrolling) return setScroll(false);
      if (!tools.hidden) { tools.hidden = true; return; }
      bar.classList.toggle('away');
    }
  }

  // --- hide bar while reading
  let lastY = window.scrollY;
  const onScroll = () => {
    const y = window.scrollY;
    if (y > lastY + 6 && y > 60) { bar.classList.add('away'); tools.hidden = true; }
    else if (y < lastY - 6 && !scrolling) bar.classList.remove('away');
    lastY = y;
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // --- pinch to change font size
  let pinch = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTS = e => { if (e.touches.length === 2) pinch = { d: dist(e.touches), fs: settings.fs }; };
  const onTM = e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const fs = Math.round(Math.min(48, Math.max(12, pinch.fs * dist(e.touches) / pinch.d)));
    if (fs !== settings.fs) { settings.fs = fs; songEl.style.setProperty('--fs', fs + 'px'); app.querySelector('#vFs').textContent = fs; }
  };
  const onTE = e => { if (pinch && e.touches.length < 2) { pinch = null; saveSettings(); } };
  songEl.addEventListener('touchstart', onTS, { passive: true });
  songEl.addEventListener('touchmove', onTM, { passive: false });
  songEl.addEventListener('touchend', onTE);

  // --- keep the screen on
  let lock = null;
  const wake = async () => { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch {} };
  const onVis = () => { if (document.visibilityState === 'visible') wake(); };
  wake();
  document.addEventListener('visibilitychange', onVis);

  // --- keyboard (desktop / bluetooth pedals send PageDown/arrows)
  const onKey = e => {
    if (e.target.closest('input,textarea')) return;
    if (e.key === ' ' && !e.shiftKey && scrolling) { e.preventDefault(); setScroll(false); }
    else if (e.key === 'c') app.querySelector('#tChords')?.click();
    else if (e.key === '+') act('fs+');
    else if (e.key === '-') act('fs-');
    else if (e.key === 'Escape') go('#/');
  };
  document.addEventListener('keydown', onKey);

  cleanup = () => {
    setScroll(false);
    app.removeEventListener('click', onClick);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('keydown', onKey);
    lock?.release().catch(() => {});
  };
}

// ================================================================ editor

function viewEdit(path) {
  const song = path ? findSong(path) : null;
  if (path && !song) return go('#/', true);
  const h = song ? splitHeader(song.text) : { title: '', artist: '', key: '', tags: [...S.tags], body: '' };
  let tags = [...h.tags];
  document.title = song ? `${song.title} bearbeiten` : 'Neuer Song';
  const known = allTags().map(([t]) => t);

  app.innerHTML = `
    <header class="bar">
      <button class="ib" id="cancel" aria-label="Abbrechen">${icon('back')}</button>
      <div class="grow"><h2>${song ? 'Song bearbeiten' : 'Neuer Song'}</h2></div>
      <button class="btn primary" id="save">Speichern</button>
    </header>
    <div class="page">
      <div class="form">
        ${canWrite() || isLocalDev() ? '' : `<div class="notice">Zum Speichern im Repository fehlt ein GitHub-Token. <a href="#/settings">Einstellungen</a> – oder als Datei herunterladen.</div>`}
        <div class="row3">
          <label>Titel<input class="field" id="fTitle" value="${esc(h.title)}" required></label>
          <label>Interpret<input class="field" id="fArtist" value="${esc(h.artist)}"></label>
          <label>Tonart<input class="field" id="fKey" value="${esc(h.key)}" placeholder="z.B. Am"></label>
        </div>
        <label>Tags
          <div class="field taginput" id="tagbox"><input id="fTag" list="taglist" placeholder="Tag hinzufügen…" autocomplete="off" enterkeyhint="done"></div>
          <datalist id="taglist">${known.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
        </label>
        <div class="tags" id="tagsuggest"></div>
        <label>Text mit Akkorden
          <textarea class="field" id="fBody" spellcheck="false" autocapitalize="off" placeholder="Text einfügen – z.B. von einer Akkord-Webseite kopiert.&#10;&#10;Akkorde inline:  [G]Hello my [C]friend&#10;oder über dem Text – wird automatisch umgewandelt.&#10;Abschnitte:  [Verse 1]  [Chorus] …">${esc(h.body)}</textarea>
        </label>
        <div class="notice" id="convNote" hidden>Akkorde stehen über dem Text. <button class="btn" id="convert">In Inline-Akkorde umwandeln</button></div>
        <div class="actions">
          <button class="btn" id="previewBtn">Vorschau</button>
          <button class="btn" id="dl">Als Datei</button>
          ${song ? '<button class="btn danger" id="del">Löschen</button>' : ''}
        </div>
        <div class="preview song" id="preview" hidden></div>
        <p class="hint">Format: <a href="https://www.chordpro.org/chordpro/chordpro-introduction/" target="_blank" rel="noopener">ChordPro</a>. Abschnitte als eigene Zeile, z.B. <code>[Chorus]</code>; Kommentare mit <code>{c: Capo 2}</code>.</p>
      </div>
    </div>`;

  const $ = s => app.querySelector(s);
  const body = $('#fBody');
  const tagbox = $('#tagbox');
  const tagIn = $('#fTag');

  const drawTags = () => {
    tagbox.querySelectorAll('.chip').forEach(c => c.remove());
    tagIn.insertAdjacentHTML('beforebegin', tags.map(t => `<span class="chip on">${esc(t)}<button type="button" class="ib" style="min-width:20px;height:20px;padding:0;color:inherit" data-rm="${esc(t)}" aria-label="${esc(t)} entfernen">×</button></span>`).join(''));
    $('#tagsuggest').innerHTML = known.filter(t => !tags.includes(t)).slice(0, 30).map(t => `<button class="chip" type="button" data-add="${esc(t)}">+ ${esc(t)}</button>`).join('');
  };
  const addTag = raw => {
    for (const t of raw.split(',').map(s => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean)) if (!tags.includes(t)) tags.push(t);
    tagIn.value = ''; drawTags();
  };
  tagIn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagIn.value); }
    else if (e.key === 'Backspace' && !tagIn.value && tags.length) { tags.pop(); drawTags(); }
  });
  tagIn.addEventListener('change', () => { if (known.includes(tagIn.value.trim())) addTag(tagIn.value); });
  tagIn.addEventListener('blur', () => { if (tagIn.value.trim()) addTag(tagIn.value); });
  const onClick = e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { tags = tags.filter(t => t !== rm.dataset.rm); drawTags(); }
    const add = e.target.closest('[data-add]');
    if (add) addTag(add.dataset.add);
  };
  app.addEventListener('click', onClick);
  cleanup = () => app.removeEventListener('click', onClick);
  drawTags();

  const checkConv = () => { $('#convNote').hidden = !hasChordsOverLyrics(body.value); };
  body.addEventListener('input', () => { checkConv(); if (!$('#preview').hidden) drawPreview(); });
  body.addEventListener('paste', e => {
    const txt = e.clipboardData?.getData('text/plain');
    if (!txt) return;
    e.preventDefault();
    let clean = cleanPasted(txt);
    // "Hurt Chords by Johnny Cash" -> title/artist
    const first = clean.split('\n')[0].match(/^(.+?)\s+(?:chords|tab|tabs|ukulele chords|akkorde)\s+(?:by|von)\s+(.+)$/i);
    if (first) {
      if (!$('#fTitle').value) $('#fTitle').value = first[1].trim();
      if (!$('#fArtist').value) $('#fArtist').value = first[2].trim();
      clean = clean.split('\n').slice(1).join('\n').trim();
    }
    const before = body.value;
    body.setRangeText(clean, body.selectionStart, body.selectionEnd, 'end');
    if (hasChordsOverLyrics(body.value)) {
      const raw = body.value;
      body.value = chordsOverLyricsToInline(raw);
      toast('Akkorde über dem Text wurden umgewandelt.', { label: 'Rückgängig', run: () => { body.value = raw; checkConv(); } });
    }
    if (!before.trim() && !$('#fTitle').value) $('#fTitle').focus();
    checkConv();
  });
  $('#convert').onclick = () => {
    const raw = body.value;
    body.value = chordsOverLyricsToInline(raw);
    checkConv();
    toast('Umgewandelt.', { label: 'Rückgängig', run: () => { body.value = raw; checkConv(); } });
  };
  checkConv();

  const current = () => buildSong({ title: $('#fTitle').value, artist: $('#fArtist').value, key: $('#fKey').value, tags, body: body.value });
  const drawPreview = () => {
    const s = songFromFile('preview', '', current());
    $('#preview').innerHTML = `<div class="body">${renderBody(s, { chords: true, tr: 0 })}</div>`;
    $('#preview').style.setProperty('--fs', settings.fs + 'px');
  };
  $('#previewBtn').onclick = () => { const p = $('#preview'); p.hidden = !p.hidden; if (!p.hidden) { drawPreview(); p.scrollIntoView({ behavior: 'smooth' }); } };
  const fileName = () => (song ? song.path.split('/').pop() : slugify(`${$('#fArtist').value} ${$('#fTitle').value}`) + '.pro');
  $('#dl').onclick = () => download(fileName(), current());
  $('#cancel').onclick = () => (song ? go(`#/s/${encodeURIComponent(song.path)}`) : go('#/'));

  $('#save').onclick = async () => {
    const title = $('#fTitle').value.trim();
    if (!title) { $('#fTitle').focus(); return toast('Bitte einen Titel eingeben.'); }
    const text = current();
    if (song && text === song.text) return go(`#/s/${encodeURIComponent(song.path)}`);
    if (!canWrite()) { download(fileName(), text); return toast('Kein Token – Datei wurde heruntergeladen.'); }
    let p = song?.path;
    if (!p) {
      const base = slugify(`${$('#fArtist').value} ${title}`);
      p = `${base}.pro`;
      for (let i = 2; cache.files[p]; i++) p = `${base}-${i}.pro`;
    }
    const btn = $('#save');
    btn.disabled = true; btn.textContent = 'Speichere…';
    try {
      await putFile(p, text, `${song ? 'Update' : 'Add'}: ${title}`, song?.sha);
      toast('Gespeichert.');
      go(`#/s/${encodeURIComponent(p)}`, true);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Speichern';
      toast(e.status === 409 || e.status === 422 ? 'Konflikt: Song wurde woanders geändert. Bitte neu laden.' : e.message);
    }
  };

  if (song) {
    $('#del').onclick = async () => {
      if (!confirm(`„${song.title}“ wirklich löschen?`)) return;
      if (!canWrite()) return toast('Zum Löschen wird ein Token benötigt.');
      try { await deleteFile(song.path, song.sha, `Delete: ${song.title}`); toast('Gelöscht.'); go('#/', true); }
      catch (e) { toast(e.message); }
    };
  } else {
    body.focus();
  }
}

// ================================================================ settings

function viewSettings() {
  document.title = 'Einstellungen';
  const tags = allTags();
  app.innerHTML = `
    <header class="bar">
      <a class="ib" href="#/" aria-label="Zurück">${icon('back')}</a>
      <div class="grow"><h2>Einstellungen</h2></div>
    </header>
    <div class="page settings">
      <section class="form">
        <h3>GitHub</h3>
        ${settings.token ? '' : `<div class="notice">Die Songs liegen in einem privaten Repository. Trag einmal pro Gerät deinen Token ein, dann werden sie geladen und offline gespeichert.</div>`}
        <label>Repository (owner/name)<input class="field" id="sRepo" value="${esc(settings.repo)}" placeholder="${esc(DEFAULT_REPO)}"></label>
        <label>Branch<input class="field" id="sBranch" value="${esc(settings.branch)}"></label>
        <label>GitHub-Token<input class="field" id="sToken" type="password" value="${esc(settings.token)}" autocomplete="off" placeholder="github_pat_…"></label>
        <p class="hint">Fine-grained Token auf github.com → Settings → Developer settings → Fine-grained tokens:
          Repository access <i>Only select repositories</i> → <b>${esc(repo())}</b>, Permission <b>Contents: Read and write</b>. Er bleibt nur auf diesem Gerät gespeichert.</p>
        <div class="actions">
          <button class="btn primary" id="sSave">Speichern &amp; synchronisieren</button>
          <button class="btn" id="sReload">Alles neu laden</button>
        </div>
        <p class="hint" id="sInfo">${esc(S.error || S.status)}</p>
      </section>
      <section class="form">
        <h3>Darstellung</h3>
        <label>Farbschema
          <select class="field" id="sTheme">
            ${[['auto', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => `<option value="${v}" ${settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </section>
      <section>
        <h3>Tags (${tags.length})</h3>
        <p class="hint">Neue Tags entstehen einfach beim Bearbeiten eines Songs. Hier kannst du sie für alle Songs umbenennen oder entfernen.</p>
        <ul class="taglist">${tags.map(([t, n]) => `<li><span>${esc(t)} <small class="hint">${n}</small></span>
          <button class="btn" data-ren="${esc(t)}">Umbenennen</button><button class="btn danger" data-deltag="${esc(t)}">Entfernen</button></li>`).join('')}</ul>
      </section>
    </div>`;
  const $ = s => app.querySelector(s);
  $('#sSave').onclick = () => {
    settings.repo = $('#sRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
    settings.branch = $('#sBranch').value.trim() || 'main';
    settings.token = $('#sToken').value.trim();
    saveSettings();
    sync({ force: true }).then(() => toast(S.error || 'Synchronisiert.'));
  };
  $('#sReload').onclick = () => { cache = { commit: null, files: {} }; LS.set('sb.cache', cache); sync({ force: true }).then(() => toast(S.error || 'Neu geladen.')); };
  $('#sTheme').onchange = e => {
    settings.theme = e.target.value; saveSettings();
    if (settings.theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
  };
  app.querySelector('.taglist').onclick = async e => {
    const ren = e.target.closest('[data-ren]')?.dataset.ren;
    const del = e.target.closest('[data-deltag]')?.dataset.deltag;
    if (!ren && !del) return;
    if (!canWrite()) return toast('Dafür wird ein Token benötigt.');
    let to = null;
    if (ren) {
      to = prompt(`Tag „${ren}“ umbenennen in:`, ren);
      if (!to || !(to = to.trim().toLowerCase().replace(/\s+/g, '-')) || to === ren) return;
    } else if (!confirm(`Tag „${del}“ aus allen Songs entfernen?`)) return;
    const from = ren || del;
    const changes = S.songs.filter(s => s.tags.includes(from)).map(s => {
      const h = splitHeader(s.text);
      let t = h.tags.flatMap(x => (x === from ? (to ? [to] : []) : [x]));
      t = [...new Set(t)];
      return { path: s.path, text: buildSong({ ...h, tags: t }) };
    });
    try {
      toast('Speichere…');
      await commitMany(changes, ren ? `Rename tag ${from} -> ${to}` : `Remove tag ${from}`);
      if (S.tags.delete(from) && to) S.tags.add(to);
      LS.set('sb.filter', [...S.tags]);
      toast(`${changes.length} Songs aktualisiert.`);
      viewSettings();
    } catch (err) { toast(err.message); }
  };
}

// ================================================================ start

rebuildSongs();
S.status = S.songs.length ? `${S.songs.length} Songs (gespeichert)` : '';
if (!settings.token && !S.songs.length && !isLocalDev() && !location.hash) history.replaceState(null, '', '#/settings');
route();
sync();
window.addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !location.hash.startsWith('#/e/')) sync(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
