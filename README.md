# American Made Accountability

A static record of manufacturers. Each profile asks two questions separately: who owns and runs the company, and where the manufacturing happens.

The working title is **American Made Accountability**. Profiles are JSON files in this repository. They are not stored in Netlify Blobs.

## Local development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

The dev server prints a local URL. Start at `/` (the manufacturer list), then open `/about`, `/manufacturers`, and `/manufacturers/liberty-tabletop`.

## Build

```bash
npm install
npm run build
```

`npm run build` writes a static site to `dist/`. Preview that output with:

```bash
npm run preview
```

## Netlify

Settings are also in [`netlify.toml`](netlify.toml).

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Node version | 22 |

The site is a static Astro build. No serverless functions and no blob store.

## Adding a manufacturer

1. Add `src/data/manufacturers/<slug>.json`. The filename and the `slug` field must match.
2. Fill both badges. `ownership.code` is one of `american-owned-and-run`, `not-american-owned-and-run`, or `unverified`. `manufacturing.code` is one of `made-in-usa`, `not-made-in-usa`, `split`, or `unverified`.
3. Cite every factual paragraph, change-log entry, open question, and automation note. Every source in the `sources` array has to be cited at least once. The build fails if an id is missing or unused.
4. Keep the page on the manufacturer. Patterns, prices, and shopping carts stay on the company’s own site. Link that site.
5. When a fact is thin, contradicted, or unread, put it in `openQuestions` instead of stating it as established. Leave `automation` off the file when heavy automation is not established. Do not invent it.

A foreign parent that manufactures in the United States takes `not-american-owned-and-run` on the ownership badge. A U.S. owner that manufactures abroad takes `not-made-in-usa` (or `split`, when production is genuinely in more than one place). Made-in-USA directories are lead lists only. They do not fill this index.

The public list is alphabetical by `name`. `featured` does not move a company up. An automation note does not move one down.

## Automation note

Use this only when the sources support all of the following: the company was founded in the United States, the ownership badge is already `american-owned-and-run`, and the shop is heavily automated. Using some machines is not enough. A foreign-owned plant does not get the note.

Omit the object when that is not established. Do not set `heavilyAutomated` to false. Absence means the degree of automation is not established. It does not mean a hand shop was verified.

The note is a fact. The page shows it as a short line under the two badges, on the list card and on the profile. It is not a warning color, and it is not a reason to drop or bury the company.

```json
"automation": {
  "heavilyAutomated": true,
  "label": "Heavily automated",
  "note": "One or two concrete sentences, dated to the sources.",
  "sources": ["source-id"]
}
```

`label` is at most 40 characters. `note` is at most 320. `sources` must be ids that also appear in the profile’s `sources` array. The same rules are commented on `automation` in `src/lib/manufacturers.ts`.

## What is published now

Liberty Tabletop, the consumer brand of Sherrill Manufacturing in Sherrill, New York, is the first profile. Ownership, the Sherrill flatware plant, the bankruptcy, and the Toluca, Mexico contract chapter are sourced in that file. Limits — no cap table, conflicting officer titles and contract dates, Syracuse.com pages that did not return full text — are printed on the profile.

The automation note is set. On October 1, 2016, Greg Owens told Spectrum News that almost every stage of the flatware process was automated to the max. Chief Executive wrote on March 20, 2020 that the business model was based on high levels of factory automation; that sentence is the magazine’s, not a quotation. The Rome Sentinel on March 2, 2025 described a MARQ4 Automation stamper at the plant. The company’s own pages still describe polishers and hand packing. The note says it is not a floor audit, and the profile’s limits section says the share of automated work was not measured. No other profile is on the site. A later file leaves `automation` unset unless its own sources clear the same bar.
