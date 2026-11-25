// Converts the published Framer pages (server-rendered HTML) into Next.js
// server components + one global stylesheet.
//
//   node tools/framer-import/fetch.mjs      # refresh tools/framer-import/source/*.html
//   node tools/framer-import/convert.mjs    # regenerate app/_framer/**
//
// What it produces (all generated - do not hand-edit, re-run instead):
//   app/_framer/pages/<page>.tsx    page body (everything inside the layout template)
//   app/_framer/NavigationBar.tsx   the shared navbar markup (desktop/tablet/phone variants)
//   app/_framer/Footer.tsx          the shared footer markup (desktop/tablet/phone variants)
//   app/_framer/SvgTemplates.tsx    shared <symbol> sprites referenced by <use href="#...">
//   app/_framer/framer.css          Framer's CSS, merged and de-duplicated across pages
//   app/_framer/appear.css          entrance animations from Framer's appear data
//   app/_framer/meta.ts             per-page <title>/description/OG taken from the page head
import { JSDOM } from "jsdom"
import fs from "node:fs"
import path from "node:path"
import { OFFICIAL_LINKS } from "../../lib/links.ts"

const SRC = path.resolve("tools/framer-import/source")
const OUT = path.resolve("app/_framer")
const PAGES = { home: "Home", about: "About", feature: "Feature", pricing: "Pricing", contact: "Contact", solutions: "Solutions", privacy: "Privacy", notfound: "NotFound" }
const SVG_NS = "http://www.w3.org/2000/svg"

fs.mkdirSync(path.join(OUT, "pages"), { recursive: true })

// ---------------------------------------------------------------- CSS -----
/** Split a stylesheet into top-level blocks (rules, @media, @font-face ...). */
function splitCss(css) {
  const blocks = []
  let depth = 0, start = 0, q = null
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue }
    if (c === '"' || c === "'") { q = c; continue }
    if (c === "/" && css[i + 1] === "*") { const e = css.indexOf("*/", i + 2); i = e < 0 ? css.length : e + 1; continue }
    if (c === "{") depth++
    else if (c === "}") { depth--; if (depth === 0) { blocks.push(css.slice(start, i + 1).trim()); start = i + 1 } }
    else if (c === ";" && depth === 0) { const s = css.slice(start, i + 1).trim(); if (s) blocks.push(s); start = i + 1 }
  }
  return blocks.filter(Boolean)
}
const cssSeen = new Set(), cssOut = []
function addCss(text) {
  for (const b of splitCss(text)) {
    // Framer's own chrome - not part of the site.
    if (/__framer-badge|#__framer-editorbar|framer-editor/.test(b)) continue
    if (/^@import/.test(b) && cssSeen.has(b)) continue
    if (cssSeen.has(b)) continue
    cssSeen.add(b); cssOut.push(b)
  }
}

// --------------------------------------------------------------- JSX ------
const ATTR = { class: "className", for: "htmlFor", tabindex: "tabIndex", srcset: "srcSet", crossorigin: "crossOrigin",
  fetchpriority: "fetchPriority", autoplay: "autoPlay", playsinline: "playsInline", frameborder: "frameBorder",
  allowfullscreen: "allowFullScreen", referrerpolicy: "referrerPolicy", colspan: "colSpan", rowspan: "rowSpan",
  maxlength: "maxLength", minlength: "minLength", autocomplete: "autoComplete", enctype: "encType", contenteditable: "contentEditable",
  spellcheck: "spellCheck", datetime: "dateTime", readonly: "readOnly", novalidate: "noValidate", "accept-charset": "acceptCharset",
  inputmode: "inputMode", enterkeyhint: "enterKeyHint", "xlink:href": "xlinkHref", "xml:space": "xmlSpace", "xmlns:xlink": "xmlnsXlink",
  "http-equiv": "httpEquiv", value: "defaultValue", checked: "defaultChecked", popovertarget: "popoverTarget" }
const BOOL = new Set(["muted", "loop", "autoplay", "playsinline", "controls", "hidden", "disabled", "allowfullscreen", "readonly", "required", "checked", "selected", "multiple", "novalidate", "open", "defer", "async"])
const VOID = new Set(["img", "br", "hr", "input", "source", "meta", "link", "area", "col", "embed", "track", "wbr"])
const DROP_ATTR = /^(data-framer-hydrate-v2|data-framer-ssr-released-at|data-framer-page-optimized-at|data-framer-generated-page|data-framer-page-link-current|data-framer-page-link-target|data-selection|data-framer-component-type-hidden)$/

const camel = s => s.replace(/^-(webkit|moz|ms|o)-/, (_, v) => (v === "ms" ? "ms" : v[0].toUpperCase() + v.slice(1)) + "-").replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const str = v => (/["&{}\n\\<>]/.test(v) ? `{${JSON.stringify(v)}}` : `"${v}"`)

function parseStyle(text) {
  const out = []
  let depth = 0, q = null, cur = ""
  for (const c of text) {
    if (q) { if (c === q) q = null } else if (c === '"' || c === "'") q = c
    else if (c === "(") depth++
    else if (c === ")") depth--
    else if (c === ";" && depth === 0) { out.push(cur); cur = ""; continue }
    cur += c
  }
  out.push(cur)
  const decls = out.map(d => { const i = d.indexOf(":"); return i < 0 ? null : [d.slice(0, i).trim(), d.slice(i + 1).trim()] }).filter(d => d && d[0] && d[1] !== "")
  // A property set twice (e.g. an override appended by a prep step): the last one wins, as in CSS.
  return [...new Map(decls.map(d => [d[0], d])).values()]
}
// Plain numbers become JS numbers (React treats zIndex/opacity/lineHeight etc. as unitless);
// custom properties stay strings. The cast lets Framer's --custom-properties through.
const styleVal = (k, v) => (!k.startsWith("--") && /^-?\d*\.?\d+$/.test(v) ? String(+v) : JSON.stringify(v))
const styleObj = decls => `{{ ${decls.map(([k, v]) => `${k.startsWith("--") ? JSON.stringify(k) : camel(k)}: ${styleVal(k, v)}`).join(", ")} } as CSSProperties}`

// ------------------------------------------------------------ links -------
// Official destinations live in lib/links.ts. A link whose URL equals one of
// those values is emitted as a reference (href={OFFICIAL_LINKS.app.signup}), so
// changing the config file changes the site without re-running the converter.
const linkPaths = new Map() // value -> "app.signup"
for (const [group, values] of Object.entries(OFFICIAL_LINKS)) for (const [k, v] of Object.entries(values)) if (!linkPaths.has(v)) linkPaths.set(v, `${group}.${k}`)
let usesLinks = false
const hrefJsx = v => { const p = linkPaths.get(v); if (p) { usesLinks = true; return `{OFFICIAL_LINKS.${p}}` } return str(v) }
const L = OFFICIAL_LINKS
// URLs Framer uses for the same official destinations (or that were outdated).
const HREF_ALIASES = {
  "https://www.postsynq.in": L.postsynq.website,
  "https://atspeedinnovations.com": L.atspeed.website,
  "mailto:support@postsynq.in": L.postsynq.mailto, // outdated public contact address
}
// Visible text that is really a contact detail (exact text node match only).
const TEXT_ALIASES = { "support@postsynq.in": "postsynq.email" }

/** Turn a Framer layer into a link without changing its classes, styles or children. */
function asLink(el, href, label) {
  const doc = el.ownerDocument
  let a = el
  if (el.localName !== "a") {
    a = doc.createElement("a")
    for (const at of [...el.attributes]) a.setAttribute(at.name, at.value)
    while (el.firstChild) a.appendChild(el.firstChild)
    el.replaceWith(a)
  }
  a.setAttribute("href", href)
  if (/^https?:/.test(href)) a.setAttribute("target", "_blank") // external profiles open in a new tab
  if (label && !a.textContent.trim()) a.setAttribute("aria-label", label)
  return a
}
/** Turn a link layer into a plain container (keeps classes/styles/children). */
function unLink(el) {
  const d = el.ownerDocument.createElement("div")
  for (const at of [...el.attributes]) if (!["href", "target", "rel", "tabindex"].includes(at.name)) d.setAttribute(at.name, at.value)
  while (el.firstChild) d.appendChild(el.firstChild)
  el.replaceWith(d)
  return d
}
const named = (root, re) => [...root.querySelectorAll("[data-framer-name]")].filter(e => re.test(e.getAttribute("data-framer-name")))
const SOCIAL = { Instagram: "instagram", Facebook: "facebook", LinkedIn: "linkedin" }

function prepLinks(doc, key) {
  const main = doc.getElementById("main")
  let n = 0
  for (const el of main.querySelectorAll("[href]")) {
    const v = el.getAttribute("href")
    if (HREF_ALIASES[v]) { el.setAttribute("href", HREF_ALIASES[v]); n++ }
  }

  // Footer: "Social" row = PostSynq accounts, "Follow AtSpeed" row = AtSpeed Innovations accounts.
  for (const footer of main.querySelectorAll("[data-framer-name='Footer'] footer")) {
    for (const [rowName, org, orgName] of [["Social", "postsynq", "PostSynq"], ["Follow AtSpeed", "atspeed", "AtSpeed Innovations"]]) {
      for (const row of named(footer, new RegExp(`^${rowName}$`))) {
        for (const [layer, keyName] of Object.entries(SOCIAL))
          for (const el of named(row, new RegExp(`^${layer}$`))) { asLink(el, L[org][keyName], `${orgName} on ${layer}`); n++ }
        for (const el of named(row, /^Mail$/)) { asLink(el, L[org].mailto, `Email ${orgName}`); n++ }
      }
    }
  }

  // Contact page card: Framer linked the whole card (social logos + phone) to
  // /pricing. The card becomes a plain container; each logo with an official
  // profile becomes its own link and the phone line becomes a tel: link.
  // X, YouTube and TikTok have no official profile yet and stay unlinked.
  if (key === "contact") {
    for (const card of [...main.querySelectorAll("a")].filter(a => a.querySelector("[data-framer-name='instagram logo']"))) {
      const box = unLink(card)
      for (const [layer, keyName] of Object.entries(SOCIAL)) {
        for (const logo of named(box, new RegExp(`^${keyName} logo$`))) {
          const holder = logo.parentElement?.getAttribute("data-framer-name") === "User" ? logo.parentElement : logo
          asLink(holder, L.postsynq[keyName], `PostSynq on ${layer}`); n++
        }
      }
      for (const p of box.querySelectorAll("p")) {
        if (p.textContent.trim() === `Call ${L.postsynq.phone}`) { asLink(p.closest("[data-framer-component-type='RichTextContainer']") ?? p, L.postsynq.tel); n++ }
      }
    }
  }

  // Icon-only links need a name for screen readers (no visual change).
  for (const a of main.querySelectorAll("a[href]")) {
    if (a.textContent.trim() || a.hasAttribute("aria-label")) continue
    const h = a.getAttribute("href")
    const label = h === "./" || h === "/" ? "PostSynq home" : h === L.postsynq.website ? "PostSynq website" : h === L.postsynq.mailto ? "Email PostSynq" : h === L.atspeed.website ? "Visit AtSpeed Innovations website"
      : /linkedin\.com/.test(h) ? "LinkedIn" : null
    if (label) a.setAttribute("aria-label", label)
  }
  // New-tab external links: no opener access. mailto:/tel: open the mail/phone app, not a tab.
  for (const a of main.querySelectorAll("a[href]")) {
    const h = a.getAttribute("href")
    if (/^(mailto|tel):/.test(h)) { a.removeAttribute("target"); continue }
    if (a.getAttribute("target") === "_blank" && /^https?:/.test(h)) a.setAttribute("rel", "noopener noreferrer")
  }
  return n
}

// ---------------------------------------------------------- founder -------
// About page founder statement ("Quote Video" section). In Framer the photo is a
// video component (thumbnail + play button + dark gradient) and the avatar is a
// placeholder. Here the photo is a plain static image of the founder (stored in
// public/assets/team/, not on Framer's CDN), the avatar is the same photo cropped
// to the face, and the name is the full name. Quote, layout, sizes, corner radius,
// badge and entrance animation are left exactly as Framer renders them.
const FOUNDER = {
  name: "Preetham Kotha",
  shortName: "Preetham", // the name as it appears in the Framer design
  photo: "/assets/team/preetham-kotha.webp", // 1254x1254, from preetham-kotha.png (original)
  photo640: "/assets/team/preetham-kotha-640.webp",
  alt: "Preetham Kotha, founder of AtSpeed Innovations, speaking into a microphone",
  // Face-centred crop of the square photo for the small circular avatar.
  avatarCrop: "transform:scale(2);transform-origin:60% 18%",
}
function prepFounder(doc) {
  let n = 0
  for (const section of doc.querySelectorAll("#main section[data-framer-name='Quote Video']")) {
    // Name: "Preetham" -> "Preetham Kotha" (same element, same text style).
    for (const h of section.querySelectorAll("[data-framer-name='Author'] h1,[data-framer-name='Author'] h2,[data-framer-name='Author'] h3,[data-framer-name='Author'] h4,[data-framer-name='Author'] h5,[data-framer-name='Author'] h6,[data-framer-name='Author'] p")) {
      const t = [...h.childNodes].find(c => c.nodeType === 3 && c.nodeValue.trim() === FOUNDER.shortName)
      if (t) { t.nodeValue = t.nodeValue.replace(FOUNDER.shortName, FOUNDER.name); n++ }
    }
    // Avatar: founder photo cropped to the face inside the existing circle; the
    // PostSynq badge ("Company") next to it is untouched.
    for (const img of section.querySelectorAll("[data-framer-name='Avatar'] > [data-framer-background-image-wrapper] > img")) {
      img.setAttribute("src", FOUNDER.photo640)
      img.removeAttribute("srcset"); img.removeAttribute("sizes")
      img.setAttribute("width", "640"); img.setAttribute("height", "640")
      img.setAttribute("alt", FOUNDER.name)
      img.setAttribute("style", `${img.getAttribute("style") || ""};${FOUNDER.avatarCrop}`)
      const wrap = img.parentElement
      wrap.setAttribute("style", `${wrap.getAttribute("style") || ""};overflow:hidden`)
      n++
    }
    // Photo: the video component becomes a static, non-interactive image.
    for (const box of section.querySelectorAll("[data-framer-name='Video']")) {
      box.setAttribute("data-framer-name", "Photo")
      if (box.getAttribute("name") === "Video") box.setAttribute("name", "Photo")
      for (const v of box.querySelectorAll("[data-highlight], [tabindex]")) { v.removeAttribute("data-highlight"); v.removeAttribute("tabindex") }
      for (const v of [box, ...box.querySelectorAll("*")]) {
        if (v.getAttribute("name") === "Video") v.setAttribute("name", "Photo")
        if (/\bframer-v-/.test(v.getAttribute("class") || "")) v.setAttribute("style", `${v.getAttribute("style") || ""};cursor:auto`)
      }
      box.querySelectorAll("[data-framer-name='Play Button'], [data-framer-name='Overlay']").forEach(e => e.remove())
      for (const img of box.querySelectorAll("[data-framer-background-image-wrapper] > img")) {
        img.setAttribute("src", FOUNDER.photo)
        img.setAttribute("srcset", `${FOUNDER.photo640} 640w, ${FOUNDER.photo} 1254w`)
        img.setAttribute("width", "1254"); img.setAttribute("height", "1254")
        img.setAttribute("alt", FOUNDER.alt)
      }
      n++
    }
  }
  return n
}

// ------------------------------------------------------------- team -------
// About page leadership team ("Team" section): the Framer design still carries
// placeholder names/roles and LinkedIn/website/email buttons pointing at
// placeholder URLs. Cards keep their portraits, order, layout and animation;
// names and roles become the real ones and the "Links" row is removed from
// the markup (no hidden or empty controls left behind).
// `from` is the name in the Framer design; a card that is not found stops the
// conversion so a changed design is noticed instead of silently half-updated.
const TEAM = [
  { from: "Preetham", name: "Preetham Kotha", role: "Founder" },
  { from: "Jessica Hayes", name: "Abinesh S", role: "Co-Founder and CTO" },
  { from: "Constanza Perez", name: "Sanghasheela K", role: "Head Product Design" },
  { from: "Meera Desai", name: "Harikrishnan V", role: "Head of Engineering" },
]
function prepTeam(doc, key) {
  let n = 0
  for (const section of doc.querySelectorAll("#main section[data-framer-name='Team']")) {
    const cards = [...section.querySelectorAll("[data-framer-name='List'] [data-framer-name='Avatar']")].map(a => a.parentElement)
    const textOf = el => [...el.querySelectorAll("[data-framer-name='Title'] p, [data-framer-name='Title'] h1, [data-framer-name='Title'] h2, [data-framer-name='Title'] h3, [data-framer-name='Title'] h4, [data-framer-name='Title'] h5, [data-framer-name='Title'] h6")]
    TEAM.forEach((m, i) => {
      const card = cards[i]
      const [nameEl, roleEl] = card ? textOf(card) : []
      if (!nameEl || nameEl.textContent.trim() !== m.from) throw new Error(`${key}: team card ${i + 1} is "${nameEl?.textContent.trim()}", expected "${m.from}" - check TEAM in convert.mjs`)
      const setText = (el, text) => {
        const t = [...el.childNodes].find(c => c.nodeType === 3 && c.nodeValue.trim())
        if (t) t.nodeValue = text; else el.textContent = text
      }
      setText(nameEl, m.name)
      if (roleEl) setText(roleEl, m.role)
      card.querySelectorAll("[data-framer-name='Avatar'] img").forEach(img => img.setAttribute("alt", m.name))
      card.querySelectorAll("[data-framer-name='Links']").forEach(row => row.remove())
      n++
    })
  }
  return n
}

// ------------------------------------------------------------- home -------
// Homepage copy (content replacement only). Every entry swaps the text of an
// existing Framer text element, in all breakpoint variants; nothing is added,
// removed, moved or restyled. Each original text must be found, otherwise the
// conversion stops: a changed Framer design is noticed instead of being
// silently half-updated. Runs before the text animations are prepared, so the
// scroll-reveal paragraph animates the new words.
const HOME_COPY = [
  // [section (data-framer-name), original text, new text]
  // 1. Hero (heading unchanged: "You Run Your Business. We Run Your Socials.")
  ["Hero", "Create once and post to every social platform in one go. Synq AI writes, designs and plans the rest.",
    "Running a business leaves little time for social media. PostSynq uses AI to create, plan, design and publish your content, so you can focus on growing your business."],
  // 2. Platform logos heading
  ["Hero", "Publish everywhere your customers already are", "Reach your customers across multiple social media platforms."],
  // 4. Main features (heading: see HOME_HEADINGS)
  ["Features Small", "Post everywhere in one go", "Publish across multiple channels"],
  ["Features Small", "Create once, customise it for each platform, and publish to all of them together.",
    "Create once, customise for each platform and publish across your connected social media channels."],
  ["Features Small", "Calendar, done for you", "AI-powered content calendar"],
  ["Features Small", "We plan a full calendar of posts for you. Approve them and they go live.",
    "Get a personalised content plan for your business. Review, approve and let PostSynq publish it."],
  ["Features Small", "Synq AI creates your posts", "Create content with Synq AI"],
  // This description is two text lines in the design; the new copy keeps the split.
  ["Features Small", "Tell Synq AI what you need, and it", "Share your ideas with Synq AI and let it"],
  ["Features Small", "writes and designs the post for you.", "write and design social media content for your brand."],
  // 5. Automation
  ["Features Big", "automations", "AI-POWERED AUTOMATION"],
  ["Features Big", "Your social media, on autopilot", "Let AI create, manage and publish your social media content."],
  ["Features Big", "Vectorize & customise", "AI content creation"],
  ["Features Big", "Turn any post into an editable vector, then change colours, text and layout.", "Generate and customise editable social media designs that match your brand."],
  ["Features Big", "Made from your references", "Personalised brand content"],
  ["Features Big", "Share your own photos and videos and get posts built around them.", "Turn your own photos, videos and references into engaging social media posts."],
  ["Features Big", "Ready-made templates", "Ready-to-use templates"],
  ["Features Big", "Carousels and posts already designed. Just add your details.", "Create professional posts and carousels without starting from scratch."],
  ["Features Big", "You approve, we post", "Automated publishing"],
  ["Features Big", "Nothing goes live until you say yes. Then it posts everywhere.", "Approve your content and let PostSynq publish across connected channels."],
  // 6. Content planning (heading: see HOME_HEADINGS)
  ["Features Big", "built for small businesses", "AI-POWERED CONTENT PLANNING"],
  ["Features Big", "Business-stage plans", "Personalised content plans"],
  ["Features Big", "Pick a plan made for aspirants, early-stage or growing brands.", "Get content plans tailored to your business stage and marketing goals."],
  ["Features Big", "Your tone, your brand", "Consistent brand voice"],
  ["Features Big", "Choose a tone once and every caption sounds like you.", "Set your brand preferences once and keep every post aligned with your identity."],
  ["Features Big", "Synq AI agent", "Your Synq AI agent"],
  ["Features Big", "Tell it what you need. It writes, designs and schedules.", "Let AI write, design, plan and schedule content for your business."],
  ["Features Big", "Clear insights", "Actionable social insights"],
  ["Features Big", "Know what works and post more of it.", "Understand what works and improve your social media content strategy."],
  // 7. Business benefits (heading: see HOME_HEADINGS)
  ["Integrations", "Connect your accounts once, then post to all of them in one go.",
    "Connect your social media accounts once and manage your content and publishing from one platform."],
  // 8. AI content demonstration
  ["Features Detail", "Make social media simpler", "Turn your ideas into ready-to-publish social media content."],
  ["Features Detail", "Share a photo, a video or an idea. Synq AI turns it into ready-to-post content.",
    "Share a photo, video or idea. Synq AI creates branded designs, captions and content for your social media channels."],
  // 9. Early access (heading: see HOME_HEADINGS)
  ["Links", "Early access to every PostSynq feature. Choose where to start.",
    "Join our first 100 users and explore how PostSynq simplifies your social media workflow."],
  // 10. Onboarding
  ["Features", "Get started in three simple steps", "Automate your social media in three simple steps."],
  ["Features", "1. Sign up & log in", "1. Create your account"],
  ["Features", "Create your account at postsynq.in, then log in to your PostSynq dashboard.", "Sign up and log in to your PostSynq dashboard."],
  ["Features", "Link Instagram, Facebook, LinkedIn, X and Pinterest in a few clicks.", "Connect your supported social media accounts and set up your brand."],
  ["Features", "Synq AI prepares your posts and calendar. Approve them and they go out everywhere.",
    "Let Synq AI prepare your content. Review, approve and publish across connected channels."],
  // 11. Final CTA
  ["Banner", "Automate with PostSynq", "AUTOMATE YOUR SOCIAL MEDIA"],
  ["Banner", "Be one of our first 100.", "Let PostSynq handle your social media."],
]
// Headings made of several text pieces (Framer's heading component, or lines split by <br>):
// [section, original text, new text as the component's spans: [text] or [prefix, highlighted words, suffix]].
// Line breaks (\n) follow the original design's two-line layout.
const HOME_HEADINGS = [
  ["Features Small", "Everything you need, all in one place", ["Manage your entire social media\nworkflow in ", "one place", "."]],
  ["Features Big", "Made for your first year", ["Plan your social media\ncontent and stay consistent as you grow."]],
  ["Integrations", "Less busywork, more real work", ["Spend less time posting and\nmore time growing your business."]],
  ["Links", "Free for our first 100 users.", ["Get early access to AI-powered\nsocial media management."]],
]
// 3. The animated "Why PostSynQ" paragraph (scroll reveal).
const HOME_STORY = ["Why PostSynQ",
  "Most small businesses don’t struggle with their product. They struggle with posting, every platform wants its own version, ideas run out by Wednesday, and nobody knows what to post or when. So the page goes quiet and customers forget. We built PostSynQ to fix that.",
  "Running a business is already a full-time job. Finding content ideas, designing posts, writing captions and managing multiple social media platforms takes time. Inconsistent posting makes it harder to stay visible and connect with customers. We built PostSynq to solve that."]

function must(found, what) { if (!found || (Array.isArray(found) && !found.length)) throw new Error(`home: ${what} not found in the Framer page - update HOME_COPY in convert.mjs`); return found }
const squash = s => s.replace(/\s+/g, " ").trim()
/** Replace every text node whose text (whitespace-normalised) is `from` inside `scope`. */
function swapText(scope, from, to) {
  const out = []
  const w = scope.ownerDocument.createTreeWalker(scope, 4)
  let t
  while ((t = w.nextNode())) if (squash(t.nodeValue) === from) { t.nodeValue = to; out.push(t.parentElement) }
  return must(out, `text "${from}"`)
}

function prepHomeCopy(doc, key) {
  if (key !== "home") return 0
  const root = doc.querySelector("[data-framer-root]")
  // Top-level sections only: inner layers can share a name ("Features Big" contains a "Features" layer).
  const sec = name => must(root.querySelector(`:scope > [data-framer-name="${name}"]`), `section "${name}"`)
  let n = 0
  for (const [name, from, to] of HOME_COPY) n += swapText(sec(name), from, to).length
  for (const [name, from, parts] of HOME_HEADINGS) {
    // <br> line breaks count as spaces when matching.
    const textOf = h => { const c = h.cloneNode(true); c.querySelectorAll("br").forEach(b => b.replaceWith(" ")); return squash(c.textContent) }
    const hs = [...sec(name).querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(h => textOf(h) === from)
    for (const h of must(hs, `heading "${from}"`)) {
      const spans = [...h.children].filter(c => c.localName === "span")
      if (spans.length && parts.length === 3) {
        // Heading component with a highlighted (underlined) phrase: keep the highlight markup.
        must(spans.length === 3 && spans[1].firstElementChild, `highlighted heading "${from}"`)
        spans[0].textContent = parts[0]; spans[1].firstElementChild.textContent = parts[1]; spans[2].textContent = parts[2]
      } else if (spans.length) {
        spans[0].textContent = parts.join(""); spans.slice(1).forEach(s => s.remove())
      } else {
        // Rich-text heading: keep its <br> line breaks, one new line of text per original line.
        const lines = parts.join("").split("\n"), brs = [...h.querySelectorAll("br")]
        must(lines.length === brs.length + 1, `line breaks of heading "${from}"`)
        h.replaceChildren(...lines.flatMap((l, i) => (i < brs.length ? [doc.createTextNode(l), brs[i]] : [doc.createTextNode(l)])))
      }
      n++
    }
  }
  // The paragraph is server-rendered one span per word (span > no-wrap span > one span per
  // character, then a space); the full sentence is its aria-label. Rebuild the same
  // structure from the first word span so the scroll-reveal animation is unchanged.
  const stories = [...sec(HOME_STORY[0]).querySelectorAll("p[aria-label]")].filter(p => squash(p.getAttribute("aria-label")) === HOME_STORY[1])
  for (const p of must(stories, "animated story paragraph")) {
    const word = p.firstElementChild, group = word.firstElementChild, char = group.firstElementChild
    const words = HOME_STORY[2].split(" ")
    const spans = words.map((w, i) => {
      const ws = word.cloneNode(false), g = group.cloneNode(false)
      for (const ch of w) { const c = char.cloneNode(false); c.textContent = ch; g.append(c) }
      ws.append(g)
      if (i < words.length - 1) ws.append(" ")
      return ws
    })
    p.replaceChildren(...spans)
    p.setAttribute("aria-label", HOME_STORY[2])
    n++
  }
  return n
}

// ------------------------------------------------ features: create once ----
// The Features page's "Create once, publish everywhere" section is the v2 design
// from Figma (Vj5CRB8MXjn98WXeIhmnZG, section 1094:2), hand-built in
// app/_components/features/CreateOncePublishEverywhere.tsx. It replaces the
// Framer (v1) section; the section's existing "Start free trial" button moves into
// it unchanged (rendered as the component's children).
let usesCreateOnce = false
function prepCreateOnce(doc, key) {
  if (key !== "feature") return 0
  const root = doc.querySelector("[data-framer-root]")
  const section = [...root.children].find(e => e.localName === "section" && /Create once, publish everywhere/.test(e.textContent))
  if (!section) throw new Error("feature: \"Create once, publish everywhere\" section not found - update prepCreateOnce in convert.mjs")
  const a = section.querySelector("a[href*='signup']")
  if (!a) throw new Error("feature: Start free trial button not found in \"Create once\" section")
  // Outermost wrapper that holds only the button.
  let cta = a
  while (cta.parentElement !== section && cta.parentElement.textContent.trim() === a.textContent.trim()) cta = cta.parentElement
  const slot = doc.createElement("ps-create-once")
  slot.appendChild(cta)
  section.replaceWith(slot)
  return 1
}

let usesLink = false, usesToggle = false, usesFooter = false
function toJsx(node, ind, inToggle = false) {
  const pad = "  ".repeat(ind)
  // Shared footer component instance: rendered by app/_framer/Footer.tsx (see markFooters).
  if (node.__footer) { usesFooter = true; return `${pad}<Footer variant="${node.__footer}" />\n` }
  // Hand-built Features section (see prepCreateOnce); its children are the Framer CTA.
  if (node.nodeType === 1 && node.localName === "ps-create-once") {
    usesCreateOnce = true
    return `${pad}<CreateOncePublishEverywhere>\n${[...node.childNodes].map(c => toJsx(c, ind + 1, inToggle)).join("")}${pad}</CreateOncePublishEverywhere>\n`
  }
  // Click-toggled component: emit <Toggle closed={...} open={...}> (see markToggles).
  if (node.__toggle && !inToggle) {
    const t = node.__toggle
    usesToggle = true
    const props = Object.entries(t.props).map(([k, v]) => `${k}=${str(v)}`).join(" ")
    return `${pad}<Toggle ${props}\n${pad}  closed={\n${toJsx(node, ind + 2, true)}${pad}  }\n${pad}  open={\n${toJsx(t.open, ind + 2, true)}${pad}  }\n${pad}/>\n`
  }
  if (node.nodeType === 3) {
    const t = node.nodeValue
    if (!t) return ""
    if (/^\s+$/.test(t) && t.includes("\n")) return ""
    if (TEXT_ALIASES[t.trim()]) { usesLinks = true; return `${pad}{OFFICIAL_LINKS.${TEXT_ALIASES[t.trim()]}}\n` }
    return pad + (/^[^{}<>&\n"'`]*$/.test(t) && t.trim() === t ? t : `{${JSON.stringify(t)}}`) + "\n"
  }
  if (node.nodeType !== 1) return ""
  const el = node
  const svg = el.namespaceURI === SVG_NS
  let tag = svg ? el.localName : el.localName.toLowerCase()
  if (["script", "noscript", "link", "meta", "template"].includes(tag)) return ""
  if (tag === "style") { addCss(el.textContent); return "" }
  if (el.id === "__framer-badge-container" || el.id === "template-overlay") return ""
  // Framer's highlighted-heading code component always emits <h1>, even for
  // section titles (layers named H3/H4). Keep a single page <h1> - the layer
  // named "H1" - and render the rest as <h2>. Styles are inline, so the look
  // is unchanged.
  if (tag === "h1" && el.hasAttribute("data-demote")) tag = "h2"

  const attrs = []
  let href = null
  for (const a of [...el.attributes]) {
    const n = a.name, v = a.value
    if (DROP_ATTR.test(n) || n.startsWith("on")) continue
    if (svg && n === "weight") continue // Phosphor bookkeeping attribute, not SVG
    if (n === "style") { const d = parseStyle(v); if (d.length) attrs.push(`style=${styleObj(d)}`); continue }
    if (n === "data-demote") continue
    if (n.startsWith("data-") || n.startsWith("aria-")) { attrs.push(`${n}=${str(v)}`); continue }
    // Framer renders links nested inside links as <div href>; its runtime makes them clickable.
    // Keep the destination as data-href - handled by app/_components/LinkDelegate.tsx.
    if (n === "href" && tag !== "a" && !svg) { attrs.push(`data-href=${hrefJsx(v.replace(/^\.\//, "/"))}`); continue }
    if (tag === "a" && n === "href") {
      href = v
      if (/^\.\/?/.test(v) || v.startsWith("/")) href = "/" + v.replace(/^\.?\//, "").replace(/^\.\//, "")
      continue
    }
    let name = ATTR[n.toLowerCase()] ?? (svg ? camel(n) : n.toLowerCase())
    if (name === "defaultValue" && !["input", "textarea", "select"].includes(tag)) name = "value"
    if (name === "defaultChecked" && tag !== "input") name = "checked"
    if (BOOL.has(n.toLowerCase())) { attrs.push(`${name}`); continue }
    if (name === "name" && !["input", "textarea", "select", "form", "button", "iframe", "meta", "slot"].includes(tag)) { attrs.push(`data-name=${str(v)}`); continue }
    if (["tabIndex", "colSpan", "rowSpan", "maxLength", "minLength", "start"].includes(name) && /^-?\d+$/.test(v)) { attrs.push(`${name}={${v}}`); continue }
    attrs.push(`${name}=${str(v)}`)
  }
  if (tag === "a" && href !== null) {
    const internal = href.startsWith("/") && !href.startsWith("//")
    if (internal) { tag = "Link"; usesLink = true }
    attrs.unshift(`href=${hrefJsx(href)}`)
  }
  const open = `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}`
  const kids = [...el.childNodes].map(c => toJsx(c, ind + 1, inToggle)).join("")
  if (!kids || VOID.has(tag)) return `${pad}${open} />\n`
  return `${pad}${open}>\n${kids}${pad}</${tag}>\n`
}

// ------------------------------------------------------- appear effects ---
const appear = {}
function readAppear(doc) {
  const s = doc.getElementById("__framer__appearAnimationsContent")
  if (!s) return
  Object.assign(appear, JSON.parse(s.textContent))
}
/** Framer specifies springs by visual duration + bounce; approximate with a cubic-bezier. */
function easing(t = {}) {
  if (t.type === "spring") {
    const b = t.bounce ?? 0.25
    return { dur: (t.duration ?? 0.4) * 1.3, ease: `cubic-bezier(0.25, ${(1 + b * 1.1).toFixed(2)}, 0.5, 1)` }
  }
  if (Array.isArray(t.ease)) return { dur: t.duration ?? 0.3, ease: `cubic-bezier(${t.ease.join(", ")})` }
  return { dur: t.duration ?? 0.3, ease: "ease-out" }
}
function transformOf(v) {
  const p = []
  if (v.x) p.push(`translateX(${typeof v.x === "number" ? v.x + "px" : v.x})`)
  if (v.y) p.push(`translateY(${typeof v.y === "number" ? v.y + "px" : v.y})`)
  if (v.scale !== undefined && v.scale !== 1) p.push(`scale(${v.scale})`)
  if (v.rotate) p.push(`rotate(${v.rotate}deg)`)
  if (v.skewX) p.push(`skewX(${v.skewX}deg)`)
  if (v.skewY) p.push(`skewY(${v.skewY}deg)`)
  return p.join(" ") || "none"
}
function appearCss() {
  const rules = [
    "/* Generated from Framer's appear-animation data. html.reveal-js is set by an inline",
    "   script before first paint; without JS (or with reduced motion) nothing is hidden. */",
  ]
  for (const [id, spec] of Object.entries(appear)) {
    const d = spec.default ?? spec
    if (!d?.initial || !d?.animate) continue
    const { dur, ease } = easing(d.animate.transition)
    const delay = d.animate.transition?.delay ?? 0
    rules.push(`html.reveal-js [data-appear="${id}"]:not([data-in]) { opacity: ${d.initial.opacity ?? 1}; transform: ${transformOf(d.initial)}; }`)
    rules.push(`html.reveal-js [data-appear="${id}"] { transition: opacity ${dur.toFixed(2)}s ${ease} ${delay}s, transform ${dur.toFixed(2)}s ${ease} ${delay}s; }`)
  }
  rules.push("@media (prefers-reduced-motion: reduce) { html.reveal-js [data-appear] { opacity: 1 !important; transform: none !important; transition: none !important; } }")
  // Per-word text effect (Pricing / Contact hero headings). Measured on the
  // published pages: each word fades in within ~70ms and rises 8px -> 0 with a
  // spring overshoot to about -2px, settling by ~250ms; words start ~35ms apart.
  rules.push("html.reveal-js [data-words]:not([data-in]) [data-word] { opacity: 0.001; transform: translateY(var(--word-y, 8px)); }")
  rules.push("html.reveal-js [data-words] [data-word] { transition: opacity 0.12s ease-out calc(0.1s + var(--wi, 0) * 35ms), transform 0.45s cubic-bezier(0.3, 1.6, 0.5, 1) calc(0.1s + var(--wi, 0) * 35ms); }")
  rules.push("@media (prefers-reduced-motion: reduce) { html.reveal-js [data-words] [data-word] { opacity: 1 !important; transform: none !important; transition: none !important; } }")
  // Scroll Reveal Paragraph (Home "Why PostSynQ"). --sr = characters revealed (set by
  // ScrollReveal.tsx); each character blends light -> dark over a 6-character soft edge,
  // as measured on the published page. Without JS --sr is unset: all light, like the SSR.
  rules.push("[data-scroll-reveal] [data-ch] { color: color-mix(in srgb, var(--sr-dark, rgb(34, 36, 42)) calc(clamp(0, (var(--sr, 0) - var(--i, 0)) / 6, 1) * 100%), var(--sr-light, rgb(196, 201, 203))); transition: color 0.08s linear; }")
  // Scroll-triggered layer effect (e.g. Solutions "Understand performance" card).
  // Measured: opacity 0 -> 1 and translateY 20px -> 0 over ~0.5s once in view, no overshoot.
  rules.push("html.reveal-js [data-inview]:not([data-in]) { opacity: 0; transform: var(--iv-from, translateY(20px)); }")
  rules.push("html.reveal-js [data-inview] { transition: opacity 0.5s ease-out, transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94); }")
  rules.push("@media (prefers-reduced-motion: reduce) { html.reveal-js [data-inview] { opacity: 1 !important; transform: none !important; transition: none !important; } }")
  return rules.join("\n") + "\n"
}
/**
 * "Scroll Reveal Paragraph" code component (Home, "Why PostSynQ"): every
 * character is a span, server-rendered light grey; Framer's runtime darkens
 * them as the paragraph scrolls through the viewport. Replace the per-span
 * inline colour with an index (--i); app/_components/ScrollReveal.tsx sets the
 * paragraph's progress (--sr) and appear.css turns that into colours.
 */
function prepScrollReveal(doc) {
  let n = 0
  for (const p of doc.querySelectorAll("[data-framer-name='Scroll Reveal Paragraph'] p")) {
    const chars = [...p.querySelectorAll("span[aria-hidden] span span")]
    if (!chars.length) continue
    p.setAttribute("data-scroll-reveal", "")
    const light = parseStyle(chars[0].getAttribute("style") || "").find(([k]) => k === "color")?.[1]
    if (light) p.setAttribute("style", (p.getAttribute("style") || "") + `;--sr-light:${light}`)
    chars.forEach((c, i) => {
      const kept = parseStyle(c.getAttribute("style") || "").filter(([k]) => k !== "color" && k !== "transition")
      kept.push(["--i", String(i)])
      c.setAttribute("style", kept.map(([k, v]) => `${k}:${v}`).join(";"))
      c.setAttribute("data-ch", "")
    })
    n++
  }
  return n
}
/**
 * Framer's scroll-triggered layer effect: server-rendered at inline opacity 0
 * with a translate transform (and no appear id); its runtime animates it once
 * in view. Hand it to RevealWatcher instead, keeping the start transform.
 */
function prepInView(doc) {
  let n = 0
  for (const el of doc.querySelectorAll("[style*='opacity:0']")) {
    if (el.hasAttribute("data-framer-appear-id") || el.hasAttribute("data-reveal")) continue
    const d = parseStyle(el.getAttribute("style") || "")
    const op = d.find(([k]) => k === "opacity")?.[1]
    const tf = d.find(([k]) => k === "transform")?.[1] ?? ""
    if (op !== "0" || !/translate[XY]?\(/.test(tf) || d.some(([k]) => /mask-image/.test(k))) continue
    const kept = d.filter(([k]) => k !== "opacity" && k !== "transform" && k !== "will-change")
    kept.push(["--iv-from", tf])
    el.setAttribute("style", kept.map(([k, v]) => `${k}:${v}`).join(";"))
    el.setAttribute("data-inview", "")
    el.setAttribute("data-reveal", "")
    n++
  }
  return n
}
/**
 * Framer's per-word text effect: the server renders every word as an
 * inline-block span at opacity 0.001 / translateY(Npx) - with no appear id -
 * and its runtime animates them in. Strip that hidden inline state (so the
 * text is visible without JS) and let RevealWatcher + appear.css animate it.
 */
function prepWordEffects(doc) {
  let n = 0
  const WORD = /^translateX\(0px\) translateY\((-?[\d.]+)px\)/
  for (const span of doc.querySelectorAll("span[style*='opacity:0.001']")) {
    const d = parseStyle(span.getAttribute("style") || "")
    const t = d.find(([k]) => k === "transform")?.[1] ?? ""
    if (!d.some(([k, v]) => k === "display" && v === "inline-block") || !WORD.test(t) || span.closest("[data-framer-appear-id]")) continue
    const parent = span.parentElement
    if (!parent.hasAttribute("data-words")) { parent.setAttribute("data-words", ""); parent.setAttribute("data-reveal", ""); parent.__wi = 0 }
    const y = WORD.exec(t)[1]
    const kept = d.filter(([k]) => k !== "opacity" && k !== "transform" && k !== "will-change")
    kept.push(["--wi", String(parent.__wi++)])
    if (y !== "8") kept.push(["--word-y", `${y}px`])
    span.setAttribute("style", kept.map(([k, v]) => `${k}:${v}`).join(";"))
    span.setAttribute("data-word", "")
    n++
  }
  return n
}
/** Strip Framer's SSR initial state and hand the element to RevealWatcher. */
function prepAppear(doc) {
  for (const el of doc.querySelectorAll("[data-framer-appear-id]")) {
    const id = el.getAttribute("data-framer-appear-id")
    el.removeAttribute("data-framer-appear-id")
    el.setAttribute("data-appear", id)
    el.setAttribute("data-reveal", "")
    const kept = parseStyle(el.getAttribute("style") || "").filter(([k, v]) => !(k === "opacity" && v === "0.001") && !(k === "transform" && /^translate[XY]?\(.*\)$|^scale\(.*\)$/.test(v)) && k !== "will-change")
    if (kept.length) el.setAttribute("style", kept.map(([k, v]) => `${k}:${v}`).join(";")); else el.removeAttribute("style")
  }
}

// ------------------------------------------------- runtime components ----
/**
 * Fill containers whose component renders only in the browser with the markup
 * harvest.mjs captured after hydration. SSR holds every breakpoint variant at
 * once; the hydrated page only the active one - so an SSR slot is matched to
 * the n-th occurrence of its class among slots visible at the same breakpoint.
 */
function fillRuntime(doc, key) {
  const file = path.join(SRC, `${key}.runtime.json`)
  if (!fs.existsSync(file)) return 0
  const runtime = JSON.parse(fs.readFileSync(file, "utf8"))
  const hydrate = JSON.parse(doc.querySelector("#main").getAttribute("data-framer-hydrate-v2") || "{}")
  const bpOf = q => (/min-width: 1280px/.test(q) ? "desktop" : /min-width: 810px/.test(q) ? "tablet" : "phone")
  const hashes = { desktop: [], tablet: [], phone: [] }
  for (const b of hydrate.breakpoints ?? []) hashes[bpOf(b.mediaQuery)].push(b.hash)
  const visibleAt = el => {
    const hidden = new Set()
    for (let a = el; a; a = a.parentElement) for (const c of a.classList ?? []) if (c.startsWith("hidden-")) hidden.add(c.slice(7))
    return Object.keys(hashes).filter(bp => !hashes[bp].some(h => hidden.has(h)))
  }
  const counters = {}
  let n = 0
  for (const el of doc.querySelectorAll('[class$="-container"]')) {
    const cls = [...el.classList].find(c => c.endsWith("-container"))
    const only = el.children.length === 1 ? el.children[0] : null
    if (!runtime[cls] || !only || only.tagName !== "DIV" || only.childNodes.length || only.getAttribute("style") !== "display:contents") continue
    let html = null
    for (const bp of visibleAt(el)) {
      const i = (counters[cls + bp] = (counters[cls + bp] ?? -1) + 1)
      html ??= runtime[cls][bp]?.[i] || null
    }
    if (html) { el.innerHTML = html; n++ }
  }
  return n
}

// ------------------------------------------------------------ tickers -----
/**
 * Framer's Ticker server-renders hidden (opacity 0) and its runtime clones the
 * items and animates them. Measured on the published About page: 15 px/s,
 * linear, infinite, leftwards. Recreated in CSS (site.css, [data-ticker]):
 * enough clones to cover the strip, each item shifting by its own width + gap.
 */
const TICKER_PX_PER_S = 15
function prepTickers(doc) {
  let n = 0
  for (const ul of doc.querySelectorAll("section > ul")) {
    const sec = ul.parentElement
    const st = sec.getAttribute("style") || ""
    if (!/mask-image/.test(st) || !/translateX\(-0px\)/.test(ul.getAttribute("style") || "")) continue
    sec.setAttribute("style", st.replace(/opacity:0(;|$)/, "opacity:1$1"))
    const gap = /gap:([\d.]+px)/.exec(ul.getAttribute("style"))?.[1] ?? "0px"
    ul.setAttribute("style", (ul.getAttribute("style") || "").replace(/;?will-change:[^;]*/, "").replace(/;?transform:translateX\(-0px\)/, "") + `;--ticker-gap:${gap}`)
    ul.setAttribute("data-ticker", "")
    const items = [...ul.children]
    for (let k = 0; k < 3; k++) for (const li of items) { const c = li.cloneNode(true); c.setAttribute("aria-hidden", "true"); ul.appendChild(c) }
    n++
  }
  return n
}

// ------------------------------------------------------------ toggles -----
/** Pair closed variants in the SSR with the open markup harvest-states.mjs captured. */
const states = fs.existsSync(path.join(SRC, "states.json")) ? JSON.parse(fs.readFileSync(path.join(SRC, "states.json"), "utf8")) : { faq: {}, nav: {} }
function fragment(doc, html) {
  const t = doc.createElement("template")
  t.innerHTML = html
  return t.content.firstElementChild
}
function markToggles(doc, key) {
  let n = 0
  const faqs = states.faq[key] ?? []
  ;[...doc.querySelectorAll("[data-framer-name='Desktop Closed']")].forEach((el, i) => {
    if (!faqs[i]) return
    el.__toggle = { open: fragment(doc, faqs[i]), props: { kind: "faq" } }
    n++
  })
  for (const [bp, name] of [["tablet", "Tablet"], ["phone", "Mobile"]]) {
    const nav = doc.querySelector(`.framer-wyw7ln-container nav[data-framer-name='${name}']`)
    if (nav && states.nav[bp]) { nav.__toggle = { open: fragment(doc, states.nav[bp]), props: { kind: "menu", trigger: "[data-framer-name='Menu Icon']", closeOn: "a", label: "menu" } }; n++ }
  }
  return n
}

// -------------------------------------------------------------- hover -----
/**
 * Framer hover = class "hover" on the component root (layout rules already in
 * its CSS) + inline-style changes and hover-only layers set by its runtime.
 * From the rest/hover markup harvest-hover.mjs captured we derive:
 *   - CSS for changed inline styles:  .comp.variant.hover .layer { prop: value }
 *   - hover-only layers, inserted into the markup and hidden unless .hover
 *   - data-hover on each root, which HoverEngine.tsx toggles (with FLIP animation)
 */
const hoverData = fs.existsSync(path.join(SRC, "hover.json")) ? JSON.parse(fs.readFileSync(path.join(SRC, "hover.json"), "utf8")) : {}
const hoverCss = []
const hoverOnly = {} // sig -> [{ parentCls, index, html }]
const layerCls = el => [...el.classList].find(c => c.startsWith("framer-") && c !== "framer-text" && !c.startsWith("framer-v-") && !/-container$/.test(c))
{
  const hdoc = new JSDOM("").window.document
  const parse = html => { const t = hdoc.createElement("template"); t.innerHTML = html; return t.content.firstElementChild }
  for (const [sig, { rest, hover }] of Object.entries(hoverData)) {
    const [comp, variant] = sig.split(" ")
    const root = `.${comp}.${variant}.hover`
    hoverOnly[sig] = []
    const walk = (r, h, sel, isRoot = false) => {
      const rs = Object.fromEntries(parseStyle(r.getAttribute("style") || ""))
      const hs = parseStyle(h.getAttribute("style") || "")
      const changed = hs.filter(([k, v]) => rs[k] !== v && !/^(transform|transform-origin|will-change|opacity)$/.test(k))
      if (changed.length) hoverCss.push(`${sel} { ${changed.map(([k, v]) => `${k}: ${v} !important`).join("; ")}; }`)
      const rKids = [...r.children]
      let ri = 0
      ;[...h.children].forEach((hc, hi) => {
        const cls = layerCls(hc)
        const match = rKids.slice(ri).find(rc => rc.tagName === hc.tagName && layerCls(rc) === cls)
        if (match) { ri = rKids.indexOf(match) + 1; if (cls) walk(match, hc, `${root} .${cls}`); return }
        if (cls) hoverOnly[sig].push({ parentCls: isRoot ? null : layerCls(r) ?? null, index: hi, html: hc.outerHTML })
      })
    }
    walk(parse(rest), parse(hover), root, true)
    hoverCss.push(`.${comp}.${variant}:not(.hover) [data-hover-only] { display: none !important; }`)
  }
}
function prepHover(doc) {
  let n = 0
  for (const sig of Object.keys(hoverData)) {
    const [comp, variant] = sig.split(" ")
    for (const el of doc.querySelectorAll(`.${comp}.${variant}`)) {
      el.setAttribute("data-hover", "")
      for (const { parentCls, index, html } of hoverOnly[sig]) {
        const parent = parentCls ? el.querySelector(`.${parentCls}`) : el
        if (!parent || parent.querySelector(":scope > [data-hover-only]")) continue
        const t = doc.createElement("template"); t.innerHTML = html
        const node = t.content.firstElementChild
        node.setAttribute("data-hover-only", "")
        parent.insertBefore(node, parent.children[index] ?? null)
      }
      n++
    }
  }
  return n
}

// ----------------------------------------------------------- footer -------
// The Footer is one Framer component placed at the bottom of every page, with
// desktop/tablet/phone variants. Its markup is emitted once (Footer.tsx); pages
// keep their own wrapper layers (page-specific classes) and render <Footer variant>.
// Instances only differ in <img sizes> hints, which follow each page's breakpoints.
const footerJsx = {} // variant -> { jsx, link, toggle, from }
const footerKey = jsx => jsx.replace(/ sizes=("[^"]*"|\{[^}]*\})/g, "")
// Accessibility for the footer only (no visual change): Framer's newsletter field
// is an unlabelled type=text input. (Icon link names: see prepLinks.)
function prepFooterA11y(footer) {
  for (const form of footer.querySelectorAll("form[data-framer-form]")) {
    // FormHandler validates and reports errors in the form's status line.
    form.setAttribute("novalidate", "")
    for (const input of form.querySelectorAll("input[placeholder]:not([aria-hidden='true'])")) {
      const label = input.getAttribute("placeholder").replace(/\*\s*$/, "").trim()
      if (!input.hasAttribute("aria-label")) input.setAttribute("aria-label", label)
      if (/e-?mail/i.test(label)) { input.setAttribute("type", "email"); input.setAttribute("autocomplete", "email"); input.setAttribute("inputmode", "email") }
    }
  }
}
function markFooters(doc, key) {
  let n = 0
  for (const el of doc.querySelectorAll("#main [data-framer-name='Footer'] footer")) {
    prepFooterA11y(el)
    const variant = (el.getAttribute("data-framer-name") || "").toLowerCase()
    if (!["desktop", "tablet", "mobile"].includes(variant)) throw new Error(`${key}: unknown footer variant "${variant}"`)
    const saved = [usesLink, usesToggle, usesLinks]
    usesLink = false; usesToggle = false; usesLinks = false
    const jsx = toJsx(el, 2)
    const entry = { jsx, link: usesLink, toggle: usesToggle, links: usesLinks, from: key }
    ;[usesLink, usesToggle, usesLinks] = saved
    if (!footerJsx[variant]) footerJsx[variant] = entry
    else if (footerKey(footerJsx[variant].jsx) !== footerKey(jsx))
      throw new Error(`${key}: footer "${variant}" differs from ${footerJsx[variant].from} - the shared Footer would not match this page`)
    el.__footer = variant
    n++
  }
  return n
}

// ------------------------------------------------------------- pages ------
const header = "// GENERATED by tools/framer-import/convert.mjs from the published Framer site - do not edit by hand.\nimport type { CSSProperties } from \"react\"\n"
const meta = {}
const symbols = new Map()
let navJsx = null

for (const [key, name] of Object.entries(PAGES)) {
  const html = fs.readFileSync(path.join(SRC, `${key}.html`), "utf8")
  const doc = new JSDOM(html).window.document
  readAppear(doc)
  const filled = fillRuntime(doc, key)
  // Homepage copy first, so the text animations below are built from the new words.
  const copied = prepHomeCopy(doc, key)
  if (copied) console.log(`${key}: ${copied} text replacements (HOME_COPY in convert.mjs)`)
  prepAppear(doc)
  const words = prepWordEffects(doc)
  if (words) console.log(`${key}: ${words} per-word text-effect spans`)
  const inview = prepInView(doc)
  if (inview) console.log(`${key}: ${inview} scroll-triggered layers`)
  const scrollReveal = prepScrollReveal(doc)
  if (scrollReveal) console.log(`${key}: ${scrollReveal} scroll-reveal paragraphs`)
  prepTickers(doc)
  prepHover(doc)
  const founder = prepFounder(doc)
  if (founder) console.log(`${key}: founder statement updated (${founder} changes)`)
  const team = prepTeam(doc, key)
  if (team) console.log(`${key}: ${team} leadership team cards updated`)
  if (prepCreateOnce(doc, key)) console.log(`${key}: "Create once, publish everywhere" -> CreateOncePublishEverywhere (Figma v2)`)
  const relinked = prepLinks(doc, key)
  const toggles = markToggles(doc, key)
  // One page <h1>: the first heading of the page (and its copies in the other
  // breakpoint variants). Framer's heading component emits <h1> for section
  // titles too - those become <h2>. Inline styles keep the look identical.
  const pageRoot = doc.querySelector("[data-framer-root]")
  const h1s = [...pageRoot.querySelectorAll("h1")]
  const norm = s => s.replace(/\s+/g, " ").trim()
  const primary = h1s[0] ? norm(h1s[0].textContent) : null
  for (const h of h1s) if (norm(h.textContent) !== primary) h.setAttribute("data-demote", "")
  for (const s of doc.querySelectorAll("head style")) addCss(s.textContent)

  const m = n => doc.querySelector(`meta[name="${n}"],meta[property="${n}"]`)?.getAttribute("content") ?? null
  meta[key] = { title: doc.title, description: m("description"), ogImage: m("og:image"), ogTitle: m("og:title"), ogDescription: m("og:description"), twitterCard: m("twitter:card"), icon: doc.querySelector('link[rel="icon"]')?.getAttribute("href") ?? null, appleIcon: doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ?? null }

  for (const sym of doc.querySelectorAll("#svg-templates > [id]")) if (!symbols.has(sym.id)) symbols.set(sym.id, sym)

  const template = doc.querySelector("#main [data-layout-template]")
  const root = template.querySelector(":scope > [data-framer-root]")
  const nav = template.querySelector(":scope > .framer-wyw7ln-container")
  // The template's own <style> children and the page root's inline <style>s.
  for (const s of template.querySelectorAll("style")) addCss(s.textContent)

  const footers = markFooters(doc, key)

  usesLink = false; usesToggle = false; usesFooter = false; usesLinks = false; usesCreateOnce = false
  const body = toJsx(root, 2)
  fs.writeFileSync(path.join(OUT, "pages", `${key}.tsx`),
    header + (usesLink ? 'import Link from "next/link"\n' : "") + (usesToggle ? 'import Toggle from "../../_components/Toggle"\n' : "") +
    (usesFooter ? 'import Footer from "../Footer"\n' : "") + (usesLinks ? 'import { OFFICIAL_LINKS } from "../../../lib/links"\n' : "") +
    (usesCreateOnce ? 'import CreateOncePublishEverywhere from "../../_components/features/CreateOncePublishEverywhere"\n' : "") +
    `\nexport default function ${name}Page() {\n  return (\n${body}  )\n}\n`)

  if (key === "home") {
    usesLink = false; usesToggle = false; usesLinks = false
    // Siblings between root and nav (spacers) belong to the template too.
    const extras = [...template.children].filter(c => c !== root && c !== nav && c.tagName !== "STYLE")
    const extraJsx = extras.map(e => toJsx(e, 2)).join("")
    navJsx = { body: toJsx(nav, 3), extras: extraJsx, link: usesLink, toggle: usesToggle, links: usesLinks, templateClass: template.getAttribute("class"), templateStyle: template.getAttribute("style") }
  }
  console.log(`${key}: ${(body.length / 1024).toFixed(0)} KB jsx, ${filled} runtime slots filled, ${toggles} toggles, ${footers} shared-footer variants, ${relinked} links set from lib/links.ts`)
}

// Shared footer (one component; each page renders it inside its own wrapper layers).
{
  const variants = Object.keys(footerJsx)
  const any = k => variants.some(v => footerJsx[v][k])
  fs.writeFileSync(path.join(OUT, "Footer.tsx"),
    header + (any("link") ? 'import Link from "next/link"\n' : "") + (any("toggle") ? 'import Toggle from "../_components/Toggle"\n' : "") +
    (any("links") ? 'import { OFFICIAL_LINKS } from "../../lib/links"\n' : "") +
    `\nexport type FooterVariant = ${variants.map(v => JSON.stringify(v)).join(" | ")}\n` +
    `\n/**\n * The site footer exactly as Framer server-renders it. Framer emits one copy per\n * breakpoint; the page's wrapper layers show the right one with CSS, so each page\n * renders <Footer variant> once per breakpoint wrapper.\n */\nexport default function Footer({ variant }: { variant: FooterVariant }) {\n` +
    variants.map(v => `  if (variant === ${JSON.stringify(v)}) return (\n${footerJsx[v].jsx}  )\n`).join("") +
    `  return null\n}\n`)
  console.log(`footer: ${variants.join(", ")} variants -> Footer.tsx`)
}

// Shared navbar (rendered once, in app/layout.tsx).
fs.writeFileSync(path.join(OUT, "NavigationBar.tsx"),
  header + (navJsx.link ? 'import Link from "next/link"\n' : "") + (navJsx.toggle ? 'import Toggle from "../_components/Toggle"\n' : "") +
  (navJsx.links ? 'import { OFFICIAL_LINKS } from "../../lib/links"\n' : "") +
  `\n/** The navbar exactly as Framer server-renders it: desktop, tablet and phone variants, switched by CSS breakpoints. */\nexport default function NavigationBar() {\n  return (\n${navJsx.body}  )\n}\n` +
  `\n/** Empty layout-template siblings Framer renders between the page and the navbar. */\nexport function TemplateExtras() {\n  return (\n    <>\n${navJsx.extras}    </>\n  )\n}\n` +
  `\nexport const templateClassName = ${JSON.stringify(navJsx.templateClass)}\n`)

// SVG sprites.
const symDoc = new JSDOM("").window.document
const spriteSvg = symDoc.createElement("div")
spriteSvg.id = "svg-templates"
spriteSvg.setAttribute("style", "position:absolute;overflow:hidden;bottom:0;left:0;width:0;height:0;z-index:0;contain:strict")
spriteSvg.setAttribute("aria-hidden", "true")
for (const s of symbols.values()) spriteSvg.appendChild(symDoc.importNode(s, true))
fs.writeFileSync(path.join(OUT, "SvgTemplates.tsx"), header + `\nexport default function SvgTemplates() {\n  return (\n${toJsx(spriteSvg, 2)}  )\n}\n`)

// De-duplicating across pages can move a base rule after a breakpoint override
// it was meant to precede. Framer's @media blocks are always overrides, so emit
// them last (stable order within each group); @import/@font-face stay first.
const rank = b => (/^@import/.test(b) ? 0 : /^@font-face/.test(b) ? 1 : /^@media/.test(b) && !/prefers-/.test(b) ? 3 : 2)
const ordered = cssOut.map((b, i) => [b, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0])
fs.writeFileSync(path.join(OUT, "framer.css"), "/* GENERATED by tools/framer-import/convert.mjs - Framer's stylesheet, merged across pages. */\n" + ordered.join("\n") + "\n")
fs.writeFileSync(path.join(OUT, "appear.css"), appearCss())
fs.writeFileSync(path.join(OUT, "hover.css"), "/* GENERATED by tools/framer-import/convert.mjs from Framer hover variants (see HoverEngine.tsx). */\n" +
  "[data-hover], [data-hover] * { transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease; }\n" +
  "@media (prefers-reduced-motion: reduce) { [data-hover], [data-hover] * { transition: none; } }\n" + hoverCss.join("\n") + "\n")
fs.writeFileSync(path.join(OUT, "meta.ts"), header + `\nexport const pageMeta = ${JSON.stringify(meta, null, 2)} as const\n`)
console.log(`css: ${cssOut.length} blocks, ${(cssOut.join("\n").length / 1024).toFixed(0)} KB; appear ids: ${Object.keys(appear).length}; svg symbols: ${symbols.size}`)
