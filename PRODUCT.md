# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

## Users

- **Planters (primary, ~18 per crew).** Paid piece rate (roughly 12–25¢ a tree, 1,500–5,000 trees a day). They work all day in cutblocks with the phone in a bag or ziplock, hands dirty, wet or gloved, often using one hand. They pull the phone out at the cache to log a bag-up, to find their piece or cache, and to check what the boss wants today. Each glance has to answer its question in about 3 seconds.
- **Crew boss (one per crew).** Plans the next day at night in camp: pieces, caches, assignments, spec, notes. During the day they have almost no time and need a fast overview. They collect tallies at end of day.
- **Company / camp management (buyer).** Reforestation companies or camps pay for Cachelog. Planters use it free.

## Product Purpose

Organization for a planting crew. Today the plan lives in the crew boss's head and on a paper map, while 18 people each need to know their part of it. Cachelog gives everyone the same picture: block perimeters, pieces, caches, the boss's written plan for the day, and each planter's own tree count. Success means planters want to open it, and the boss stops repeating the plan at the truck.

## Positioning

The shared crew map plus the boss's daily plan, on every phone, fully offline. Planter-side counters (Planter Pro, Numbies, Tree Tracker) track trees and earnings but have no block map, caches or plan. Integrity's Tree Tracker Pro is in-house to one company.

## Operating Context

- **Day session.** The planter starts the day, logs quick entries ("+200 spruce") all day, and ends the day. Data stays on the phone.
- **Sync.** Data moves at the start and end of day, at camp or in the truck. There is no live sync in the block. LoRa (live nearest cache, boss pushing a new plan out in the block) is deliberately later.
- **Planter in the block: three destinations.** Bag-up (log trees), Map (piece, caches, perimeter), Plan (the boss's written notes and spec: density, spacing, species, reminders).
- **Crew boss.** Uses the same map with edit tools added, plus a calm planning view at night.
- **Environment.** Glare at noon, a dim tent at 5 a.m., rain, gloves. The battery has to last 10+ hours with GPS.

## Capabilities and Constraints

- Expo / React Native app at this repo (v0.2): MapLibre map, SQLite storage, plan versioning, imports (KML/GeoTIFF/GeoPDF), bag-ups, tallies, crew pins. Plans already carry `notes`; pieces carry a prescription (density, spacing, species).
- Native MapLibre means no Expo Go. Builds go through EAS or a local dev client.
- The count unit varies by contract: trees, bundles or boxes/trays, so it needs a per-block setting. Totals and pay are always in trees.
- Offline-first is non-negotiable.
- Undecided: pricing, the company-level web dashboard, per-piece notes.

## Evidence on Hand

No customers, testimonials or usage data yet. Nothing has run on a real phone. Don't invent any of that.

## Product Principles

1. **Every glance answers one question in 3 seconds.** If a screen needs reading, it's wrong.
2. **Gloves, glare, one hand.** Big targets, taps not swipes, no typing in the block.
3. **Calm by default.** The first version feels almost empty, and advanced tools appear only when needed.
4. **One map, one mental model.** Planters and the boss see the same thing; the boss just has edit tools.
5. **Your numbers are the motivation.** Trees today, $ today, pace against yesterday.

## Accessibility & Inclusion

Sunlight-readable contrast (aim well above WCAG AA for primary numbers and actions), touch targets of at least 56dp for gloves, a real dark mode for night, and no information carried by colour alone.

## Brand Commitments

- **Clean, conventional tracker look (chosen 2026-11-25).** Over two rounds of bold visual directions, the user chose the category standard, a clean fitness-tracker style: big numbers, simple rounded cards, a tab bar. They said it's "clean and we can build a lot on it." Execute convention at full craft; don't swap it for a themed world.
