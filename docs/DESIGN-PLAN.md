# FFK War Desk redesign plan

## Goal
An organizer should always know three things within a second of opening the desk: where the tournament is, what to do next, and whether anything needs them.

## Direction: broadcast control room
- Near-black graphite surfaces with depth; a faint red glow behind the page.
- Channel red is reserved for the one action that matters on each screen.
- Barlow Condensed (the scoreboard face) for page titles and every number that decides the tournament; DM Sans for everything else.
- Cards are 16px radius with a hairline border; controls are 10px.
- Colour has one meaning each: red = act, green = confirmed, amber = needs you, gold/silver/bronze = podium.

## UX changes
| Area | Before | After | Status |
|---|---|---|---|
| Navigation | Five pages, with Add results as its own page | Four pages (Tournament, Teams, Standings, Map wheel); results are added from the Tournament page; Host desk and Backup grouped under "Tools" | Built |
| Sidebar | Scrolled away with the page; logo changed per page | Pinned; one brand lockup everywhere | Built |
| Tournament | Plain title, three numbers in a strip | "Now playing" hero card with the next action, three stat cards with progress bars, numbered stage tracker, amber attention card ; lower blocks (match count, unassigned matches, saved matches) as cards; on the phone the next action is a fixed bar above the tabs | Built |
| Teams | One long list of rows | Two-column cards with initial badge, set tag and player chips | Built |
| Standings | Flat podium and table | Gold/silver/bronze podium, condensed scoreboard numbers, coloured top-three ranks, segmented view tabs | Built |
| Sign-in | "Sign in again" dialog appeared on top of the sign-in page | Dialog suppressed there | Built |
| Add results, results check | Older styling | Inherit the new tokens, titles and controls; reviewed on desktop and phone, layout kept | Built |
| Dialogs (team form, export, backup, host desk, slot list) | Cramped text, labels and fields | Condensed title, spacing between text, labels and fields, styled file picker | Built |
| Host desk, broadcast, wheel screens | Separate stylesheets | Unchanged: they are the stream graphics, with their own brand layer | Not planned |

## Where it lives
- `public/desk.css`: the whole redesign layer, loaded after `app.css`.
- `public/app.js`, `public/war.js`: small markup changes (nav, progress bars, team badge).

## Verified
- Desktop (1440) and phone (iPhone 13) screenshots of every page and dialog.
- `node tools/run-checks.cjs --browser`: 29 passed, 3 skipped, 0 failed.
