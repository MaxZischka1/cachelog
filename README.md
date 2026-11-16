# Cachelog

Crew planning for tree planting: the crew boss plans caches, pieces and assignments, reviews a plain-language list of changes, publishes a numbered plan, and AirDrops it to planters. Planters get a morning brief and an offline map, and log bag-ups. At the end of the day, tallies are checked against cache drops and bag-ups, and payroll is exported as CSV.

Expo SDK 58 · React Native · TypeScript · MapLibre · SQLite. Everything works offline.

See `SPEC.md` for the feature checklist and `CONTRACTS.md` for how the modules fit together.

## Run it on your iPhone

The map (MapLibre) uses native code, so **Expo Go won't work**. You need a development build.

1. Install the dependencies: `npm install`
2. Create a free Expo account and log in: `npx eas-cli@latest login`
3. Register your iPhone: `npx eas-cli@latest device:create` (open the link on the phone)
4. Build: `npx eas-cli@latest build --profile development --platform ios`
   This needs an Apple Developer account ($99 US/yr). EAS signs the app for you.
5. Install the build on the phone from the link EAS gives you, then run `npx expo start` on your laptop and open the app.

With a Mac and Xcode, `npx expo run:ios --device` does the same build locally.

## Checks

```
npm test            # 268 unit tests: plan versioning, merge, diffs, files, pins, tallies, storage, map helpers, import
npm run typecheck
npx expo export --platform ios   # confirms the app bundles
```

## How data moves

Every file ends in `.cachelog`. Tap one that was AirDropped to you and it opens in the app, or use any Import button; the app works out which kind it is.

- **Plan (boss → crew):** Share plan → AirDrop. Carries the block, the published version, the map images and every crew pin. Older or identical versions are skipped.
- **Crew updates (anyone → boss):** "Send my updates" carries that phone's bag-ups, pins and piece status. Importing the same file twice is safe.
- **Block map (licensee → boss):** GeoPDF, GeoTIFF, KML or GeoJSON. Use any Import button (pick several at once for a whole contract), or Share → Cachelog from Files or Mail. From a GeoPDF map sheet the app also reads the opening number, plant/opening area and each prescription (species, trees/ha, total trees, boxes, stock, seedlot, start date…) by where the labels and values sit on the page, so it isn't tied to one licensee's form. The map goes on the block with that opening number, else the block it lies over, else the empty block the import was started from, else a new block named by its opening number. It only asks when more than one block could fit. A revised copy of the same map replaces the old one. New pieces default to the sheet's density and species, and planters see them in the morning brief.
- **Suggestion (boss/foreman → publishing boss):** Review → "Send as a suggestion instead". The receiver sees the change list and loads it into their draft; nothing is published until they review it.

See `docs/GAP-REVIEW.md` for what changed in v0.2 and why.

## Not done yet / needs a real phone

- Nothing has run on a device yet. Expect MapLibre, location and file-sharing issues to show up in the first test.
- GeoPDFs import as map images on iPhone (native PDFKit module in `modules/geopdf-render`; rebuild the app after pulling it). Only the georeferenced map frame is drawn, so legends and planting forms on the same page stay off the map. Checked against a real ALPAC plant opening map; not yet on a device. Multi-page PDFs import the first map page. Android can't draw them yet: convert to GeoTIFF (`gdal_translate in.pdf out.tif`).
- Map label font and the OpenFreeMap basemap style are unverified (the build machine couldn't reach them).
- Opening `.cachelog` files from AirDrop is wired up (file type registered, `/open` route) but untested on a device.
- Sharing is still file passing. No camp Wi-Fi / phone-to-phone sync, contractor web dashboard, quality plots or radio-tag integration yet (see SPEC.md v2/later).
