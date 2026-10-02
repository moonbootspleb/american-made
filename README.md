# The American Forge

A static record of manufacturers. Each profile asks two questions separately: who owns and runs the company, and where the manufacturing happens.

The site is called **The American Forge**. Profiles are JSON files in this repository. They are not stored in Netlify Blobs.

## Local development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

The dev server prints a local URL. Start at `/` (the manufacturer list). The header is the logo, Categories, How we rate, and Donate. Open `/categories`, `/how-we-rate`, `/donate`, and `/manufacturers/liberty-tabletop`. The footer links to `/submit`, `/submit/review`, `/submit/company`, `/donate`, and a quiet Admin link. `/about` and `/manufacturers` redirect to the rating page and the list.

`/admin/login` needs `ADMIN_PASSWORD` in the environment (see [Admin queue](#admin-queue)). Without `NETLIFY_AUTH_TOKEN`, a signed-in visit says the inbox cannot be read. Neither value is required to build.

The dev server may print a warning about Netlify edge functions when Deno is not installed. The pages still load. That local server is not part of the production deploy.

## Build

```bash
npm install
npm run build
```

`npm run build` writes the public pages to `dist/`. `/admin` is not a file in that folder. The same build prepares the on-demand function Netlify uses for `/admin` and `/api/admin/submissions`. Preview the public pages with:

```bash
npm run preview
```

Try the queue with `npm run dev`.

## Netlify

Settings are also in [`netlify.toml`](netlify.toml).

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Node version | 22 |

The site is a static Astro build. Profiles are not stored in a blob store. One Netlify function, `netlify/functions/donate.ts`, opens Stripe Checkout for donations. It does not read the form inbox and it does not write manufacturer files. Card donations stay off until the settings in [Donations](#donations) are set.

`/admin` is on-demand. It reads the Netlify Forms inbox after a password check. It does not write manufacturer files either. See [Admin queue](#admin-queue).

## Corrections and reviews

Manufacturer profiles include a form. The same form is at `/submit`. After a successful post, the sender lands on `/submit/received`.

The moderation queue is the **Netlify Forms** inbox. Netlify detects each form from the static HTML (`data-netlify="true"`). A honeypot field named `bot-field` is on every form. Nothing in this repository writes a submission into a manufacturer file. `/admin` only reads the inbox.

A submission does not go live. Nothing in the submission path writes `src/data/manufacturers/*.json` or any Markdown. Public copy changes only when a person later applies an approved edit in git and that commit is deployed. A review, a review request, and a company suggestion are read the same way and are not published from the form.

The page says this in plain language: the note sits in a queue, a person reads it, and the page does not change from the form.

| Form name | Page | What it is |
| --- | --- | --- |
| `page-submission` | `/submit`, and the bottom of a manufacturer profile | A review the sender wrote, or a proposed edit. |
| `review-request` | `/submit/review`, and on a manufacturer profile | Ask for a review of a company that already exists. Does not publish the note. |
| `company-suggestion` | `/submit/company` | Suggest a manufacturer that is not on the list. Does not add the company. |

All three post to `/submit/received`. Do not add a build step or a function that copies inbox entries into manufacturer files.

| Field | Required | Notes |
| --- | --- | --- |
| `type` | yes | `review` or `edit` |
| `page` | yes | Path on this site, which includes the slug. Filled and locked on a manufacturer profile. |
| `name` | no | Not published. |
| `email` | no | Only if the sender wants a reply. Not published. |
| `body` | yes | The review or the proposed change. |
| `evidence` | no | URLs, one per line. |

`review-request` fields:

| Field | Required | Notes |
| --- | --- | --- |
| `type` | yes | Hidden. Always `review-request`. |
| `company` | yes | Company name. Filled and locked on a manufacturer profile. |
| `company_url` | yes | The company’s own site. Filled and locked on a profile. |
| `page` | on a profile | Path on this site. Optional on `/submit/review`. |
| `name` | no | Not published. |
| `email` | no | Only if the sender wants a reply. Not published. |
| `body` | yes | What they want reviewed. |
| `evidence` | no | URLs, one per line. |

`company-suggestion` fields:

| Field | Required | Notes |
| --- | --- | --- |
| `type` | yes | Hidden. Always `company-suggestion`. |
| `company` | yes | Company name. |
| `company_url` | yes | The company’s own site. |
| `place` | no | City and state, if the sender knows them. |
| `products` | no | The kind of goods. Not a price. |
| `name` | no | Not published. |
| `email` | no | Only if the sender wants a reply. Not published. |
| `body` | yes | Why the company should be filed, and what the sender knows. |
| `evidence` | no | URLs, one per line. |

`netlify.toml` does not need a forms block for this. Netlify registers the forms from the built HTML.

## Admin queue

`/admin/login` asks for a password. A correct password sets an HttpOnly cookie for 12 hours. A wrong password does not. If `ADMIN_PASSWORD` is missing, shorter than 12 characters, or a placeholder such as `password`, login stays closed.

`/admin` and `/admin/queue` list the inbox, newest first. Tabs filter `review-request`, `company-suggestion`, and `page-submission`. A visit without the cookie is sent to the login page. `GET /api/admin/submissions` returns 401 without that cookie. The footer link labeled Admin goes to the same gate. It is not in the header.

The page reads Netlify’s submissions API on the server. The token is not sent to the browser. The page does not create `src/data/manufacturers/*.json`, and it does not publish a company.

| Setting | Where it lives | What it does |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Netlify environment only. Secret. | At least 12 characters. Compared on the server. A placeholder is ignored. Changing it signs everyone out. |
| `NETLIFY_AUTH_TOKEN` | Netlify environment only. Secret. | A personal access token that can read this site’s form submissions. [Create one](https://app.netlify.com/user/applications#personal-access-tokens) for the account that owns the site. |
| `NETLIFY_SITE_ID` | Netlify environment. Optional. | The site id whose inbox is read. Production `american-forge` is `13e8b163-dcb1-4638-8c3f-df186953f5a1`. The develop site `american-forge-develop` is `66681ebf-5a78-4af1-acb7-0d655a8e62a9`. When unset, the page uses Netlify’s `SITE_ID` for the site that is serving the page. The production id is the fallback only when neither is set. |

On Netlify, open the site → **Project configuration** → **Environment variables** → **Add a variable**. Add the three names for the **Production** scope (and on `american-forge-develop` if that site should show its own inbox). Mark the password and the token as secret. Do not prefix them with `PUBLIC_`. Redeploy so the on-demand routes pick them up. The static build succeeds without them.

Copy the names from [`.env.example`](.env.example). Do not commit `.env`, and do not put a real password in the repository.

Log out from the button on the queue. That clears the cookie. The queue is for a person to read. Moving an approved note into a manufacturer file is still a later edit in git.

## Adding a manufacturer

1. Add `src/data/manufacturers/<slug>.json`. The filename and the `slug` field must match.
2. Fill both badges. `ownership.code` is one of `american-owned-and-run`, `not-american-owned-and-run`, or `unverified`. `manufacturing.code` is one of `made-in-usa`, `not-made-in-usa`, `split`, or `unverified`.
3. Add at least one category slug and one product type. The category file is `src/data/categories/<slug>.json`, and the filename has to match the slug. `products` name the kind of goods (stainless flatware), not patterns or prices.
4. Cite every factual paragraph, change-log entry, open question, inputs line, and automation note. Every source in the `sources` array has to be cited at least once. The build fails if an id is missing or unused.
5. Add `logo` and keep `website`. The logo file lives at `public/manufacturers/<slug>/`. The card and the profile show that mark and a company link. Prices and shopping carts stay on the company’s own site.
6. Photographs are optional. Omit `gallery` when none are filed. To add them, follow [Product photographs](#product-photographs). Do not leave an empty array, and do not invent a stock picture.
7. When a fact is thin, contradicted, or unread, put it in `openQuestions` instead of stating it as established. Leave `automation` off the file when heavy automation is not established. Leave `inputs` off when the materials are not established. If `inputs` is present and the code is not `unknown`, include `components` whose percentages total exactly 100. Do not invent shares. Leave `affiliate` off unless a real affiliate or partner URL is already known. Do not invent one.

A foreign parent that manufactures in the United States takes `not-american-owned-and-run` on the ownership badge. A U.S. owner that manufactures abroad takes `not-made-in-usa` (or `split`, when production is genuinely in more than one place). Made-in-USA directories are lead lists only. They do not fill this index.

The public list is alphabetical by `name`, including inside a category. `featured` does not move a company up. An automation note does not move one down. The American rating does not sort the list.

## Logo and company link

Every profile requires `logo` and `website`.

```json
"logo": {
  "src": "/manufacturers/example-slug/logo.png",
  "width": 600,
  "height": 160,
  "alt": "Example Company"
},
"website": "https://example.com/",
"websiteLabel": "example.com"
```

`logo.src` is a path under `public/manufacturers/<slug>/`. The file has to be in the repository. `png`, `jpg`, `jpeg`, `webp`, `gif`, and `svg` are allowed. For a raster file, `width` and `height` are that file’s pixel size. An SVG still needs both so the page can reserve space. `alt` names the mark.

`website` is the company’s own site, and it stays required. The build fails if the logo file is missing on disk, if the recorded raster size does not match the file, or if `website` is not an http or https URL.

The list card still opens our profile from the card body. A separate company link on the card goes to the company’s site. The profile header shows the same mark and the same company link. The line labeled Official site on the profile always uses `website`.

`affiliate` is optional. Omit it when there is no real affiliate or partner URL. Do not invent a program or a URL. The block below is the file shape only. It is not a link on this site.

```json
"affiliate": {
  "url": "https://example.com/partner",
  "disclosure": "We may earn a commission if you buy through this link.",
  "network": "Optional program name"
}
```

When `affiliate` is present, the card, the profile header, and the bottom company button use `url` instead of `website`. `disclosure` is shown beside those links only, in plain language. `network` is an optional label. Those links use `rel="sponsored"`. The Official site line does not.

## Product photographs

`gallery` is optional. Omit it when the company has no photographs on the record. An empty array fails the build. At most eight images.

This is the edit path. A form cannot attach a file, and a submission does not put a picture on the site.

1. Save a photograph the company published under `public/manufacturers/<slug>/`. `png`, `jpg`, `jpeg`, `webp`, `gif`, and `svg` are allowed. A raster file’s `width` and `height` have to match the file, the same rule as the logo.
2. Add an object to `gallery` in `src/data/manufacturers/<slug>.json`.

```json
"gallery": [
  {
    "src": "/manufacturers/example-slug/gallery/place-setting.jpg",
    "width": 800,
    "height": 800,
    "alt": "What is in the photograph, and who published it.",
    "caption": "Pattern or product name",
    "credit": "Example Company",
    "sourceUrl": "https://example.com/the-page-the-photo-came-from"
  }
]
```

The block above is the file shape only. It is not a photograph on this site. `credit` names the publisher. `sourceUrl` is the page the file came from. Do not point `src` at a stock library, and do not leave the credit off. The profile shows the caption and links the credit to `sourceUrl`. Prices and the cart stay on the company site.

A profile with no `gallery` shows that none are filed, and it names the two paths above. That empty state is the record until a real photograph is added.

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

Inputs full: every component origin is `us`, and confidence is `reported`. Half: the list mixes origins (some `us` and some other origin, any `mixed`, or a known origin beside `unknown`), or every component is `us` but confidence is `partial`. None: every component origin is `foreign`. Unknown: `inputs` omitted, code `unknown`, confidence `unverified`, every component origin `unknown`, or a scored code with no component list. When components are present, the points follow that list. An unknown code or unverified confidence still leaves the line out. The weight stays 20.

Automation is the fourth line on the card. A heavily automated American-owned shop is disclosed and stays on the list. The line adds nothing and subtracts nothing. Omitting it is not a penalty.

## Inputs

```json
"inputs": {
  "code": "partial",
  "label": "Short label for the breakdown",
  "short": "What the sources actually support.",
  "confidence": "reported",
  "sources": ["source-id"],
  "components": [
    { "name": "Component A", "percent": 70, "origin": "us" },
    { "name": "Component B", "percent": 30, "origin": "foreign", "note": "Optional short limit." }
  ]
}
```

`code` is `american`, `partial`, `not-american`, or `unknown`. `origin` is `us`, `foreign`, `mixed`, or `unknown`. The shares in the example are a file shape, not a manufacturer on this site.

When `components` is present, the percentages must total exactly 100. When `code` is not `unknown`, `components` is required. Omit the whole object when the materials are not established. The build fails on a bad total or on a scored line with no list. The profile shows each component as name, share, and origin under Inputs from America, and keeps `short` with its sources. Do not invent a share the sources do not give.

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

The automation note is set. On October 1, 2016, Greg Owens told Spectrum News that almost every stage of the flatware process was automated to the max. Chief Executive wrote on March 20, 2020 that the business model was based on high levels of factory automation; that sentence is the magazine’s, not a quotation. The Rome Sentinel on March 2, 2025 described a MARQ4 Automation stamper at the plant. The company’s own pages still describe polishers and hand packing. The note says it is not a floor audit, and the profile’s limits section says the share of automated work was not measured. That line is disclosed on the rating and worth zero. A later file leaves `automation` unset unless its own sources clear the same bar.

The list card and the profile header use Liberty Tabletop’s own header mark, saved from libertytabletop.com, and link out to that official site. The file has no `affiliate` object.

The profile also files six photographs saved from Liberty Tabletop’s own shop on 2026-09-30: Betsy Ross, Annapolis, Kensington, American Industrial, Honey Bee, and American Garden. Each credit links to the shop page the file came from. They are not a catalog, and they are not prices. A company with no `gallery` array does not get stand-in pictures.

Liberty is filed under Flatware, for stainless flatware. Inputs are `unknown` and have no component list: company pages and two interviews describe U.S. steel and U.S. packaging, the named mills are examples, and no source gives shares that total 100. This record does not assign percentages. The rating leaves that line out. Ownership and the Sherrill plant stay on the reported badges. The rating page states the arithmetic. The list stays alphabetical.

Appalachian Manufacturing Co. is the second profile, filed under Coffee makers for drip coffee makers. The company page names Nevade Eby as founder and maker, says the company started in 2026, and says each Heritage Drip is built by hand in a Pennsylvania workshop. It also uses the words made in the USA. The .com registry record shows the domain was registered on February 26, 2026, and it does not name a registrant. No charter, city, or street address was retrieved. A Salem, Ohio trailer business on the Better Business Bureau site uses the same name and is not this company. An indexed Luthersburg, Pennsylvania record under the same name did not return its article, so that page’s owner is not adopted. Ownership and the plant are both `unverified`, and both lines are left out of the rating. Inputs are omitted: the page names walnut, brass-coated stainless steel, glass, an aluminum element, stainless piping, and a food-grade silicone junction, and it gives no origins and no shares. Automation is omitted. The hand-built sentences are the company’s, not a measured shop note. The list stays alphabetical.

## Donations

`/donate` is linked from the header and the footer. The page does not take a card number. It does not show a Bitcoin address until one is confirmed. No payment key is stored in the repository. Copy [`.env.example`](.env.example) for the names. Do not commit `.env`.

Amounts on the checkout function are US dollars: $10, $25, $50, $100, and $250.

| Setting | Where it lives | What it does |
| --- | --- | --- |
| `PUBLIC_STRIPE_PAYMENT_LINK` | Build environment. Public. | An `https` link on `buy.stripe.com` or `donate.stripe.com`. The page shows **Donate by card**. Rebuild after setting it. A placeholder is ignored. |
| `PUBLIC_STRIPE_CHECKOUT` | Build environment. Public. Set to `1`. | Shows the amount buttons. Rebuild after setting it. |
| `STRIPE_SECRET_KEY` | Netlify environment only. Secret. | `sk_live_...` or `sk_test_...`. Read at runtime by `netlify/functions/donate.ts`. Never prefix it with `PUBLIC_`. The amount buttons post there and redirect to Stripe Checkout. If the key is missing, the function sends the sender to `/donate/card-unavailable` and charges nothing. |
| `PUBLIC_BITCOIN_DONATION_ADDRESS` | Build environment. Public. | A mainnet address (`bc1…`, or a legacy `1` or `3` address). Shown only when it passes that check. Sample addresses from Bitcoin documentation, and strings like `your-address`, are ignored. Leave it unset until an address is confirmed. Rebuild after setting it. |

Stripe Checkout uses `submit_type=donate` and a one-time `price_data` charge in `usd`. The success URL comes back to `/donate/thanks`. That page does not ask Stripe whether the payment succeeded, and it does not store a card. Cancel returns to `/donate`.

The function refuses any amount outside the five listed above. It only redirects to `https://checkout.stripe.com/…` or to the card-unavailable page on this site.

Until those settings are set, `/donate` says card donations are not turned on, and Bitcoin says coming soon. That is the shipped state. Do not put a fake key or a fake wallet in the page to make the buttons look live.
