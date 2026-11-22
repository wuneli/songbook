// ChordPro parsing, rendering helpers, transposition and import conversion.
// Shared by the browser app and tools/migrate.mjs (plain ES module, no deps).

const CHORD_RE = /^(?:[A-H][#b]?)(?:maj|min|mi|m|M|dim|aug|sus|add|°|ø|\+|-)?(?:\d{1,2})?(?:(?:maj|sus|add|dim|aug|no|b|#|\+|-|M)\d{0,2})*(?:\([^)\s]*\))?\*?(?:\/[A-H][#b]?)?$/;
const NC_RE = /^(?:N\.?C\.?|n\.c\.)$/;
// Tokens allowed on a chord line besides chords: bars, repeats, dashes, dots.
const CHORD_LINE_FILLER_RE = /^(?:\|+:?|:?\|+|\/+|-+|\.+|%|\[\.\]|\(?\d+\s*x\)?|\(?x\s*\d+\)?|\(|\)|\*)$/i;
const SECTION_WORDS = 'intro|verse|vers|strophe|chorus|refrain|pre-?chorus|post[- ]?chorus|bridge|outro|solo|instrumental|interlude|hook|coda|break|riff|main riff|ending|zwischenspiel|tag';
const SECTION_RE = new RegExp(`^\\s*[\\[(]?\\s*(?:${SECTION_WORDS})(?:\\s*(?:\\d+|x\\s?\\d+|\\d+\\s?x|\\([^)]*\\)))*(?:\\s*[:\\-–].{0,25})?\\s*[\\])]?:?\\s*$`, 'i');
const TAB_RE = /^\s*(?:[A-Ga-g][#b]?\s*)?\|?[-0-9|hpbrsx\/\\~^().\s]*-{3,}[-0-9|hpbrsx\/\\~^().\s]*\|?\s*$/;

export function isChord(tok) {
  return CHORD_RE.test(tok) || NC_RE.test(tok);
}

/** A plain text line consisting only of chords (plus bars/repeats). */
export function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  let chords = 0;
  for (const t of toks) {
    if (isChord(t)) chords++;
    else if (!CHORD_LINE_FILLER_RE.test(t)) return false;
  }
  return chords > 0;
}

/** Text that contains nothing but chords, bars and repeat marks (or nothing). */
function isFillerText(text) {
  return text.trim().split(/\s+/).filter(Boolean).every(t => isChord(t) || CHORD_LINE_FILLER_RE.test(t));
}

/** Only real chords (no bars etc.) – suitable for merging into a lyric line. */
function isPureChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every(isChord);
}

export function isSectionLine(line) {
  return line.trim().length < 40 && SECTION_RE.test(line);
}

export function isTabLine(line) {
  return TAB_RE.test(line);
}

// ---------------------------------------------------------------- parsing

const META_KEYS = {
  t: 'title', title: 'title', st: 'subtitle', subtitle: 'subtitle', artist: 'artist',
  key: 'key', capo: 'capo', tempo: 'tempo', metronome: 'tempo', time: 'time', duration: 'duration',
  album: 'album', year: 'year', composer: 'composer',
};

/**
 * Parse ChordPro text. Returns { meta, tags, blocks }.
 * blocks: {type:'section'|'comment'|'lyrics'|'chords'|'chordtext'|'tab'|'empty', ...}
 */
export function parse(text) {
  const meta = {};
  const tags = [];
  const blocks = [];
  let env = null; // 'chorus' | 'tab'
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (env === 'tab') {
      if (/^\{\s*(eot|end_of_tab)\s*\}$/i.test(line.trim())) { env = null; continue; }
      blocks.push({ type: 'tab', text: line });
      continue;
    }
    const dir = line.trim().match(/^\{\s*([\w-]+)\s*(?::\s*(.*?))?\s*\}$/);
    if (dir) {
      const name = dir[1].toLowerCase();
      const val = (dir[2] ?? '').trim();
      if (name === 'tag' || name === 'tags') {
        val.split(',').map(s => s.trim()).filter(Boolean).forEach(t => tags.includes(t) || tags.push(t));
      } else if (name === 'meta') {
        const m = val.match(/^(\S+)\s+(.*)$/);
        if (m && m[1].toLowerCase() === 'tag') tags.push(m[2].trim());
        else if (m) meta[META_KEYS[m[1].toLowerCase()] || m[1].toLowerCase()] = m[2].trim();
      } else if (META_KEYS[name]) {
        if (val) meta[META_KEYS[name]] = val;
      } else if (name === 'c' || name === 'comment' || name === 'ci' || name === 'comment_italic' || name === 'cb' || name === 'highlight') {
        blocks.push({ type: 'comment', text: val });
      } else if (name === 'soc' || name === 'start_of_chorus') {
        env = 'chorus';
        blocks.push({ type: 'section', text: val || 'Chorus', chorus: true });
      } else if (name === 'eoc' || name === 'end_of_chorus') {
        env = null;
      } else if (name === 'sot' || name === 'start_of_tab') {
        env = 'tab';
      } else if (name === 'sov' || name === 'start_of_verse' || name === 'sob' || name === 'start_of_bridge') {
        if (val) blocks.push({ type: 'section', text: val });
      }
      // other directives (define, zoom, eov, ...) are ignored for display
      continue;
    }
    if (/^#/.test(line)) continue; // ChordPro comment
    const chorus = env === 'chorus';

    if (!line.trim()) { blocks.push({ type: 'empty' }); continue; }

    // "[Verse 1]" alone on a line, where the content is not a chord -> section label
    const only = line.trim().match(/^\[([^\]]+)\]$/);
    if (only && !isChord(only[1].trim())) {
      blocks.push({ type: 'section', text: only[1].trim(), chorus });
      continue;
    }

    if (line.includes('[')) {
      const segs = splitSegments(line);
      const chordOnly = segs.every(s => isFillerText(s.text));
      blocks.push({ type: chordOnly ? 'chords' : 'lyrics', segs, chorus });
      continue;
    }
    if (isSectionLine(line)) { blocks.push({ type: 'section', text: line.trim().replace(/^[\[(]|[\])]?:?$/g, ''), chorus }); continue; }
    if (isChordLine(line)) { blocks.push({ type: 'chordtext', text: line, chorus }); continue; }
    if (isTabLine(line)) { blocks.push({ type: 'tab', text: line }); continue; }
    blocks.push({ type: 'lyrics', segs: [{ chord: null, text: line }], chorus });
  }
  return { meta, tags, blocks };
}

function splitSegments(line) {
  const segs = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0, chord = null, m;
  while ((m = re.exec(line))) {
    if (m.index > last || chord !== null) segs.push({ chord, text: line.slice(last, m.index) });
    chord = m[1].trim();
    last = re.lastIndex;
  }
  segs.push({ chord, text: line.slice(last) });
  return segs.filter((s, i) => i > 0 || s.chord !== null || s.text);
}

// ---------------------------------------------------------- transposition

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_IDX = { C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, H: 11, Cb: 11 };

function shiftNote(note, n, preferFlat) {
  const i = NOTE_IDX[note];
  if (i === undefined) return note;
  const j = ((i + n) % 12 + 12) % 12;
  return (preferFlat ? FLATS : SHARPS)[j];
}

export function transposeChord(chord, n) {
  if (!n || !isChord(chord) || NC_RE.test(chord)) return chord;
  return chord.replace(/^([A-H][#b]?)(.*?)(?:\/([A-H][#b]?))?$/, (_, root, rest, bass) => {
    const flat = root.includes('b') || (!root.includes('#') && n < 0);
    const newRoot = shiftNote(root, n, flat);
    // spell the bass note to fit the new root's key (A/C#, Bb/D)
    const bassFlat = newRoot.includes('b') || newRoot === 'F';
    return newRoot + rest + (bass ? '/' + shiftNote(bass, n, bassFlat) : '');
  });
}

/** Transpose chord tokens inside a plain chord line, keeping spacing. */
export function transposeChordText(text, n) {
  if (!n) return text;
  return text.replace(/\S+/g, t => (isChord(t) ? transposeChord(t, n) : t));
}

// --------------------------------------------------------------- import

/** Clean up text pasted from chord websites (Ultimate Guitar & co.). */
export function cleanPasted(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/\t/g, '    ')
    .replace(/\[\/?(?:ch|tab)\]/g, '')
    .split('\n').map(l => l.replace(/\s+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert "chords above lyrics" into inline ChordPro:
 *    G        C
 *    Hello my friend   ->  [G]Hello my [C]friend
 * Lines that are not followed by a lyric line stay as chord lines.
 */
export function chordsOverLyricsToInline(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (!line.includes('[') && !line.includes('{') && isPureChordLine(line) &&
        next !== undefined && next.trim() && !next.includes('[') && !next.trim().startsWith('{') &&
        !isChordLine(next) && !isSectionLine(next) && !isTabLine(next) && !mentionsChords(next)) {
      out.push(mergeChordLine(line, next));
      i++;
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

// A text line that talks about chords ("a C7sus4 is C F G Bb") is not a lyric line.
function mentionsChords(line) {
  const toks = line.trim().split(/\s+/);
  const n = toks.filter(t => isChord(t.replace(/[,.;:!?)]+$/, ''))).length;
  return n >= 2 && n / toks.length >= 0.3;
}

function mergeChordLine(chordLine, lyric) {
  const chords = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(chordLine))) chords.push({ pos: m.index, chord: m[0] });
  let res = lyric;
  if (res.length < chordLine.length) res = res.padEnd(chords[chords.length - 1].pos, ' ');
  for (let k = chords.length - 1; k >= 0; k--) {
    let { pos, chord } = chords[k];
    // chord sitting on the gap right before a word belongs to that word
    if (res[pos] === ' ' && res[pos + 1] && res[pos + 1] !== ' ') pos++;
    res = res.slice(0, pos) + `[${chord}]` + res.slice(pos);
  }
  return res.replace(/\s+$/, '');
}

/** Does the text look like it uses chords-above-lyrics notation? */
export function hasChordsOverLyrics(text) {
  return chordsOverLyricsToInline(text) !== text.replace(/\r\n?/g, '\n');
}

// ------------------------------------------------------------ serialize

/** Split a song file into header fields and the remaining body text. */
export function splitHeader(text) {
  const { meta, tags } = parse(text);
  const body = text.replace(/\r\n?/g, '\n').split('\n').filter(l => {
    const d = l.trim().match(/^\{\s*([\w-]+)\s*(?::.*)?\}$/);
    if (!d) return true;
    return !['t', 'title', 'artist', 'key', 'tag', 'tags', 'st', 'subtitle'].includes(d[1].toLowerCase());
  }).join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return { title: meta.title || '', artist: meta.artist || meta.subtitle || '', key: meta.key || '', tags, body };
}

export function buildSong({ title, artist, key, tags, body }) {
  const head = [`{title: ${title.trim()}}`];
  if (artist && artist.trim()) head.push(`{artist: ${artist.trim()}}`);
  if (key && key.trim()) head.push(`{key: ${key.trim()}}`);
  for (const t of tags) head.push(`{tag: ${t}}`);
  return head.join('\n') + '\n\n' + body.replace(/\s+$/, '') + '\n';
}

export function slugify(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'song';
}
