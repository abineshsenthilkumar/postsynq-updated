# PostSynq marketing website

Next.js 15 (App Router) + React 19 + TypeScript rebuild of the PostSynq marketing
site. The published Framer site, https://postsynqq.framer.website/, is the design
source of truth. The PostSynq product itself lives at https://www.postsynq.in/ and
is **not** part of this repository (log in / sign up / dashboard links point there).

## Requirements

- Node.js 18.18+ (developed on Node 26.13 LTS), npm

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

The generated page components are large. `npm run dev` therefore starts Next.js
with `--disable-source-maps` (server stack traces show compiled positions),
which keeps the dev server under Next's memory-restart threshold on 8 GB
machines. Use `npm run dev:debug` for source-mapped server stack traces.

## Production build

```bash
npx tsc --noEmit     # type check
npm run build        # all marketing pages are prerendered as static HTML
npm run start        # serve the build on http://localhost:3000
```

## Environment variables

Copy `.env.example` to `.env.local`.

| Variable | Purpose |
|---|---|
| `NEWSLETTER_WEBHOOK_URL` | Receives footer newsletter sign-ups (`POST` JSON `{ email, source, submittedAt }`). Unset = the form tells visitors sign-up is unavailable; it never shows a fake success. |

## Routes

| Route | Source page |
|---|---|
| `/` | Home |
| `/about` | About |
| `/feature` | Features |
| `/pricing` | Pricing |
| `/contact` | Contact |
| `/solutions` | Solutions |
| `/privacy` | Privacy policy |
| any unknown URL | Framer's 404 page (`app/not-found.tsx`, HTTP 404) |
| `POST /api/newsletter` | Newsletter sign-up forwarder |

## How the pages are built

The site's markup and styles are generated from the published Framer pages, so
desktop, tablet (810-1279px) and phone (<810px) layouts match the original
exactly. Pipeline in `tools/framer-import/`:

1. `fetch.mjs` - download each page's server-rendered HTML into `source/`.
2. `harvest.mjs` - capture components Framer renders only in the browser (icons).
3. `harvest-states.mjs` - capture the open state of FAQ items and the mobile/tablet menu.
4. `harvest-hover.mjs` - capture hover variants of buttons/cards (needs `app/_framer/framer.css`, so run after a first convert).
5. `convert.mjs` - write `app/_framer/**` (JSX pages, shared navbar, shared footer, merged CSS, animation CSS, metadata).
   It stops with an error if a page's footer differs from the others (the footer is one shared component).

```bash
node tools/framer-import/fetch.mjs
node tools/framer-import/harvest.mjs
node tools/framer-import/harvest-states.mjs
node tools/framer-import/convert.mjs
node tools/framer-import/harvest-hover.mjs
node tools/framer-import/convert.mjs
```

`app/_framer/**` is generated - change the Framer design and re-run the
pipeline, or move a section into a hand-written component (the planned
refactor) before editing it by hand. Hand-written code:

- `lib/links.ts` - **every official URL, social profile, email and phone number.**
  Generated pages, the navbar and the footer reference these values
  (`href={OFFICIAL_LINKS.app.signup}`), so a change here updates the whole site
  without re-running the pipeline. The rules that attach links Framer left out
  (footer social icons, Contact page icons and phone) are `prepLinks` in `convert.mjs`.
- **Homepage copy**: `HOME_COPY`, `HOME_HEADINGS` and `HOME_STORY` in
  `tools/framer-import/convert.mjs` replace the text of existing Framer elements (all
  breakpoints; layout untouched). Each original text must still exist in the Framer page,
  otherwise conversion stops. SEO title, description, canonical (`NEXT_PUBLIC_SITE_URL`,
  default https://www.postsynq.in) and structured data: `app/page.tsx`.
- `app/layout.tsx` - shared layout: Framer layout template + one navbar for every page
- `app/_framer/Footer.tsx` (generated) - the one footer component; each page renders `<Footer variant>` inside its own breakpoint wrappers
- `app/site.css` - small site-level additions (logo ticker, form status)
- `app/_components/RevealWatcher.tsx` - scroll/entrance animations incl. per-word headings (`appear.css`)
- `app/_components/ScrollReveal.tsx` - Home "Why PostSynQ" paragraph that darkens as you scroll
- `app/_components/RouteTransitions.tsx` - client navigation lands at the top and releases link focus, like a full page load
- `app/_components/Toggle.tsx` - FAQ accordion and mobile menu (keyboard + ARIA)
- `app/_components/HoverEngine.tsx` - Framer hover variants with FLIP animation
- `app/_components/LinkDelegate.tsx` - nested links Framer renders as `div[href]`
- `app/_components/FormHandler.tsx` + `app/api/newsletter/route.ts` - newsletter form

The earlier Full Site Export output (`app/_components/Home.tsx`, `About.tsx`,
`Solutions.tsx`, `styles.module.css`, `app/globals.css`, ...) is no longer used
by any route and is kept only for reference until it is removed.

Images, fonts and videos are still loaded from Framer's CDN
(`framerusercontent.com`); localising them is a planned step.

## Visual and functional checks

Uses `playwright-core` with the locally installed Microsoft Edge (no browser download).

```bash
# site must be running on :3000 (dev or production)
node visual-audit/scripts/capture.mjs home,about,feature,pricing,contact,solutions,privacy,notfound 1440x900,390x844
node visual-audit/scripts/functional.mjs
node visual-audit/scripts/hover-check.mjs
node visual-audit/scripts/links-check.mjs [--external]   # every link vs lib/links.ts, nav/menu/back/forward
node visual-audit/scripts/footer-check.mjs               # one footer per page, newsletter form behaviour
node visual-audit/scripts/footer-capture.mjs after home,about,feature,pricing,contact,solutions,privacy
```

`convert.mjs` and `links-check.mjs` import `lib/links.ts` directly (Node strips
the types); Node prints a one-line "module type" warning, which is harmless
(set `NODE_NO_WARNINGS=1` to hide it).

Screenshots land in `visual-audit/{reference,localhost,comparison}/` and a
summary in `visual-audit/report.json`.

## Deployment

Any Node host that runs `npm run build && npm run start`, or Vercel (zero
config). Set `NEWSLETTER_WEBHOOK_URL` in the host's environment. Nothing has been
pushed or deployed.
