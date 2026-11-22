// One-off migration of the old SongBook export (data/SongBook/**/*.pro) into songs/*.pro
// Usage: node tools/migrate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chordsOverLyricsToInline, buildSong, splitHeader, slugify } from '../chordpro.js';

const SRC = 'data/SongBook';
const OUT = 'songs';

// source file -> [title, artist, tags]   (null = drop)
const T = 'Traditional';
const MAP = {
  'ace of spades.pro': ['Ace of Spades', 'Motörhead', 'metal, rock, 80er'],
  'Alle die mit uns auf Kaperfahrt fahren.pro': ['Alle, die mit uns auf Kaperfahrt fahren', 'Volkslied', 'deutsch, seemannslied, lagerfeuer'],
  'Banjo/01 - Songs.pro': ['Banjo-Repertoire', '', 'banjo, notizen'],
  'Banjo/All Along The Watchtower.pro': ['All Along the Watchtower', 'Bob Dylan', 'rock, folk, 60er, banjo'],
  'Banjo/Boatman Dance.pro': ['Boatman Dance', T, 'old-time, traditional, banjo'],
  'Banjo/Cluck old hen.pro': ['Cluck Old Hen', T, 'old-time, traditional, banjo'],
  'Banjo/Country Roads.pro': ['Take Me Home, Country Roads', 'John Denver', 'country, folk, 70er, banjo, lagerfeuer'],
  'Banjo/Crying Shame.pro': ['Crying Shame', '', 'folk, banjo'],
  'Banjo/Darling Cora.pro': ['Darling Cora', T, 'old-time, traditional, banjo'],
  'Banjo/Death and the Lady.pro': ['Death and the Lady', T, 'folk, traditional, banjo'],
  'Banjo/Drunkard_s lone child.pro': ["Drunkard's Lone Child", T, 'old-time, traditional, banjo'],
  'Banjo/East Virginia.pro': ['East Virginia Blues', T, 'old-time, traditional, banjo'],
  'Banjo/Hills of Mexico.pro': ['Hills of Mexico', T, 'old-time, traditional, cowboy, banjo'],
  'Banjo/I built a house.pro': ['Build a House', 'Rhiannon Giddens', 'folk, 2010er, banjo'],
  'Banjo/In Hell I.pro': ["In Hell I'll Be in Good Company", 'The Dead South', 'bluegrass, 2010er, banjo'],
  'Banjo/In the pines.pro': ['In the Pines', T, 'folk, traditional, murder-ballad, banjo'],
  'Banjo/Julie.pro': ['Julie', 'Rhiannon Giddens', 'folk, 2010er, banjo'],
  'Banjo/Little Birdie.pro': ['Little Birdie', T, 'old-time, traditional, banjo'],
  'Banjo/Little Sadie.pro': ['Little Sadie', T, 'old-time, traditional, murder-ballad, banjo'],
  'Banjo/MINNIE THE MOOCHER – CAB CALLOWAY  THE.pro': ['Minnie the Moocher', 'Cab Calloway', 'jazz, swing, 30er, banjo'],
  'Banjo/Oh Death 2.pro': ['O Death (Version 2)', T, 'old-time, traditional, banjo'],
  'Banjo/Oh Molly Dear.pro': ['Oh Molly Dear', 'B. F. Shelton', 'old-time, 20er, banjo'],
  'Banjo/Old Jimmy Sutton.pro': ['Old Jimmy Sutton', T, 'old-time, traditional, banjo'],
  'Banjo/Old tar river.pro': ['Old Tar River', T, 'old-time, traditional, banjo'],
  'Banjo/Rain Dogs.pro': ['Rain Dogs', 'Tom Waits', 'tom-waits, 80er, banjo'],
  'Banjo/Red Rocking Chair.pro': ['Red Rocking Chair', T, 'old-time, traditional, banjo'],
  'Banjo/Ruby.pro': ['Ruby, Are You Mad', T, 'bluegrass, traditional, banjo'],
  'Banjo/Rye Whiskey.pro': ['Rye Whiskey', T, 'old-time, traditional, banjo'],
  'Banjo/Same Old Man.pro': ['Same Old Man', T, 'old-time, traditional, banjo'],
  'Banjo/Shady Grove.pro': ['Shady Grove', T, 'old-time, traditional, banjo'],
  'Banjo/Southern Texas.pro': ['Southern Texas', T, 'old-time, traditional, cowboy, banjo'],
  'Banjo/southern Texas1.pro': ['Southern Texas (Version 2)', T, 'old-time, traditional, cowboy, banjo'],
  'Banjo/St. James Infirmary.pro': ['St. James Infirmary', T, 'blues, jazz, traditional, banjo'],
  'Banjo/Strawfoot - David Eugene Edwards.pro': ['Strawfoot', '16 Horsepower', 'alt-country, 90er, banjo'],
  'Banjo/Summertime.pro': ['Summertime (Banjo)', 'George Gershwin', 'jazz, 30er, banjo'],
  'Banjo/The Blackest Crow.pro': ['The Blackest Crow', T, 'old-time, traditional, banjo'],
  'Banjo/The Blackest Crow0.pro': null, // identical duplicate
  'Banjo/The Blacksmith.pro': ['The Blacksmith', T, 'folk, traditional, banjo'],
  'Banjo/The Coocoo Bird.pro': ['The Coo Coo Bird', T, 'old-time, traditional, banjo'],
  'Banjo/Undone in sorrow.pro': ['Undone in Sorrow', 'Crooked Still', 'bluegrass, 2000er, banjo'],
  'Banjo/Wayfaring Stranger.pro': ['Wayfaring Stranger', T, 'folk, gospel, traditional, banjo'],
  'Banjo/Wild Rose.pro': ['Where the Wild Roses Grow (Banjo)', 'Nick Cave & Kylie Minogue', 'murder-ballad, 90er, banjo'],
  'Banjo/Yesterday_s  Here.pro': ['Yesterday Is Here', 'Tom Waits', 'tom-waits, 80er, banjo'],
  'Chocolate Jesus.pro': ['Chocolate Jesus', 'Tom Waits', 'tom-waits, blues, 90er'],
  'David Bowie - Five Years.pro': ['Five Years', 'David Bowie', 'rock, 70er'],
  'Freedom.pro': ['Freedom (Motherless Child)', 'Richie Havens', 'folk, 60er'],
  'From the David Bowie Collection song.pro': ["Let's Dance", 'David Bowie', 'pop, 80er'],
  'Greensleeves.pro': null, // sample song of the old app
  'Heroes chords.pro': ['Heroes', 'David Bowie', 'rock, 70er'],
  'I WILL SURVIVE.pro': ['I Will Survive', 'Gloria Gaynor', 'disco, 70er'],
  'In the Animals_ recording the organ.pro': ['House of the Rising Sun', 'The Animals', 'rock, folk, 60er, lagerfeuer'],
  'In the pines 2.pro': ['Where Did You Sleep Last Night', 'Nirvana (Lead Belly)', 'grunge, folk, 90er'],
  'Knockin_ on heaven_s door.pro': ["Knockin' on Heaven's Door", 'Bob Dylan', 'rock, folk, 70er, lagerfeuer'],
  'Little Maggy.pro': ['Little Maggie', T, 'bluegrass, traditional'],
  'Neil Young - Heart Of Gold.pro': ['Heart of Gold', 'Neil Young', 'folk, 70er, lagerfeuer'],
  'Oh Death.pro': ['O Death', T, 'old-time, traditional'],
  'Red Right Hand.pro': ['Red Right Hand', 'Nick Cave & the Bad Seeds', 'rock, 90er'],
  'Somewhere over the rainbow.pro': ['Somewhere Over the Rainbow', 'Israel Kamakawiwoʻole', 'pop, 90er, lagerfeuer'],
  'Songs/Clap Hands.pro': ['Clap Hands', 'Tom Waits', 'tom-waits, 80er'],
  'Songs/Flowers Grave.pro': ["Flower's Grave", 'Tom Waits', 'tom-waits, 2000er'],
  'Songs/Fove Foot Two.pro': ['Five Foot Two, Eyes of Blue', 'Ray Henderson', 'jazz, swing, 20er'],
  'Songs/Gun Street Girl.pro': ['Gun Street Girl', 'Tom Waits', 'tom-waits, 80er'],
  'Songs/Hurt.pro': ['Hurt', 'Nine Inch Nails / Johnny Cash', 'rock, 90er'],
  'Songs/Light My Fire.pro': ['Light My Fire', 'The Doors', 'rock, 60er'],
  'Songs/Little Wing.pro': ['Little Wing', 'Jimi Hendrix', 'rock, 60er'],
  'Songs/My Way.pro': ['My Way', 'Frank Sinatra', 'pop, 60er'],
  'Songs/Passenger.pro': ['The Passenger', 'Iggy Pop', 'punk, rock, 70er'],
  'Songs/Riders On The Storm.pro': ['Riders on the Storm', 'The Doors', 'rock, 70er'],
  'Songs/Rockin_ in the free world.pro': ["Rockin' in the Free World", 'Neil Young', 'rock, 80er'],
  'Songs/Spellbound.pro': ['Spellbound', 'Siouxsie and the Banshees', 'post-punk, 80er'],
  'Songs/Tango Till They_re Sore.pro': ["Tango Till They're Sore", 'Tom Waits', 'tom-waits, 80er'],
  'Songs/Way Down In The Hole.pro': ['Way Down in the Hole', 'Tom Waits', 'tom-waits, 80er'],
  'Songs/Whish you were here.pro': ['Wish You Were Here', 'Pink Floyd', 'rock, 70er, lagerfeuer'],
  'Songs/_Time_, from the CD _Rain Dogs_.pro': ['Time', 'Tom Waits', 'tom-waits, 80er'],
  'Summertime.pro': ['Summertime', 'George Gershwin', 'jazz, 30er'],
  'Superheroes.pro': ['Super Heroes', 'The Rocky Horror Show', 'musical, 70er'],
  'This is my fav, spent a lot of time.pro': ['Ziggy Stardust', 'David Bowie', 'rock, 70er'],
  'Tom Waits - Tom Traubert_s Blues.pro': ["Tom Traubert's Blues", 'Tom Waits', 'tom-waits, 70er'],
  'Wandering.pro': ['Wandering', '', 'folk'],
  'Waterbound.pro': ['Waterbound', T, 'old-time, traditional'],
  'WHERE THE WILD ROSES GROW.pro': ['Where the Wild Roses Grow', 'Nick Cave & Kylie Minogue', 'murder-ballad, 90er'],
  'While my Guitar.pro': ['While My Guitar Gently Weeps', 'The Beatles', 'rock, 60er'],
  'Wild Horses.pro': ['Wild Horses', 'The Rolling Stones', 'rock, 70er'],
  'Wir lagen vor Madagaskar.pro': ['Wir lagen vor Madagaskar', 'Volkslied', 'deutsch, seemannslied, lagerfeuer'],
  '[Intro].pro': ['Crazy Little Thing Called Love', 'Queen', 'rock, 70er'],
  '[Intro]1.pro': ['Under the Bridge', 'Red Hot Chili Peppers', 'rock, 90er'],
  '[Verse 1].pro': ['The Weight', 'The Band', 'rock, folk, 60er'],
};

// Web-scrape leftovers that are not part of the songs
const JUNK = [
  /^Jay-Z sells half of Ace of Spades/,
  /ALBUM REVIEW$/,
  /^How to play A Major chord$/,
  /^\{zoom/,
  /^\{subtitle:\s*\}$/,
  /^\{st:/,
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
}

fs.mkdirSync(OUT, { recursive: true });
const files = walk(SRC).filter(f => f.endsWith('.pro'));
const used = new Set();
const index = [];
let converted = 0;

for (const f of files) {
  const rel = path.relative(SRC, f).split(path.sep).join('/');
  if (!(rel in MAP)) { console.warn('UNMAPPED', rel); continue; }
  const m = MAP[rel];
  if (!m) { console.log('drop', rel); continue; }
  const [title, artist, tagStr] = m;

  let text = fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  text = text.split('\n').filter(l => !JUNK.some(re => re.test(l.trim()))).join('\n');
  const h = splitHeader(text);
  let body = h.body.split('\n').map(l => l.replace(/\s+$/, '')).join('\n');
  const inl = chordsOverLyricsToInline(body);
  if (inl !== body) converted++;
  body = inl.replace(/\n{3,}/g, '\n\n');

  const tags = tagStr.split(',').map(s => s.trim()).filter(Boolean);
  const out = buildSong({ title, artist, key: h.key === 'V' ? '' : h.key, tags, body });

  let slug = slugify(artist && artist !== T && artist !== 'Volkslied' ? `${artist.split(/[/(&]/)[0]} ${title}` : title);
  while (used.has(slug)) slug += '-2';
  used.add(slug);
  fs.writeFileSync(path.join(OUT, slug + '.pro'), out);
  index.push(`${slug}.pro`);
}

// index.json is only used for local development (python -m http.server)
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index.sort(), null, 1));
console.log(`${index.length} songs written, ${converted} with chords-over-lyrics converted`);
