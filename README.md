# FFK War Desk

A single-organizer Free Fire match desk. No API keys or paid OCR service required.

## FFK Prasanth appearance

All organizer pages use one stylesheet, `public/app.css`, with one block of design tokens at the top. Each page is rendered once, in its final form, by one module: the shell and teams in `app.js`, the results check and intake in `workspace.js`, standings in `results.js`, War manager and Home in `comfort.js`, and exports in `export-ui.js`. Narrow screens use bottom navigation; the top account menu keeps Host desk and Sign out.

The primary action is the only filled red button on each page. Overview uses a sidebar monogram so the mascot appears only in its hero; other desktop pages use the channel avatar. Artwork provenance is recorded in `public/assets/BRAND-SOURCES.md`.

Nothing on screen is smaller than 12 px, and buttons in tables, tabs and the results check are at least 40 px tall.

Scoreboard exports keep the same seven columns, label options, highlight selector, calculations and 2364×1194 PNG dimensions, with a dark branded appearance and channel footer. PDF export uses the same rendered graphic.

## Run

**Quickest start.** Install Python 3.10+, then in this folder run `./start.sh` (macOS/Linux) or double-click `start.bat` (Windows). The script creates a private virtual environment, installs the screenshot reader on first run and starts the desk. Open http://localhost:8080 and create the organizer password (at least 10 characters). The terminal also prints an address such as `http://192.168.1.20:8080` for phones and other devices on the same network.

Manual start: `pip install -r requirements-docker.txt && python server.py`. Without that install the desk still works and falls back to the slower in-browser reader.

**Docker.** `docker compose up -d` builds the same image used for hosting and keeps data in a named volume. `/health` is the health check.

**Public hosting.** Render (`render.yaml`, needs a paid instance for the persistent disk) and Fly.io (`fly.toml`) configs are included. Both run the SQLite server with a persistent disk. When the desk sits behind a proxy or a public URL, first-run setup requires a `SETUP_TOKEN` environment variable that you type into the "Setup token" field, so a stranger who finds the URL first cannot claim the desk. Set it before you deploy. `vercel.json` plus `api/index.py` is the PostgreSQL (Neon) alternative; it has the same login and request-size protections but no server-side screenshot reader, so the browser reader is used there.

Results, roster, and password hash are stored in `war.sqlite3` (or the `DB_PATH` you set). Back this file up while the server is stopped. Screenshot files are never stored on the server.

**Checks.** `npm test` (or `node tools/run-checks.cjs`) runs all logic and Python checks; `npm run test:browser` (or `node tools/run-checks.cjs --browser`) adds the real-browser journeys, and works the same in Windows, macOS and Linux shells (needs `npm install`). `tools/check-audit-fixes.cjs` covers every fix from the October 2026 audit. The OCR accuracy gate skips itself if the screenshot reader is not installed, and the PostgreSQL parity check runs only when `DATABASE_URL` points at a throwaway database (CI provides one).

### Running it for real (production notes)

**Put HTTPS in front.** The built-in server speaks plain HTTP, which is fine on a home network but not on the internet. Render and Fly provide HTTPS for you. On your own machine or VPS, use the bundled Caddy setup, which gets and renews a certificate automatically:

`DOMAIN=desk.example.com SETUP_TOKEN=$(openssl rand -hex 16) docker compose -f docker-compose.yml -f docker-compose.https.yml up -d`

**Tell the app how many proxies are in front (`TRUST_PROXY`).** Lockouts and rate limits are per visitor address. Behind a proxy every visitor would otherwise look identical, but trusting forwarded headers blindly would let anyone dodge the lockout by sending fake ones. So forwarded headers are ignored unless you set `TRUST_PROXY=1` (one proxy, as on Render, Fly, Caddy and Vercel; the supplied configs already set it). Leave it unset when people connect directly.

**Backups.** A consistent copy of the database is written on start and then every `BACKUP_HOURS` hours (default 6; `0` turns it off) to a `backups/` folder next to the database (or `BACKUP_DIR`), keeping the newest `BACKUP_KEEP` (default 30). Each copy is integrity-checked before it replaces anything. Manual use:

- `python tools/backup.py` writes a backup now; `python tools/backup.py --list` lists them.
- `python tools/backup.py --restore backups/war-YYYYMMDD-HHMMSS.sqlite3` restores one. Stop the server first; the database it replaces is kept as `war.sqlite3.before-restore`.

These backups sit on the same disk as the database, so they protect against mistakes and corruption, not against losing the disk. Copy the `backups/` folder somewhere else regularly (or point `BACKUP_DIR` at a different volume). `/health` reports how old the newest backup is.

**Screenshot reading is one at a time.** The reader is heavy (about 400 MB and several seconds per screenshot) and runs in its own worker process. If someone else's screenshot is being read, the next one waits up to 25 s and the browser retries a few times with a message. A read that runs past 2 minutes is stopped for real: the worker process is ended, the queue is free again at once, and the next read starts a fresh worker. Both server reading routes share this queue. Adjust with `SCAN_WAIT_SECONDS` and `SCAN_TIMEOUT_SECONDS`; `SCAN_ISOLATE=0` runs the reader on a thread instead (a timed-out read then keeps the queue until it finishes). Images are checked against the size limit after they are scaled for reading, and long thin strips are refused.

**Saves are checked on the server.** A signed-in save is refused (with the reason) if it would add malformed teams or results, impossible kills or placements, a team outside its set, qualifiers that are not from their set, or Clash Squad results that do not follow the bracket. Problems already present in older data do not block saving; a save just cannot add a new one. The first organizer password is created atomically: if two people set it up at once, the second is told to sign in with the first password.

**Logs and health.** Logs go to standard output as one line per event (sign-ins, lockouts, scans with timing, errors with traces); `LOG_LEVEL` changes verbosity. `/health` checks the database and returns 503 if it cannot be read.

**Not covered.** This is still the standard-library Python server: it drops stalled connections after 30 s and caps simultaneous connections (`MAX_CONNECTIONS`, default 64), which suits one event, not heavy public traffic. Whole-workspace saves remain last-writer-wins, so use one organizer editor at a time. The Content-Security-Policy allows inline scripts because the pages build their buttons with inline handlers; everything else (framing, plugins, `<base>` and form hijacking, foreign scripts) is blocked. Set `CSP_REPORT_ONLY=1` to log violations instead of blocking if you suspect it is breaking something. The browser fallback reader loads its worker from a CDN and has not been verified under this policy.

### Security behaviour

Requests larger than 2 MB (14 MB for a screenshot) are rejected before they are read. After repeated wrong passwords an address is locked out for 10 minutes, and every address is limited to 240 requests a minute (12 screenshot reads). Sign-ins are stored in the database, so a restart no longer signs everyone out, and only a hash of each session token is stored. The session cookie is `HttpOnly`, `SameSite=Strict` and gets `Secure` automatically on HTTPS, and pages are served with HSTS (on HTTPS), `X-Frame-Options`, a referrer policy and a content security policy. Host links use a separate read-only key that cannot call organizer APIs.

### Works offline at the venue

Icons are built into the app (`public/icons.js`), so they show without internet. The text fonts still come from Google Fonts when online; without internet the desk uses the system font and nothing waits on the download. Only the browser fallback reader needs internet on first use.

## FFK War tournament

**Reset the war** sits in War manager under *Tools: teams, saved matches and reset*, away from everyday buttons. After confirmation, it clears saved BR results, tournament settings/set membership, qualifiers, CS scores/history and the local unfinished draft. Registered teams, players, learned OCR corrections and organizer access are retained. Canceling or a failed save leaves the current war and draft intact.

The default roster also includes **FFK VINI** with FFK VINI, FFK BALA, FFK HAKAI and FFK PADHU. Existing VINI teams retain their IDs and player order; bare requested names gain the FFK prefix. The incremental default is applied once without resetting saved matches or tournament assignments. On a fresh install this extra roster stays outside the original two poster lists until selected for a war.

RAM's decorated short name (for example, `FFK TT Ram0?`) can now match the registered RAM player. Selecting a known team allows confident individual names to match even when the rest are unreadable. Unknown names still require review; player identities are not filled by elimination. Explicit player corrections from confirmed, successfully saved matches become exact OCR name aliases scoped to that team's player. Aliases survive roster edits, and failed saves roll them back. **Review tools → Match players** retries existing automatic substitutes while preserving manual player choices.

The organizer experience follows a guided flow: Home recommends the next step, the organizer chooses Set A or B and uploads screenshots, and War manager shows one stage at a time. The 12 teams in the first verified, saved points table define that set automatically. Match settings and correction tools sit inside disclosures. Qualification has a review screen, and CS scores open in a focused dialog instead of appearing as permanent empty fields.

Team registration is one form: the team name, its four starting players and an optional substitute. When editing, fixing a player's spelling keeps that player (their ID, results and learned screenshot names stay together, and the old spelling keeps matching screenshots). If someone else has joined, choose **New person** for that slot: the new player gets their own record and earlier results stay with the previous player. The standalone browser checks use temporary, invented workspaces and never open the real SQLite database.

Open **War manager**, select **Set A** or **Set B**, then add screenshots. Verify the 12 teams and save the points table: those teams become the selected set, without pre-allocation. Later results must use the same 12 teams, and teams cannot participate in both opening sets. Existing allocation suggestions without saved stage results are replaced by the first verified result. Each BR set has a planned match count of six by default. An earlier saved match can also define a set from the saved-match tools. Practice/unassigned matches do not count toward qualification.

After all planned matches are saved, confirm the top six from A and B. These twelve populate the semi-final, Set C, which starts at zero points. Confirm its top four to create CS playoffs: Qualifier 1 is rank 1 vs 2 (winner straight to the Grand Final); the Eliminator is rank 3 vs 4 (loser eliminated). Qualifier 1’s loser plays the Eliminator winner in Qualifier 2. Its winner faces the Qualifier 1 winner in the Grand Final. Record CS round or series scores directly in War manager using your event rules. CS scores are separate from BR points and exports.

Ranking uses points, kills, wins, then placement points. Ties across the qualification cutoff require selecting the advancing tied teams and recording a host reason. Equal records within the qualifying places retain the displayed team-name order for CS seeding. Confirmed sets lock their BR results. Reopening clears dependent qualifications and all CS results, while retaining BR matches for correction. A score correction that changes a winner requires clearing that fixture and its dependent results; same-winner score corrections retain later results. Scores from the previous knockout format are archived under previous finals history and do not advance teams in the new bracket. The overall table shows totals across all saved BR matches, practice included, and says so; War manager shows stage-specific standings, and the host desk can follow the stage (see below). Tournament settings and CS results persist with the existing SQLite workspace.

## Workflow

The workspace guides each match through Upload → Check results → Save & export. Drag screenshots into the upload area or choose files, then press Read screenshots. Reading progress stays on the page: one line per screenshot, the time so far, and a Cancel button. Cancelling keeps any earlier unsaved results.

**Checking results** shows the 12 placements as compact rows. Every player shows the screenshot crop of their name and kill count right beside the dropdown and the number; select a crop to open the whole screenshot with that row outlined. The screenshots themselves sit above the check, each with **View** (full size, with zoom) and **Adjust panels**. Adjusting panels works without a mouse too: **Start with two boxes**, then arrow keys move the selected box and Shift + arrows resize it, or type exact positions.

The reader's own doubts stay on the row until you have looked: a placement it had to assume, a placement number that disagrees with the row order, a row cut off at the screen edge, a team matched to two panels, or an unusually high kill count (over 30). Those rows are never confirmed in bulk; confirm them one by one. A failed or cancelled re-read never touches the results you already checked. Each row says what it is: *Looks right* (green), *Check* (amber, with the reason, such as "1 kill count missing" or "1 substitute: make sure it is not a roster player"), or *Confirmed*. Status is shown with an icon and words, not only colour. Row totals (kills and points) update as you type.

- **Confirm N that look right** confirms every green row at once; **Undo** reverses that bulk action.
- Type a kill count straight in; <kbd>↑</kbd>/<kbd>↓</kbd> change it. <kbd>Enter</kbd> confirms the team and jumps to the next one that is not confirmed. **Next to check** jumps to the next amber row.
- Confirmed rows collapse to one line; **Change** reopens one, and **Undo** next to "Confirmed #N" reopens the one you just confirmed. **Hide confirmed** leaves only what still needs you.
- The numbered placement list shows every placement's state; select one to go there. **One team at a time** shows only the current placement (the default on phones, where the progress and placement list stay pinned at the top).
- When you enter results by hand, there is no screenshot column.
- **Save results** unlocks when all 12 are confirmed and says how many are left until then.

Teams are listed one row per team with the set they play in, their players, and visible Edit and Remove buttons. Registering a team is a single form: the name and four players, with an optional substitute. Team search includes player names. Review includes a team filter, and saved matches can be filtered by name or map. Success notices and warnings dismiss automatically; errors stay until dismissed and are announced to screen readers. Every dialog is announced by its title. If your sign-in ends while you work, a sign-in box appears in place; your page and unsaved draft are kept.

Draft values and available evidence crops save automatically in this browser. After refreshing or signing in again, choose **Resume match** on the dashboard. Full source images must be reselected to rerun OCR or adjust panels; resumed crops remain available for review. If browser storage is full, text values are saved without crops when possible; if storage is unavailable, the draft warns you to keep the tab open. Drafts and learned OCR examples belong to this browser and site address.

The workspace refreshes data when you return to the tab or change sections. Use **Up to date ↻** for a manual refresh. Before a whole-workspace save, a freshness check rejects changes when newer server data is detected, preserving the local draft. Continue using one active organizer editor; this preflight check is not an atomic multi-editor collaboration protocol.

1. Add at least twelve teams with four players and optionally a substitute.
2. Add a match, choose the map, and upload overlapping original screenshots (any resolution; the reader measures the layout).
3. Read screenshots, inspect sources, select active registered players, correct missing values, and confirm every team.
4. Save the verified match. Team standings and per-match player kill leaderboard are available.
5. In a saved match, **Details** on a team corrects player kills or the finish (finishes swap with the team that had that place), with a reason that is kept in the match's correction log; standings, the player leaderboard and graphs recalculate. Signed point adjustments with a reason are applied there too; a double click records one adjustment.
6. **Export** always exports the view on screen (teams, players, kill graph or position graph) as PNG, PDF or CSV, with every team or player. **Scoreboard artwork** is a separate option for team standings: the FFK Prasanth design (2364 × 1194, up to 12 rows, with a note when more teams played) or your own templates. Event date, week, match label and highlighted rank count are remembered for that match in this browser, whichever format you download. Columns match the reference: POS, TEAM NAME, MATCH, PLACE (placement points), FINISH (kills), TOTAL (including adjustments), WINS. Long team names are shortened with an ellipsis instead of running into the next column.
7. Custom templates: upload artwork, then drag on the preview to place the results table (drag the box to move it, its corner to resize, or use the arrow keys; exact percentages stay under *Exact position*). Templates can be deleted, and saved to or loaded from a template file to move them between browsers.

Scoring: placement points `[12,9,8,7,6,5,4,3,2,1,0,0]` plus one point per kill plus host adjustments. Ranking: total, kills, Booyah, placement points. No automatic penalties are inferred from screenshots. Exact output artwork/template remains to be chosen with the host.

Unmatched player names become match-only substitutes after the team is identified. Their kills contribute normally to team points, player kill leaderboards, and exports. Substitute names are editable during review; they do not alter the registered roster. Unknown teams and unreadable kill counts still require review.

## Current limits

Match results also includes **Kill graph** and **Position graph** tabs. Kill graph compares team eliminations for the selected match or all saved matches in the overall view. Position graph shows actual finishing positions for a single match; in the overall view, choose a team to see its finishing position across saved matches, with #1 at the top and gaps for matches it did not play. Average finish excludes missing appearances. Hover or focus plotted marks for exact values, and expand graph data for an accessible table. Graph exports (PNG, PDF and CSV) contain the plotted graph or its data. Scores and source match records remain unchanged.

**Overall points table** is available in the Match results dropdown whenever at least one match is saved. It recomputes totals across all currently saved matches through the latest saved match, grouping by team ID. Columns include matches played, wins, kills, placement points, signed host adjustments and total points. Ranking uses total points, kills, wins, then placement points; identical values share a rank. Teams that have not played are omitted. The player leaderboard also sums saved appearances by player ID; match-only substitute IDs remain separate. A read-only match breakdown shows each team's contributions; apply adjustments or delete results from the individual match view.

Overall exports of the Teams view (PNG, PDF, CSV) include every participating team. The artwork-based graphic holds twelve rows, so overall artwork shows the top twelve with an explicit note if more teams participated. In overall artwork, MATCH is each team's match count and WINS is cumulative wins. On the podium, teams with identical records share a rank and sit side by side. Overall totals are derived and do not create or modify saved matches. On a phone the standings show rank, team, kills and points; the other columns are in Details.

To remove a saved match, open **Match results**, select the match, then choose **Delete match** and confirm. The selected match and its results are removed permanently; registered teams and other matches are preserved.

Use one active editor at a time (whole-state saves; a freshness check catches most conflicts, but it is not an atomic multi-editor protocol). Login sessions last twelve hours and survive server restarts. Public hosting needs HTTPS (any of the supplied host configs provide it) and a persistent disk.

## Reading screenshots (OCR)

The desk reads the scoreboard with real text recognition and then reasons about what it read. There are no per-layout templates and no hard-coded pixel positions, so different resolutions and crops work.

1. **Recognition.** RapidOCR (PP-OCR ONNX models, bundled in the pip wheel, CPU only, no downloads, no API key) reads every word with its position. The image is read at a working size chosen from its text height, and results are merged across scales.
2. **Digit reading.** Each "N Eliminations" label is re-read from several differently prepared crops (scaled, contrast-stretched, colour-isolated). The crops vote, weighted by confidence. A number is accepted only when the votes agree strongly enough; otherwise the field is left empty with the alternatives listed, never guessed.
3. **Layout reasoning.** Cells are grouped into columns, rows and panels from their measured geometry. Placement comes from the printed rank numbers where they are readable and from the panel order where they are not; a cut-off panel at the edge of the screen is recognised as partial. When a printed number disagrees with the order of the rows, the order wins but the row is flagged for review instead of looking certain.
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

The host desk refreshes saved results every 10 seconds. **Hold updates** freezes the screen, including a refresh that was already on its way; newer results wait and appear on **Resume updates**. **Show** picks the stage: *Follow the tournament* (the default: the set of the latest tournament match, then the Clash Squad bracket once the final four are confirmed), *All saved matches* (practice and every set, labelled as such), Set A, Set B, Set C or CS finals. Each set starts from zero, as in War manager. A chosen stage is kept in the broadcast link, so an OBS source can be pinned to it. The broadcast link hides caster notes and organizer controls and fits 12 teams at 1920×1080. Additional teams are available via page buttons. OBS Browser Sources use the broadcast URL at 1920×1080.

Caster figures reuse the existing overall scoring and tie rules. Gap means points behind the leader; Move compares current overall rank with the standings excluding the last saved match. New entrants display NEW. Per-match averages use only a team's appearances; win rate is wins divided by appearances. Form shows the latest three appearances. Rising-form commentary needs six appearances and compares the last three against the previous three. Player kills include substitutes; equal kill totals are reported as ties. Deaths, damage and assists are not recorded, so the desk does not invent K/D, damage or assist figures. Failed refreshes retain the last successful data and display an update warning.

Core broadcast metrics align with the categories used in [Garena's esports statistics](https://esports.ff.garena.co.id/statistik); this app retains its own configured scoring rules.
