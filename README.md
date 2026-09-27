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
3. Add at least one category slug and one product type. The category file is `src/data/categories/<slug>.json`, and the filename has to match the slug. `products` name the kind of goods (stainless flatware), not patterns or prices.
4. Cite every factual paragraph, change-log entry, open question, inputs line, and automation note. Every source in the `sources` array has to be cited at least once. The build fails if an id is missing or unused.
5. Keep the page on the manufacturer. Patterns, prices, and shopping carts stay on the company’s own site. Link that site.
6. When a fact is thin, contradicted, or unread, put it in `openQuestions` instead of stating it as established. Leave `automation` off the file when heavy automation is not established. Leave `inputs` off when the materials are not established. Do not invent either one.

A foreign parent that manufactures in the United States takes `not-american-owned-and-run` on the ownership badge. A U.S. owner that manufactures abroad takes `not-made-in-usa` (or `split`, when production is genuinely in more than one place). Made-in-USA directories are lead lists only. They do not fill this index.

The public list is alphabetical by `name`, including inside a category. `featured` does not move a company up. An automation note does not move one down. The American rating does not sort the list.

## Categories

A shopper browses shelves at `/categories`. Each shelf is a JSON file in `src/data/categories/`. A manufacturer lists `categories` and `products`. The product name is the kind of goods, so someone can find flatware and the company that makes it. The profile stays the manufacturer record.

A shelf is added when a company is filed under it. Do not add an empty Tools or Apparel shelf to imply those markets were surveyed.

## American rating

The number is computed in `src/lib/rating.ts`. The same weights are printed on `/how-we-rate`. Do not store a hand-typed score in the JSON.

| Line | Full | Half | None | Unknown |
| --- | --- | --- | --- | --- |
| Who owns and runs it | 40 | 20 | 0 | Left out of the total |
| Where it is made | 40 | 20 | 0 | Left out of the total |
| Inputs from America | 20 | 10 | 0 | Left out of the total |
| Automation | Shown, worth 0 | | | Shown as not established, worth 0 |

Ownership full: `american-owned-and-run` with confidence `reported`. Half: that code with confidence `partial`. None: `not-american-owned-and-run` when confidence is not `unverified`. Unknown: code or confidence `unverified`.

Manufacturing full: `made-in-usa` with confidence `reported`. Half: that code with confidence `partial`, or `split` when confidence is not `unverified`. None: `not-made-in-usa` when confidence is not `unverified`. Unknown: code or confidence `unverified`.

Inputs full: `american` with confidence `reported`. Half: code `partial`, or `american` with confidence `partial`. None: `not-american` when confidence is not `unverified`. Unknown: field omitted, code `unknown`, or confidence `unverified`. `reported` on a `partial` code means the incomplete account is sourced. It does not mean every input is American.

Automation is the fourth line on the card. A heavily automated American-owned shop is disclosed and stays on the list. The line adds nothing and subtracts nothing. Omitting it is not a penalty.

## Inputs

```json
"inputs": {
  "code": "partial",
  "label": "Short label for the breakdown",
  "short": "What the sources actually support.",
  "confidence": "reported",
  "sources": ["source-id"]
}
```

`code` is `american`, `partial`, `not-american`, or `unknown`. Omit the object when you cannot say.

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

The automation note is set. On October 1, 2016, Greg Owens told Spectrum News that almost every stage of the flatware process was automated to the max. Chief Executive wrote on March 20, 2020 that the business model was based on high levels of factory automation; that sentence is the magazine’s, not a quotation. The Rome Sentinel on March 2, 2025 described a MARQ4 Automation stamper at the plant. The company’s own pages still describe polishers and hand packing. The note says it is not a floor audit, and the profile’s limits section says the share of automated work was not measured. That line is disclosed on the rating and worth zero. No other profile is on the site. A later file leaves `automation` unset unless its own sources clear the same bar.

Liberty is filed under Flatware, for stainless flatware. Inputs are `partial`: the company and two interviews describe U.S. steel and U.S. packaging, the named mills are examples, and no mill certificate was reviewed. Ownership and the Sherrill plant stay on the reported badges. The rating page states the arithmetic. The list stays alphabetical.
