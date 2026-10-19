# FFK War Desk

A single-organizer Free Fire match desk. No API keys or paid OCR service required.

## FFK Prasanth appearance

The four existing pages share `public/brand.css` and the presentation layer in `public/brand.js`: channel artwork, condensed italic headings, pill actions, four-column desktop roster cards, connected intake steps and a standings leader hero. Narrow screens use bottom navigation; the top account menu retains Sign out. Existing handlers, storage, calculations, uploads, review controls and export formats remain in place.

The primary action is the only filled red button on each page. Watch live is outlined to avoid a second filled primary action. Overview uses a sidebar monogram so the mascot appears only in its hero; other desktop pages use the channel avatar. The Discord icon has no invented invite destination. Artwork provenance is recorded in `public/assets/BRAND-SOURCES.md`.

Scoreboard exports keep the same seven columns, label options, highlight selector, calculations and 2364×1194 PNG dimensions, with a dark branded appearance and channel footer. PDF export uses the same rendered graphic.

## Run

Requires Python 3.10 or newer. From this folder run `python server.py`, then open http://localhost:8080. On first use, create the organizer password (at least 10 characters). Devices on the same network can visit `http://YOUR-COMPUTER-IP:8080` if the firewall allows it. The computer must stay on.

Results, roster, and password hash are stored in `war.sqlite3`. Back up this file while the server is stopped. Screenshots are processed in the browser and, for unfamiliar layouts, compared by the optional local server OCR engine in memory. Screenshot files are not stored on the server. OCR code and English recognition models download from public CDNs and require internet on first use. Decorative Unicode names remain difficult for English OCR; roster matching suggests identities and unresolved fields require review.

## Workflow

The compact workspace guides each match through Upload → Check results → Save & export. Drag screenshots into the upload area or choose files. Review starts with unconfirmed teams and places incomplete results first; **Confirm complete teams** clears reviewed teams from the queue. Screenshot crops sit beside player and kill controls, and source settings collapse once review starts. Use **All teams** to revisit confirmed results.

Team roster search includes player names. Review includes a team filter, and saved matches can be filtered by name or map. Success notices dismiss automatically; errors remain visible until dismissed. Both use the current monochrome brand styling.

Draft values and available evidence crops save automatically in this browser. After refreshing or signing in again, choose **Resume match** on the dashboard. Full source images must be reselected to rerun OCR or adjust panels; resumed crops remain available for review. If browser storage is full, text values are saved without crops when possible; if storage is unavailable, the draft warns you to keep the tab open. Drafts and learned OCR examples belong to this browser and site address.

The workspace refreshes data when you return to the tab or change sections. Use **Up to date ↻** for a manual refresh. Before a whole-workspace save, a freshness check rejects changes when newer server data is detected, preserving the local draft. Continue using one active organizer editor; this preflight check is not an atomic multi-editor collaboration protocol.

1. Add at least twelve teams with four players and optionally a substitute.
2. Add a match, choose the map, and upload overlapping original screenshots in the supplied 1392×790 layout (proportional resolution changes supported).
3. Read screenshots, inspect sources, select active registered players, correct missing values, and confirm every team.
4. Save the verified match. Team standings and per-match player kill leaderboard are available.
5. Apply signed point adjustments with a reason. Export CSV or print/save PDF.
6. In Match results, choose **Scoreboard graphic** to preview and download the FFK Prasanth branded PNG. Event date, week, match label, and highlighted rank count are editable. The table is rendered from saved match data on the black, red and gold channel export design. Columns match the reference: POS, TEAM NAME, MATCH, PLACE (placement points), FINISH (kills), TOTAL (including adjustments), WINS. Export size: 2364 × 1194.

Scoring: placement points `[12,9,8,7,6,5,4,3,2,1,0,0]` plus one point per kill plus host adjustments. Ranking: total, kills, Booyah, placement points. No automatic penalties are inferred from screenshots. Exact output artwork/template remains to be chosen with the host.

Unmatched player names become match-only substitutes after the team is identified. Their kills contribute normally to team points, player kill leaderboards, and exports. Substitute names are editable during review; they do not alter the registered roster. Unknown teams and unreadable kill counts still require review.

## Current limits

Match results also includes **Kill graph** and **Position graph** tabs. Kill graph compares team eliminations for the selected match or all saved matches in the overall view. Position graph shows actual finishing positions for a single match; in the overall view, choose a team to see its finishing position across saved matches, with #1 at the top and gaps for matches it did not play. Average finish excludes missing appearances. Hover or focus plotted marks for exact values, and expand graph data for an accessible table. Graph CSV exports the plotted data; Print/save PDF prints the selected graph. Scores and source match records remain unchanged.

**Overall points table** is available in the Match results dropdown whenever at least one match is saved. It recomputes totals across all currently saved matches through the latest saved match, grouping by team ID. Columns include matches played, wins, kills, placement points, signed host adjustments and total points. Ranking uses total points, kills, wins, then placement points; identical values share a rank. Teams that have not played are omitted. The player leaderboard also sums saved appearances by player ID; match-only substitute IDs remain separate. A read-only match breakdown shows each team's contributions; apply adjustments or delete results from the individual match view.

Overall CSV includes all participating teams. The restored artwork-based graphic holds twelve rows, so an overall graphic shows the top twelve with an explicit note if more teams participated. Overall Print/save PDF uses browser printing for more than twelve teams so the full table is retained. For up to twelve teams it uses the existing scoreboard export. In an overall graphic, MATCH is each team's match count and WINS is cumulative wins. Overall totals are derived and do not create or modify saved matches.

To remove a saved match, open **Match results**, select the match, then choose **Delete match** and confirm. The selected match and its results are removed permanently; registered teams and other matches are preserved.

OCR extraction is tailored to the provided screenshot layout. It isolates yellow kill digits, enhances name crops, uses fixed-font numeral exemplars from the host's reference screenshot, and matches four players jointly to registered rosters. Overlapping frames fill missing fields; conflicting counts remain unresolved. Numeral exemplars now cover 0–9, 11 and 13; other values depend on multiple OCR readings. These checks reduce errors but do not establish a general accuracy guarantee. More independent matches are needed before relying on it in live events. Complete rows can be confirmed in one action; incomplete or conflicting rows still require correction. The current app is runnable locally and on the LAN; it has not been deployed publicly. Public hosting requires an HTTPS reverse proxy and a persistent Python host; the built-in server is for local/LAN use. Use one active editor at a time (whole-state saves). Login sessions last twelve hours and end on server restart.

## Adaptive screenshot layouts

The reader detects four repeated yellow kill columns and pairs player rows at the screenshot's original aspect ratio. The original reference layout retains its validated extraction path. Other detected layouts use panel-relative crops and an optional RapidOCR/ONNX CPU comparison engine. Engine disagreements remain unresolved. Partial rows and missing teams are not filled with invented results.

The comparison runtime is installed in `.ocr-runtime/` for this workspace. To install it in another checkout, run `python -m pip install --target .ocr-runtime rapidocr==3.10.0 onnxruntime==1.31.0`, then restart the server. No external OCR API or credentials are required. The engine's initial model files may download if they are not already bundled/cached. Browser-only recognition remains available if the local comparison engine is unavailable.

Use **Adjust panels** below a source thumbnail to drag two result-area bounds and rerun extraction. This restricts detection to those areas. It does not restore pixels missing from a cropped screenshot. Re-upload another screenshot to cover cut-off teams.

Validation on the host-supplied wider screenshot: all 38 visible kill fields matched manual transcription; 2 blank player fields remained unresolved; cut-off placement 11 and absent placement 12 were omitted. The earlier supplied pair still produced 47 correct kill counts and 1 unresolved count. These are sample-specific checks, not an accuracy guarantee for future matches.

## Additional OCR examples

The ten October 18 screenshots are labeled and preserved in ocr-data/. Three matches add 240 digit templates; two separate matches are held out. Correct kill-count coverage on the held-out frames improved from 121/160 (75.6%) to 153/160 (95.6%), with seven unresolved fields and zero incorrect accepted readings. This measures complete detected panels using Tesseract without roster matching or RapidOCR comparison; names and partial rows are not scored. See [dataset details](ocr-data/README.md) for limits and reproducible evaluation. This updates numeral exemplars rather than fine-tuning the underlying OCR engines.

## Original-resolution OCR and reviewed corrections

Panel detection still uses a consistent working size. Names are read from original-resolution crops when the uploaded screenshot is larger. Unresolved adaptive-layout kill counts get an additional original-resolution reading; it requires agreement from at least two sufficiently confident recognition passes and cannot override conflicting normalized evidence. The established digit-template path is retained.

On the same two held-out matches, this recovered two more fields: 155/160 correct (96.9%), five unresolved, zero incorrect accepted readings. `ocr-data/original-resolution.json` records the result. This benchmark does not measure name accuracy or the optional RapidOCR comparison.

When you edit a kill count, confirm the team result and successfully save the verified match, a small digit crop and its corrected label are stored in this browser. Unchanged readings, unconfirmed rows, failed match saves and discarded drafts do not create examples. Full screenshots remain temporary. Up to 500 reviewed examples are retained; only labels supported by corrections in at least two different saved matches contribute additional templates on later scans. This does not retrain the underlying OCR engines or learn player-name spellings.

Use **Export reviewed OCR examples** in match review to download the labeled crops for backup or future training. Examples belong to the current browser and site address; clearing site data removes them, and other devices do not receive them. Saving a verified match still succeeds if local example storage is unavailable. `node tools/check-ocr-learning.cjs` checks browser persistence, crop capture and match-save failure behavior using an isolated browser profile (Edge by default; override with `OCR_BROWSER_CHANNEL`).



## Default team roster

The two supplied Season 11 War List posters provide 24 editable default teams. Each team shows its original list and slot. Defaults are applied once per database; later edits, additions, and removals persist. Existing team/player identities and match history are preserved, and unrelated custom teams are kept. The roster image import has been removed; use Add team or Edit roster for changes. A database backup was taken before updating the current roster.

## Host desk and broadcast view

Open **Host desk** in the organizer sidebar to copy read-only host and broadcast links. Host links are stored as a secret fragment in the URL; the page sends the key in a request header. The host key cannot authorize organizer APIs. Reset host links to revoke both old links. Localhost links work on the server computer; use its LAN address for another device. The server must stay running.

The host desk refreshes saved results every 10 seconds. Hold updates freezes the current figures for commentary, then Resume updates fetches the latest results. The broadcast link hides caster notes and organizer controls and fits 12 teams at 1920×1080. Additional teams are available via page buttons. OBS Browser Sources use the broadcast URL at 1920×1080.

Caster figures reuse the existing overall scoring and tie rules. Gap means points behind the leader; Move compares current overall rank with the standings excluding the last saved match. New entrants display NEW. Per-match averages use only a team's appearances; win rate is wins divided by appearances. Form shows the latest three appearances. Rising-form commentary needs six appearances and compares the last three against the previous three. Player kills include substitutes; equal kill totals are reported as ties. Deaths, damage and assists are not recorded, so the desk does not invent K/D, damage or assist figures. Failed refreshes retain the last successful data and display an update warning.

Core broadcast metrics align with the categories used in [Garena's esports statistics](https://esports.ff.garena.co.id/statistik); this app retains its own configured scoring rules.
