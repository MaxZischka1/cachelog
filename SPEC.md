# Crew planning app: feature checklist

iPhone first (Expo / React Native, TypeScript). Offline-first. Working name: **Cachelog**.

Legend: **[v1]** spring pilot with one crew · **[v2]** after the pilot · **[later]** needs the radio tags or a backend.

---

## 1. Blocks and maps
- [v1] Create a block (name, contract, licensee, tree price per species)
- [v1] Import a GeoTIFF block map and show it offline over the basemap
- [v1] Import KML / GeoJSON boundaries and pieces
- [v1] Read GeoPDF georeferencing (LGIDict / Measure+GPTS) so the map can be placed correctly
- [v2] Render GeoPDF on-device (native PDFKit) — v1 fallback: convert to GeoTIFF on a laptop
- [v2] Shapefile import
- [v1] Offline basemap region download for the block area
- [v1] Show own GPS position, heading, accuracy
- [v1] Measure distance and area

## 2. The plan (crew boss)
- [v1] Caches: drop on map, species + counts, notes, move, delete
- [v1] Pieces: draw polygon, name, area auto-computed, prescription (density, spacing), notes
- [v1] Assign planters to pieces (and to a cache)
- [v1] Hazards: point/area with a note (wasp nest, cliff, bear sign)
- [v1] Emergency info per block: muster point, helipad, evac route note, nearest hospital
- [v1] Load list: totals by species from all caches (truck/heli manifest)
- [v2] Templates: copy yesterday's plan as today's draft

## 3. Plan versioning (git-style)
- [v1] Draft: all edits stay local until published
- [v1] Review changes: plain-language diff ("Cache 3 moved 200 m E", "Jess: piece 4 → piece 6")
- [v1] Publish: numbered version with timestamp and author
- [v1] Discard draft / revert to a published version
- [v1] History list of published versions
- [v1] Quick publish for a single mid-day change (no full review screen)
- [v2] Map diff view (ghosted old positions)

## 4. Sharing the plan (sync)
- [v1] Export a published plan as a single file; share via AirDrop / share sheet
- [v1] Import a plan file on a planter phone; refuses older versions than the one it has
- [v2] Camp sync over local Wi-Fi / Starlink (crew boss phone or a camp server)
- [later] Mid-day plan updates over LoRa tags

## 5. Planter view
- [v1] Morning brief: my piece, my cache, species, prescription, hazards, emergency info, plan version
- [v1] Offline map with my piece highlighted and caches with counts
- [v1] Log bag-ups (species, count, from which cache)
- [v1] Personal day total and season total
- [v1] Estimated earnings from tree prices
- [v2] Bag-up timer and pace stats

## 6. Tallies and reconciliation (end of day)
- [v1] Tally entry per planter / piece / species (crew boss, or collected from planter files)
- [v1] Tallies are an add-only log, separate from plan versions; corrections are new entries
- [v1] Cache reconciliation: trees put in cache − trees bagged/tallied = remaining; flag mismatches
- [v1] Piece status: not started / in progress / complete; completed area shaded on map
- [v1] Day summary: trees by species, by planter, by piece; earnings per planter
- [v1] CSV export (tallies, payroll lines, piece completion)
- [v2] Quality plots: GPS point, plot count, pass/fail, notes

## 7. Safety
- [v1] Emergency card always one tap away (works offline)
- [v2] Check-in / check-out log for the crew
- [later] Inactivity alerts and live positions from radio tags

## 8. Contractor / office
- [v2] Web dashboard: all crews and blocks, % complete, trees remaining, payroll export
- [v2] Licensee report: planted-area shapefile + PDF summary
- [v2] Accounts, roles (contractor, supervisor, crew boss, planter)

## 9. Platform and distribution
- [v1] Expo dev build, runs on iPhone via TestFlight
- [v1] Location permission: when-in-use only for v1 (keeps App Store review simple)
- [v1] All data local (SQLite); nothing requires signal in the block
- [v2] App Store listing / private distribution to contractors

---

## v1 build milestones
1. Core: data model, plan versioning + diff, plan file export/import (pure TS, unit-tested)
2. Storage: SQLite repositories, tally log, reconciliation, CSV export
3. Map: MapLibre map, GPS, caches/pieces/hazards rendering and editing
4. Import: GeoTIFF, KML/GeoJSON, GeoPDF georeference reader
5. Screens: crew boss plan/review/publish/tallies; planter brief/map/bag-ups; emergency card
