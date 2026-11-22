// Chord diagrams for arbitrary tunings: chord-name parsing, voicing search, SVG rendering.
// Voicings are computed, not looked up, so every tuning works (open, drop, banjo, ukulele, custom).

// ------------------------------------------------------------------ tunings
// Strings are listed left to right as drawn in a diagram (guitar: low E first; banjo: short 5th string first).

export const TUNINGS = [
  { id: 'gtr', group: 'Gitarre', name: 'Standard', notes: 'E2 A2 D3 G3 B3 E4' },
  { id: 'gtr-dropd', group: 'Gitarre', name: 'Drop D', notes: 'D2 A2 D3 G3 B3 E4' },
  { id: 'gtr-dropc', group: 'Gitarre', name: 'Drop C', notes: 'C2 G2 C3 F3 A3 D4' },
  { id: 'gtr-openg', group: 'Gitarre', name: 'Open G', notes: 'D2 G2 D3 G3 B3 D4' },
  { id: 'gtr-opend', group: 'Gitarre', name: 'Open D', notes: 'D2 A2 D3 F#3 A3 D4' },
  { id: 'gtr-openc', group: 'Gitarre', name: 'Open C', notes: 'C2 G2 C3 G3 C4 E4' },
  { id: 'gtr-dadgad', group: 'Gitarre', name: 'DADGAD', notes: 'D2 A2 D3 G3 A3 D4' },
  { id: 'gtr-eb', group: 'Gitarre', name: 'Halbton tiefer (Eb)', notes: 'Eb2 Ab2 Db3 Gb3 Bb3 Eb4' },
  { id: 'bj-openg', group: 'Banjo (5-saitig)', name: 'Open G (gDGBD)', notes: 'G4 D3 G3 B3 D4', drone: true },
  { id: 'bj-doublec', group: 'Banjo (5-saitig)', name: 'Double C (gCGCD)', notes: 'G4 C3 G3 C4 D4', drone: true },
  { id: 'bj-c', group: 'Banjo (5-saitig)', name: 'Standard C (gCGBD)', notes: 'G4 C3 G3 B3 D4', drone: true },
  { id: 'bj-sawmill', group: 'Banjo (5-saitig)', name: 'Sawmill / G modal (gDGCD)', notes: 'G4 D3 G3 C4 D4', drone: true },
  { id: 'bj-opend', group: 'Banjo (5-saitig)', name: 'Open D (f#DF#AD)', notes: 'F#4 D3 F#3 A3 D4', drone: true },
  { id: 'bj-opena', group: 'Banjo (5-saitig)', name: 'Open A (aEAC#E)', notes: 'A4 E3 A3 C#4 E4', drone: true },
  { id: 'uke', group: 'Ukulele', name: 'Standard (gCEA)', notes: 'G4 C4 E4 A4' },
  { id: 'uke-bari', group: 'Ukulele', name: 'Bariton (DGBE)', notes: 'D3 G3 B3 E4' },
  { id: 'mando', group: 'Mandoline', name: 'Standard (GDAE)', notes: 'G3 D4 A4 E5' },
];

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };
const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function notePc(s) {
  const m = s.match(/^([A-Ha-h])([#b]?)/);
  if (!m) return null;
  return (PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

/** "D2 G2 D3 G3 B3 D4" or "DGDGBD" or "gDGBD" -> [{pc, midi, name}] */
export function parseNotes(str) {
  const toks = str.trim().includes(' ') || /\d/.test(str)
    ? str.trim().split(/[\s,]+/)
    : str.trim().match(/[A-Ha-h][#b]?/g) || [];
  const out = [];
  let prev = null;
  for (const t of toks) {
    const m = t.match(/^([A-Ha-h])([#b]?)(\d)?$/);
    if (!m) return null;
    const pc = notePc(t);
    let midi;
    if (m[3] !== undefined) midi = (Number(m[3]) + 1) * 12 + pc;
    else if (m[1] === m[1].toLowerCase() && out.length === 0) midi = 60 + pc + (pc < 5 ? 12 : 0); // banjo-style high short string
    else { midi = prev == null ? 40 + ((pc - 4 + 12) % 12) : prev + ((pc - prev % 12 + 12) % 12 || 12); }
    if (!(m[1] === m[1].toLowerCase() && out.length === 0)) prev = midi;
    out.push({ pc, midi, name: m[1].toUpperCase() + m[2] });
  }
  return out.length >= 3 && out.length <= 8 ? out : null;
}

/** Resolve a tuning reference (preset id, preset name, custom entry or note string). */
export function getTuning(ref, custom = []) {
  const all = [...TUNINGS, ...custom];
  let t = all.find(x => x.id === ref) ||
    all.find(x => ref && x.name.toLowerCase().replace(/\s*\(.*\)/, '') === String(ref).toLowerCase().trim());
  if (!t && ref) {
    const strs = parseNotes(String(ref));
    if (strs) t = { id: 'x:' + ref, group: 'Eigene', name: String(ref), notes: String(ref), drone: /^[a-h]/.test(String(ref).trim()) && strs.length === 5 };
  }
  t = t || TUNINGS[0];
  const strings = parseNotes(t.notes);
  return { ...t, strings };
}

// ------------------------------------------------------------- chord names

const DEG = { 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 10, 9: 14, 11: 17, 13: 21 };

/** Parse a chord symbol -> { root, bass, required:[pc], optional:[pc] } or null */
export function chordTones(name) {
  const m = String(name).replace(/\*+$/, '').match(/^([A-H])([#b]?)(.*?)(?:\/([A-H][#b]?))?$/);
  if (!m) return null;
  const root = notePc(m[1] + m[2]);
  let q = m[3].replace(/[()]/g, '');
  let third = 4, fifth = 7, seventh = null;
  const ext = [];
  const opt = new Set();
  let mm;
  if ((mm = q.match(/^(maj|M|Δ|ma)(?=\d|$)/))) { seventh = 11; q = q.slice(mm[0].length); if (!/^\d/.test(q)) q = '7' + q; }
  else if ((mm = q.match(/^(min|mi|m|-)(?!aj)/))) { third = 3; q = q.slice(mm[0].length); if ((mm = q.match(/^(maj|M|Δ)/))) { seventh = 11; q = q.slice(mm[0].length); if (!/^\d/.test(q)) q = '7' + q; } }
  else if ((mm = q.match(/^(dim|°|o)/))) { third = 3; fifth = 6; q = q.slice(mm[0].length); if (/^7/.test(q)) { seventh = 9; q = q.slice(1); } }
  else if ((mm = q.match(/^(ø)/))) { third = 3; fifth = 6; seventh = 10; q = q.slice(1).replace(/^7/, ''); }
  else if ((mm = q.match(/^(aug|\+)/))) { fifth = 8; q = q.slice(mm[0].length); }

  // main number
  if ((mm = q.match(/^(5|6|7|9|11|13)/))) {
    const n = Number(mm[1]);
    q = q.slice(mm[0].length);
    if (n === 5 && !/^\d/.test(q)) third = null;
    else if (n === 6) { ext.push(9); if (/^\/?9/.test(q)) { ext.push(14); q = q.replace(/^\/?9/, ''); } }
    else if (n >= 7) {
      if (seventh == null) seventh = 10;
      if (n >= 9) { ext.push(14); if (n > 9) opt.add(14); }
      if (n >= 11) { ext.push(17); if (n === 11 && third === 4) third = null; if (n > 11) opt.add(17); }
      if (n === 13) ext.push(21);
    }
  }
  // modifiers
  const re = /(sus2|sus4|sus|add\s?(\d+)|no\s?(\d)|([b#+-])(5|9|11|13)|aug|dim|maj7|M7)/g;
  while ((mm = re.exec(q))) {
    const t = mm[1];
    if (t === 'sus2') third = 2;
    else if (t === 'sus4' || t === 'sus') third = 5;
    else if (t === 'maj7' || t === 'M7') seventh = 11;
    else if (t === 'aug') fifth = 8;
    else if (t === 'dim') fifth = 6;
    else if (mm[2]) { const d = Number(mm[2]); if (DEG[d] != null) ext.push(DEG[d]); }
    else if (mm[3]) { if (mm[3] === '3') third = null; if (mm[3] === '5') fifth = null; }
    else if (mm[4]) {
      const d = Number(mm[5]); const shift = mm[4] === 'b' || mm[4] === '-' ? -1 : 1;
      if (d === 5) fifth = 7 + shift; else { ext.push(DEG[d] + shift); opt.delete(DEG[d]); }
    }
  }
  const rest = q.replace(re, '').trim();
  if (rest && !/^[\s.]*$/.test(rest)) return null; // unknown symbol

  const req = new Set([0]);
  const optional = new Set();
  if (third != null) req.add(third);
  if (fifth != null) (fifth === 7 ? optional : req).add(fifth);
  if (third == null && fifth === 7) { optional.delete(7); req.add(7); } // power chord / no3
  if (seventh != null) req.add(seventh);
  for (const e of ext) (opt.has(e) ? optional : req).add(e);
  const pcs = x => [...x].map(i => (root + i) % 12);
  return {
    root,
    bass: m[4] ? notePc(m[4]) : root,
    required: [...new Set(pcs(req))],
    optional: pcs(optional).filter(p => !pcs(req).includes(p)),
  };
}

// ---------------------------------------------------------- voicing search

const memo = new Map();

/**
 * All playable voicings of a chord on a tuning, best first.
 * voicing: { frets: [-1 = muted, 0 = open, n], pos, barre: {fret, from, to} | null, open: bool }
 */
export function voicings(chord, tuning) {
  const key = chord + '|' + tuning.notes + '|' + !!tuning.drone;
  if (memo.has(key)) return memo.get(key);
  const res = search(chord, tuning);
  memo.set(key, res);
  return res;
}

function search(chord, tuning) {
  const ct = chordTones(chord);
  const strs = tuning.strings;
  if (!ct || !strs) return [];
  const n = strs.length;
  const reentrant = strs.some((s, i) => i > 0 && s.midi < strs[i - 1].midi);
  const chordPcs = new Set([...ct.required, ...ct.optional, ct.bass]);
  const minSounding = n >= 6 ? 4 : 3;
  const maxFret = 14;
  const found = new Map();

  for (let base = 0; base <= maxFret - 3; base++) {
    const lo = Math.max(1, base), hi = base + 3;
    const opts = strs.map((s, i) => {
      const o = [-1];
      if (chordPcs.has(s.pc)) o.push(0);
      if (!(tuning.drone && i === 0)) {
        for (let f = lo; f <= hi; f++) if (chordPcs.has((s.pc + f) % 12)) o.push(f);
      }
      return o;
    });
    const cur = new Array(n);
    const rec = i => {
      if (i === n) { evaluate(cur.slice()); return; }
      for (const f of opts[i]) { cur[i] = f; rec(i + 1); }
    };
    rec(0);
  }

  function evaluate(frets) {
    const k = frets.join(',');
    if (found.has(k)) return;
    const sounding = frets.map((f, i) => (f >= 0 ? i : -1)).filter(i => i >= 0);
    if (sounding.length < Math.min(minSounding, n)) return;
    const pcs = new Set(sounding.map(i => (strs[i].pc + frets[i]) % 12));
    if (!ct.required.every(p => pcs.has(p))) return;
    if (ct.bass !== ct.root && !pcs.has(ct.bass)) return;

    const fretted = frets.filter(f => f > 0);
    const minF = fretted.length ? Math.min(...fretted) : 0;
    const maxF = fretted.length ? Math.max(...fretted) : 0;
    if (maxF - minF > 3) return;

    // fingers & barre
    let fingers = fretted.length, barre = null;
    const atMin = frets.map((f, i) => (f === minF && minF > 0 ? i : -1)).filter(i => i >= 0);
    if (atMin.length >= 2 && fretted.length > 4) { // only barre when needed
      const from = atMin[0], to = atMin[atMin.length - 1];
      let ok = true;
      for (let i = from; i <= to; i++) if (frets[i] < minF) ok = false; // muted/open under the barre
      if (ok) { barre = { fret: minF, from, to }; fingers = 1 + fretted.filter(f => f > minF).length; }
    }
    if (fingers > 4) return;

    // bass note
    let lowest = null;
    for (const i of sounding) {
      const midi = strs[i].midi + frets[i];
      if (lowest == null || midi < lowest.midi) lowest = { midi, pc: midi % 12 };
    }
    // muted strings between sounding strings are awkward
    const first = sounding[0], last = sounding[sounding.length - 1];
    const innerMutes = frets.slice(first, last + 1).filter(f => f < 0).length;
    const outerMutes = n - sounding.length - innerMutes;
    const opens = frets.filter((f, i) => f === 0 && !(tuning.drone && i === 0)).length;

    let score = 0;
    if (lowest.pc !== ct.bass) score += reentrant ? 0.5 : (ct.bass !== ct.root ? 12 : 7);
    const droneMuted = tuning.drone && frets[0] < 0 ? 1 : 0;
    score += (outerMutes - droneMuted) * (n >= 6 ? 1.2 : 3) + innerMutes * 5;
    score += droneMuted * 0.5;
    score += maxF * 0.65 + (maxF - minF) * 0.6 + fingers * 0.35;
    score -= opens * 0.25;
    if (!ct.optional.every(p => pcs.has(p))) score += 0.6;
    if (n >= 6 && barre && barre.to - barre.from >= 3) score -= 1; // classic movable barre shapes
    if (maxF >= 4) score += frets.filter((f, i) => f === 0 && i > first && i < last).length * 0.6; // odd open strings up the neck

    found.set(k, { frets, pos: minF, barre, fingers, score, open: frets.some((f, i) => f === 0 && !(tuning.drone && i === 0)) && maxF <= 4 });
  }

  const list = [...found.values()].sort((a, b) => a.score - b.score);
  // keep the best few per position so higher positions show up when cycling
  const perPos = new Map();
  const out = [];
  for (const v of list) {
    const p = v.open ? 0 : v.pos;
    const c = perPos.get(p) || 0;
    if (c >= 3) continue;
    perPos.set(p, c + 1);
    out.push(v);
    if (out.length >= 24) break;
  }
  return out;
}

export function voicingLabel(v) {
  if (v.open) return 'offen';
  if (!v.pos) return 'offen';
  return `${v.pos}. Bund`;
}

// ------------------------------------------------------------------ SVG

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Diagram as inline SVG. Strings vertical, nut on top. */
export function diagramSVG(v, tuning, { width = 110 } = {}) {
  const strs = tuning.strings;
  const n = strs.length;
  const fretted = v.frets.filter(f => f > 0);
  const maxF = fretted.length ? Math.max(...fretted) : 0;
  const start = maxF <= 4 ? 1 : v.pos;
  const rows = Math.max(4, (fretted.length ? maxF - start + 1 : 0));
  const padL = 18, padR = 10, top = 22, sp = 16, fh = 18;
  const w = padL + padR + sp * (n - 1);
  const h = top + rows * fh + 20;
  const x = i => padL + i * sp;
  const y = f => top + (f - start + 0.5) * fh;
  let s = `<svg class="dia" viewBox="0 0 ${w} ${h}" width="${width}" height="${Math.round(width * h / w)}" role="img" aria-label="Griffbild">`;
  // frets
  for (let r = 0; r <= rows; r++) {
    const yy = top + r * fh;
    s += `<line x1="${x(0)}" x2="${x(n - 1)}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity=".45" stroke-width="${r === 0 && start === 1 ? 4 : 1}"/>`;
  }
  // strings (banjo drone starts at 5th fret)
  for (let i = 0; i < n; i++) {
    const droneStart = tuning.drone && i === 0 && start === 1 ? top + 5 * fh : top;
    const y2 = top + rows * fh;
    if (droneStart < y2) s += `<line x1="${x(i)}" x2="${x(i)}" y1="${droneStart}" y2="${y2}" stroke="currentColor" stroke-opacity=".55"/>`;
  }
  if (start > 1) s += `<text x="${padL - 6}" y="${y(start) + 4}" font-size="11" text-anchor="end" fill="currentColor">${start}</text>`;
  // barre
  if (v.barre) {
    const yy = y(v.barre.fret);
    s += `<rect x="${x(v.barre.from) - 6}" y="${yy - 6}" width="${x(v.barre.to) - x(v.barre.from) + 12}" height="12" rx="6" class="dot"/>`;
  }
  // markers & dots
  v.frets.forEach((f, i) => {
    const droneOpen = tuning.drone && i === 0;
    if (f < 0) s += `<text x="${x(i)}" y="${top - 7}" font-size="11" text-anchor="middle" fill="currentColor" fill-opacity=".7">×</text>`;
    else if (f === 0) s += `<circle cx="${x(i)}" cy="${top - 11}" r="4" fill="none" stroke="currentColor" stroke-width="1.4"${droneOpen ? ' stroke-dasharray="2 1.5"' : ''}/>`;
    else if (!(v.barre && f === v.barre.fret && i >= v.barre.from && i <= v.barre.to)) s += `<circle cx="${x(i)}" cy="${y(f)}" r="6" class="dot"/>`;
  });
  // string notes
  strs.forEach((st, i) => {
    s += `<text x="${x(i)}" y="${h - 5}" font-size="9" text-anchor="middle" fill="currentColor" fill-opacity=".55">${esc(st.name)}</text>`;
  });
  return s + '</svg>';
}

/** Pitch-class names of the notes a voicing plays (for the detail view). */
export function voicingNotes(v, tuning, flat) {
  const names = flat ? NAMES_FLAT : NAMES_SHARP;
  return v.frets.map((f, i) => (f < 0 ? '×' : names[(tuning.strings[i].pc + f) % 12]));
}

// ------------------------------------------------------- key suggestions

/**
 * How comfortable is a set of chord shapes on this tuning? Lower is better.
 * Uses the best voicing of every chord; on a 5-string banjo a muted drone string costs extra.
 */
export function fitCost(shapes, tuning) {
  if (!shapes.length) return 0;
  let sum = 0;
  for (const c of shapes) {
    const v = voicings(c, tuning)[0];
    if (!v) { sum += 15; continue; }
    sum += v.score + (tuning.drone && v.frets[0] < 0 ? 1.5 : 0);
  }
  return sum / shapes.length;
}

/**
 * Rank all 12 shape offsets for a song's (sounding) chords.
 * offset k means: play shapes = chord transposed by k.
 *   capo  = -k (mod 12), keeps the sounding key   (only 1..7 offered)
 *   transpose = k, changes the sounding key
 */
export function suggestOffsets(chords, tuning, transpose) {
  const out = [];
  for (let k = -6; k <= 5; k++) {
    const shapes = chords.map(c => transpose(c, k));
    out.push({ k, cost: fitCost(shapes, tuning) });
  }
  return out.sort((a, b) => a.cost - b.cost);
}
