# Gap review: v0.1 against the goal (Nov 9 2026)

**Goal:** a simple, organized app where crew bosses and crew members plan the day together on a shared map: pins, locations, assignments.

**Where v0.1 fell short:** it was a one-way broadcast. The crew boss planned and pushed; the crew could only send bag-up numbers back. Nothing a planter saw in the block could reach the map, and a second crew boss could not take part at all.

## Gaps, ranked by how much they block the goal

| # | Gap in v0.1 | Why it matters | Status in v0.2 |
|---|---|---|---|
| 1 | Crew members could not put anything on the map | "Planning between bosses and crew" needs a channel back. Wasps, an empty cache, unplantable ground: the planter knows first | **Built: crew pins** |
| 2 | Only one phone could ever change a block's plan | Two crew bosses, or a boss and a foreman, could not plan together; a boss phone could not even receive a plan | **Built: suggestions + any phone can import a plan** |
| 3 | A quick mid-day change stranded the open draft (had to discard it) | Punishes the boss for using the fast path | **Built: drafts merge onto the new version automatically** |
| 4 | Three different import buttons for three file types; files had to be found in a picker | Friction 12 times every morning | **Built: one import, and tapping an AirDropped file opens it in the app** (needs a device test) |
| 5 | Planters could not report piece progress | The boss's completion map only moved when the boss updated it | **Built: "My piece" status on the planter home** |
| 6 | Block home was a flat list of eight buttons | Not "organized, simple" | **Built: grouped as Plan → Crew → End of day → Setup** |
| 7 | GeoPDF maps cannot be displayed | Block maps often arrive as GeoPDFs (to confirm with crew bosses) | **Built: local Swift/PDFKit module `modules/geopdf-render`** renders the georeferenced page to PNG (iPhone only; needs a device test with a real GeoPDF) |
| 8 | Sharing is still file passing (AirDrop) | Works offline and needs no server, but is manual. Real sync needs a camp server or phone-to-phone (Multipeer) networking | Open. The file formats are the sync protocol, so a transport can be added underneath without changing the app's data model |
| 9 | Never run on a phone | Map, GPS, file opening and sharing are all untested on a device | Open. First job on the Mac |
| 10 | No photos on pins, no check-ins, no quality plots, no contractor web view | Useful, not blocking | Open (see SPEC.md) |

## What v0.2 adds

### Crew pins
Anyone drops a pin at their GPS position or by tapping the map: Hazard, Cache low, Need trees, Can't plant, Access, Done here, Question, Note, plus a few words.

- Pins live in the add-only log, not the plan, so a planter can never break the plan.
- Planter → boss: pins ride in "Send my updates" with bag-ups and piece status.
- Boss → everyone: all pins ride inside the next shared plan file.
- The boss can mark a pin dealt with, reopen it, or **add it to the plan as a hazard** (it then shows up in the review diff like any other change).
- Open pins show on the planning map, the planter map and the pins screen.

### Suggestions (the pull request)
On the review screen, "Send as a suggestion instead" packages the draft for whoever publishes the block. On their phone it opens as a plain-language change list; "Load into draft" merges it into their draft, and they review and publish as usual. Nothing is published by a suggestion.

### Entity-level merge
One merge function backs both suggestions and stale drafts. It works per cache, piece, planter, hazard and assignment: unrelated edits from both sides are kept; when both sides changed the same thing, the incoming side wins and the item is listed under "Check these" on the review screen.

### One way in
All three file types end in `.cachelog` and the app registers that type with iOS. One Import button (and the system "open in" path) works out what the file is and routes it.

## Suggested order from here
1. Build on the Mac and run it on an iPhone; fix what breaks (map, file opening).
2. ~~GeoPDF rendering module (Swift/PDFKit).~~ Built; test it with a real block GeoPDF. The cutblock outline is also read from the PDF's vector layer (`src/import/pdfPaths.ts`, `src/import/cutblock.ts`).
3. Pilot-crew interviews: is tally reconciliation the money problem, and do bosses actually co-plan?
4. Phone-to-phone sync at camp (Multipeer Connectivity) so nobody passes files.
