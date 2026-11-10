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
npm test            # 234 unit tests: plan versioning, merge, diffs, files, pins, tallies, storage, map helpers, import
npm run typecheck
npx expo export --platform ios   # confirms the app bundles
```

## How data moves

Every file ends in `.cachelog`. Tap one that was AirDropped to you and it opens in the app, or use any Import button; the app works out which kind it is.

- **Plan (boss → crew):** Share plan → AirDrop. Carries the block, the published version, the map images and every crew pin. Older or identical versions are skipped.
- **Crew updates (anyone → boss):** "Send my updates" carries that phone's bag-ups, pins and piece status. Importing the same file twice is safe.
- **Suggestion (boss/foreman → publishing boss):** Review → "Send as a suggestion instead". The receiver sees the change list and loads it into their draft; nothing is published until they review it.

See `docs/GAP-REVIEW.md` for what changed in v0.2 and why.

## Not done yet / needs a real phone

- Nothing has run on a device yet. Expect MapLibre, location and file-sharing issues to show up in the first test.
- GeoPDFs: their position is read but they can't be displayed yet. Convert to GeoTIFF first (QGIS: Raster → Conversion → Translate, or `gdal_translate in.pdf out.tif`).
- Map label font and the OpenFreeMap basemap style are unverified (the build machine couldn't reach them).
- Opening `.cachelog` files from AirDrop is wired up (file type registered, `/open` route) but untested on a device.
- Sharing is still file passing. No camp Wi-Fi / phone-to-phone sync, contractor web dashboard, quality plots or radio-tag integration yet (see SPEC.md v2/later).
