# Songbook

Eine schlichte Web-App für Songtexte mit Akkorden. Sie läuft im Browser am Handy, Tablet oder PC, ist als App installierbar und funktioniert offline.
Alles ist statisch: GitHub Pages liefert die App aus. Die Songs liegen als [ChordPro](https://www.chordpro.org)-Dateien in einem **separaten privaten Repository** (`wuneli/songbook-songs`, Ordner `songs/`). Die App liest und schreibt sie über die GitHub-API. Dieses Repo enthält also keine Songs.

## Bedienung

- **Liste:** Suche über Titel, Interpret, Tags und Liedtext. Tags filtern per Antippen, mehrere Tags werden UND-verknüpft.
- **Song:**
  - `Akk` blendet die Akkorde ein und aus.
  - Über das Regler-Symbol stellst du Schriftgröße, Transponieren (pro Song gespeichert), Autoscroll und Spalten ein.
  - Die Schriftgröße geht auch per Pinch.
  - Ein Tipp auf den Text blendet die Leiste aus.
  - Der Bildschirm bleibt an.
- **Neuer Song (+):** Text einfach von einer Akkord-Webseite einfügen. Akkorde über dem Text werden automatisch in Inline-Akkorde umgewandelt.
- **Tags:** Neue Tags legst du beim Bearbeiten an. Unter Einstellungen → Tags lassen sie sich für alle Songs umbenennen oder entfernen.

## Token (einmal pro Gerät)

Weil die Songs privat sind, braucht jedes Gerät einen GitHub-Token:
[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) → *Only select repositories*: `songbook-songs` → Permissions: **Contents: Read and write**.
Den Token trägst du in der App unter Einstellungen ein. Er bleibt nur im Browser dieses Geräts gespeichert.

Jede Änderung ist ein Commit. Die App zeigt sie sofort an, auf anderen Geräten erscheinen sie beim nächsten Öffnen.

## Songformat

```
{title: Hurt}
{artist: Johnny Cash}
{key: Am}
{tag: rock}
{tag: 90er}

[Verse 1]
I [Am]hurt myself to[C]day, to see if I still [D]feel

[Chorus]
{c: Capo 2}
```

Abschnitte stehen als eigene Zeile in `[eckigen Klammern]`, Kommentare in `{c: …}`.
Reine Akkordzeilen (`Am C D x2`) und Tabs sind erlaubt und werden mit den Akkorden ausgeblendet.

## Lokal entwickeln

```
git clone https://github.com/wuneli/songbook-songs songs   # Songs-Repo als Unterordner (ist in .gitignore)
python -m http.server 8765  # http://localhost:8765 lädt ohne Token die Songs aus songs/ (braucht songs/index.json)
```
`tools/migrate.mjs` war die einmalige Übernahme aus dem alten SongBook-Export (erzeugt auch `songs/index.json`).
