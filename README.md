# FFK War Desk

A single-organizer Free Fire match desk. No API keys or paid OCR service required.

## FFK Prasanth appearance

The four existing pages share `public/brand.css` and the presentation layer in `public/brand.js`: channel artwork, condensed italic headings, pill actions, four-column desktop roster cards, connected intake steps and a standings leader hero. Narrow screens use bottom navigation; the top account menu retains Sign out. Existing handlers, storage, calculations, uploads, review controls and export formats remain in place.

The primary action is the only filled red button on each page. Watch live is outlined to avoid a second filled primary action. Overview uses a sidebar monogram so the mascot appears only in its hero; other desktop pages use the channel avatar. The Discord icon has no invented invite destination. Artwork provenance is recorded in `public/assets/BRAND-SOURCES.md`.

Scoreboard exports keep the same seven columns, label options, highlight selector, calculations and 2364×1194 PNG dimensions, with a dark branded appearance and channel footer. PDF export uses the same rendered graphic.

## Run

**Quickest start.** Install Python 3.10+, then in this folder run `./start.sh` (macOS/Linux) or double-click `start.bat` (Windows). The script creates a private virtual environment, installs the screenshot reader on first run and starts the desk. Open http://localhost:8080 and create the organizer password (at least 10 characters). The terminal also prints an address such as `http://192.168.1.20:8080` for phones and other devices on the same network.

Manual start: `pip install -r requirements-docker.txt && python server.py`. Without that install the desk still works and falls back to the slower in-browser reader.

**Docker.** `docker compose up -d` builds the same image used for hosting and keeps data in a named volume. `/health` is the health check.

**Public hosting.** Render (`render.yaml`, needs a paid instance for the persistent disk) and Fly.io (`fly.toml`) configs are included. Both run the SQLite server with a persistent disk. When the desk sits behind a proxy or a public URL, first-run setup requires a `SETUP_TOKEN` environment variable that you type into the "Setup token" field, so a stranger who finds the URL first cannot claim the desk. Set it before you deploy. `vercel.json` plus `api/index.py` is the PostgreSQL (Neon) alternative; it has the same login and request-size protections but no server-side screenshot reader, so the browser reader is used there.

Results, roster, and password hash are stored in `war.sqlite3` (or the `DB_PATH` you set). Back this file up while the server is stopped. Screenshot files are never stored on the server.

**Checks.** `node tools/run-checks.cjs` runs all logic and Python checks; `CHECK_BROWSER=1` adds the real-browser journeys (needs `npm install`). The OCR accuracy gate skips itself if the screenshot reader is not installed.

### Security behaviour

Requests larger than 2 MB (14 MB for a screenshot) are rejected before they are read. After repeated wrong passwords an address is locked out for a while. The session cookie is `HttpOnly`, `SameSite=Strict` and gets `Secure` automatically on HTTPS. Host links use a separate read-only key that cannot call organizer APIs.

## FFK War tournament

**Reset the war** appears at the top of War manager. After confirmation, it clears saved BR results, tournament settings/set membership, qualifiers, CS scores/history and the local unfinished draft. Registered teams, players, learned OCR corrections and organizer access are retained. Canceling or a failed save leaves the current war and draft intact.

The default roster also includes **FFK VINI** with FFK VINI, FFK BALA, FFK HAKAI and FFK PADHU. Existing VINI teams retain their IDs and player order; bare requested names gain the FFK prefix. The incremental default is applied once without resetting saved matches or tournament assignments. On a fresh install this extra roster stays outside the original two poster lists until selected for a war.

RAM's decorated short name (for example, `FFK TT Ram0?`) can now match the registered RAM player. Selecting a known team allows confident individual names to match even when the rest are unreadable. Unknown names still require review; player identities are not filled by elimination. Explicit player corrections from confirmed, successfully saved matches become exact OCR name aliases scoped to that team's player. Aliases survive roster edits, and failed saves roll them back. **Review tools → Match players** retries existing automatic substitutes while preserving manual player choices.

The organizer experience follows a guided flow: Home recommends the next step, the organizer chooses Set A or B and uploads screenshots, and War manager shows one stage at a time. The 12 teams in the first verified, saved points table define that set automatically. Match settings and correction tools sit inside disclosures. Qualification has a review screen, and CS scores open in a focused dialog instead of appearing as permanent empty fields.

Team registration separates the team name from its four starting players and keeps the substitute optional. Match checking presents one team at a time with placement shortcuts, previous/next navigation, and automatic advancement after confirmation. Existing handlers, draft recovery, scoring and exports remain in use. The standalone browser checks in `tools/check-comfort-browser.cjs` and `tools/check-comfort-forms.cjs` use temporary, invented workspaces and never open the real SQLite database.

Open **War manager**, select **Set A** or **Set B**, then add screenshots. Verify the 12 teams and save the points table: those teams become the selected set, without pre-allocation. Later results must use the same 12 teams, and teams cannot participate in both opening sets. Existing allocation suggestions without saved stage results are replaced by the first verified result. Each BR set has a planned match count of six by default. An earlier saved match can also define a set from the saved-match tools. Practice/unassigned matches do not count toward qualification.

After all planned matches are saved, confirm the top six from A and B. These twelve populate the semi-final, Set C, which starts at zero points. Confirm its top four to create CS playoffs: Qualifier 1 is rank 1 vs 2 (winner straight to the Grand Final); the Eliminator is rank 3 vs 4 (loser eliminated). Qualifier 1’s loser plays the Eliminator winner in Qualifier 2. Its winner faces the Qualifier 1 winner in the Grand Final. Record CS round or series scores directly in War manager using your event rules. CS scores are separate from BR points and exports.

Ranking uses points, kills, wins, then placement points. Ties across the qualification cutoff require selecting the advancing tied teams and recording a host reason. Equal records within the qualifying places retain the displayed team-name order for CS seeding. Confirmed sets lock their BR results. Reopening clears dependent qualifications and all CS results, while retaining BR matches for correction. A score correction that changes a winner requires clearing that fixture and its dependent results; same-winner score corrections retain later results. Scores from the previous knockout format are archived under previous finals history and do not advance teams in the new bracket. Existing overall tables and host broadcasts still show totals across all saved BR matches; use War manager for stage-specific standings. Tournament settings and CS results persist with the existing SQLite workspace.

## Workflow

The compact workspace guides each match through Upload → Check results → Save & export. Drag screenshots into the upload area or choose files. Review starts with unconfirmed teams and places incomplete results first; **Confirm complete teams** clears reviewed teams from the queue. Screenshot crops sit beside player and kill controls, and source settings collapse once review starts. Use **All teams** to revisit confirmed results.

Team roster search includes player names. Review includes a team filter, and saved matches can be filtered by name or map. Success notices dismiss automatically; errors remain visible until dismissed. Both use the current monochrome brand styling.

Draft values and available evidence crops save automatically in this browser. After refreshing or signing in again, choose **Resume match** on the dashboard. Full source images must be reselected to rerun OCR or adjust panels; resumed crops remain available for review. If browser storage is full, text values are saved without crops when possible; if storage is unavailable, the draft warns you to keep the tab open. Drafts and learned OCR examples belong to this browser and site address.

The workspace refreshes data when you return to the tab or change sections. Use **Up to date ↻** for a manual refresh. Before a whole-workspace save, a freshness check rejects changes when newer server data is detected, preserving the local draft. Continue using one active organizer editor; this preflight check is not an atomic multi-editor collaboration protocol.

1. Add at least twelve teams with four players and optionally a substitute.
2. Add a match, choose the map, and upload overlapping original screenshots (any resolution; the reader measures the layout).
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

Use one active editor at a time (whole-state saves). Login sessions last twelve hours and end on server restart. Public hosting needs HTTPS (any of the supplied host configs provide it) and a persistent disk.

## Reading screenshots (OCR)

The desk reads the scoreboard with real text recognition and then reasons about what it read. There are no per-layout templates and no hard-coded pixel positions, so different resolutions and crops work.

1. **Recognition.** RapidOCR (PP-OCR ONNX models, bundled in the pip wheel, CPU only, no downloads, no API key) reads every word with its position. The image is read at a working size chosen from its text height, and results are merged across scales.
2. **Digit reading.** Each "N Eliminations" label is re-read from several differently prepared crops (scaled, contrast-stretched, colour-isolated). The crops vote, weighted by confidence. A number is accepted only when the votes agree strongly enough; otherwise the field is left empty with the alternatives listed, never guessed.
3. **Layout reasoning.** Cells are grouped into columns, rows and panels from their measured geometry. Placement comes from the printed rank numbers where they are readable and from the panel order where they are not; a cut-off panel at the edge of the screen is recognised as partial.
4. **Roster reasoning.** Names are compared with the registered players (decorative Unicode, look-alike letters, clan tags and leet digits are normalised). Every panel is scored against every registered team, then one global assignment gives each team to at most one panel, so a weak panel is settled by what the others already claimed. A team is only accepted with clear evidence over the runner-up.
5. **Cross-checks.** Duplicate or missing placements, unreadable fields, implausible kill totals and low-confidence names are listed for review, and the review screen puts those teams first. Several screenshots of one match are merged, and conflicting counts stay unresolved.

On the 10 labelled screenshots (5 matches, 2 frames each) the server reader gets 252/252 training and 166/166 held-out kill counts right with zero wrong readings accepted, and matches 22/22 teams to the right roster entry. Run `python tools/evaluate_ocr.py --verbose` to reproduce it, or `--stress` to see how it behaves on half-size and blurred copies (a couple of fields become unresolved rather than wrong). Reading takes about 5 to 6 seconds per screenshot on a laptop CPU.

Be careful with the claim: the sample is small and all from one screenshot style, so treat this as strong evidence for that style, not a guarantee for every phone and layout. Anything uncertain is flagged for review instead of being filled in, and corrections you confirm are remembered for the next scan.

Use **Adjust panels** below a source thumbnail to drag two result-area bounds and rerun extraction; this restricts reading to those areas. It cannot restore pixels missing from a cropped screenshot, so re-upload another frame to cover cut-off teams.

The browser reader (Tesseract) remains as a fallback when the server reader is not installed. The vendored Tesseract worker and WASM core still load from a public CDN, so the fallback needs internet on first use.

### Reviewed corrections

When you edit a kill count, confirm the team and successfully save the match, a small digit crop and its corrected label are stored in this browser. Unconfirmed rows, failed saves and discarded drafts create nothing. Up to 500 examples are kept; only labels supported by at least two different saved matches contribute templates. **Export reviewed OCR examples** downloads them for backup or future training. They belong to this browser and site address. `node tools/check-ocr-learning.cjs` checks persistence, crop capture and save-failure behaviour in an isolated profile.

Dataset details and the earlier browser-reader benchmark are in [ocr-data/README.md](ocr-data/README.md).

## Default team roster

The two supplied Season 11 War List posters provide 24 editable default teams. Each team shows its original list and slot. Defaults are applied once per database; later edits, additions, and removals persist. Existing team/player identities and match history are preserved, and unrelated custom teams are kept. The roster image import has been removed; use Add team or Edit roster for changes. A database backup was taken before updating the current roster.

## Host desk and broadcast view

Open **Host desk** in the organizer sidebar to copy read-only host and broadcast links. Host links are stored as a secret fragment in the URL; the page sends the key in a request header. The host key cannot authorize organizer APIs. Reset host links to revoke both old links. Localhost links work on the server computer; use its LAN address for another device. The server must stay running.

The host desk refreshes saved results every 10 seconds. Hold updates freezes the current figures for commentary, then Resume updates fetches the latest results. The broadcast link hides caster notes and organizer controls and fits 12 teams at 1920×1080. Additional teams are available via page buttons. OBS Browser Sources use the broadcast URL at 1920×1080.

Caster figures reuse the existing overall scoring and tie rules. Gap means points behind the leader; Move compares current overall rank with the standings excluding the last saved match. New entrants display NEW. Per-match averages use only a team's appearances; win rate is wins divided by appearances. Form shows the latest three appearances. Rising-form commentary needs six appearances and compares the last three against the previous three. Player kills include substitutes; equal kill totals are reported as ties. Deaths, damage and assists are not recorded, so the desk does not invent K/D, damage or assist figures. Failed refreshes retain the last successful data and display an update warning.

Core broadcast metrics align with the categories used in [Garena's esports statistics](https://esports.ff.garena.co.id/statistik); this app retains its own configured scoring rules.
