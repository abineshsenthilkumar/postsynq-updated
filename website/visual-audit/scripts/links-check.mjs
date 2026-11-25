// Site-wide link audit and functional link tests (localhost).
// Usage: node visual-audit/scripts/links-check.mjs [--external]
//   --external  also request the official external URLs (social sites may
//               block automated requests; those results are informational).
// Writes the full inventory to visual-audit/links-report.json.
import { chromium } from "playwright-core"
import fs from "node:fs"
import { OFFICIAL_LINKS as L } from "../../lib/links.ts"

const LOC = process.env.LOCAL_URL || "http://localhost:3000"
const ROUTES = { home: "/", about: "/about", feature: "/feature", pricing: "/pricing", contact: "/contact", solutions: "/solutions", privacy: "/privacy" }
let pass = 0, fail = 0
const check = (ok, label, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + detail : ""}`) }
const browser = await chromium.launch({ channel: "msedge" })

const collect = page => page.evaluate(() => {
  const vis = e => !!e.getClientRects().length && getComputedStyle(e).visibility === "visible"
  const area = e => e.closest("[data-framer-name='Footer']") ? "footer" : e.closest("nav") ? "nav" : "page"
  return [...document.querySelectorAll("#main a[href], #main [data-href]")].filter(vis).map(e => ({
    area: area(e), tag: e.tagName.toLowerCase(),
    name: (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) || "[unnamed]",
    href: e.getAttribute("href") ?? e.getAttribute("data-href"), target: e.getAttribute("target"), rel: e.getAttribute("rel"),
    nested: !!e.parentElement?.closest("a, button"),
  }))
})
const visibleText = page => page.evaluate(() => document.getElementById("main").innerText)

const inventory = {}
const internal = new Set()
for (const [key, route] of Object.entries(ROUTES)) for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()) })
  await page.goto(LOC + route, { waitUntil: "networkidle", timeout: 120000 })
  const links = await collect(page)
  const text = await visibleText(page)
  inventory[`${key}@${w}`] = links
  for (const l of links) if (l.href.startsWith("/")) internal.add(l.href.split("#")[0] || "/")
  const tag = `${key}@${w}`
  const bad = links.filter(l => !l.href || l.href === "#" || /^javascript:/i.test(l.href) || /framer\.website|postsync\.in|support@postsynq\.in/i.test(l.href))
  check(!bad.length, `${tag}: no empty/#/javascript:/Framer/outdated hrefs`, bad.map(b => `${b.name} -> ${b.href}`).join(", "))
  const noRel = links.filter(l => l.target === "_blank" && !/noopener/.test(l.rel || ""))
  check(!noRel.length, `${tag}: new-tab links have rel=noopener`, noRel.map(b => `${b.name} -> ${b.href}`).join(", "))
  const blankMail = links.filter(l => /^(mailto|tel):/.test(l.href) && l.target)
  check(!blankMail.length, `${tag}: mailto/tel links open the mail/phone app (no target)`)
  check(!links.some(l => l.nested), `${tag}: no links nested inside links/buttons`, links.filter(l => l.nested).map(l => l.name).join(", "))
  check(!links.some(l => l.tag !== "a" && l.tag !== "link" && !/^https?:|^\//.test(l.href)), `${tag}: div-links point to valid destinations`)
  const unnamed = links.filter(l => l.name === "[unnamed]" && !/framer\.com/.test(l.href))
  check(!unnamed.length, `${tag}: every link has an accessible name`, unnamed.map(l => l.href).join(", "))
  if (key !== "privacy") check(!/support@postsynq\.in/.test(text), `${tag}: outdated support@postsynq.in not displayed`)
  check(!errors.length, `${tag}: no console errors`, errors.slice(0, 2).join(" | "))

  // Destination checks
  const has = (area, name, href, target) => links.some(l => l.area === area && (name instanceof RegExp ? name.test(l.name) : l.name === name) && l.href === href && (target === undefined || l.target === target))
  const expect = (area, name, href, target) => check(has(area, name, href, target), `${tag}: ${area} "${name}" -> ${href}${target ? " (new tab)" : ""}`)
  expect("footer", "PostSynq on Instagram", L.postsynq.instagram, "_blank")
  expect("footer", "PostSynq on Facebook", L.postsynq.facebook, "_blank")
  expect("footer", "PostSynq on LinkedIn", L.postsynq.linkedin, "_blank")
  expect("footer", "Email PostSynq", L.postsynq.mailto)
  expect("footer", "AtSpeed Innovations on Instagram", L.atspeed.instagram, "_blank")
  expect("footer", "AtSpeed Innovations on Facebook", L.atspeed.facebook, "_blank")
  expect("footer", "AtSpeed Innovations on LinkedIn", L.atspeed.linkedin, "_blank")
  expect("footer", "Email AtSpeed Innovations", L.atspeed.mailto)
  expect("footer", "AtSpeed Innovations", L.atspeed.website, "_blank")
  expect("footer", /^Visit AtSpeed/, L.atspeed.website, "_blank")
  expect("footer", /^Free trial/, L.app.signup, "_blank")
  expect("footer", "Log in", L.app.login, "_blank")
  expect("footer", "Dashboard", L.app.dashboard, "_blank")
  expect("footer", "Terms of service", L.app.terms, "_blank")
  expect("footer", "Features", "/feature")
  if (w === 1440) { expect("nav", /Log in/, L.app.login); expect("nav", /Start free trial/, L.app.signup); expect("nav", "Features", "/feature") }
  if (key === "contact") {
    expect("page", "PostSynq on Instagram", L.postsynq.instagram, "_blank")
    expect("page", "PostSynq on Facebook", L.postsynq.facebook, "_blank")
    expect("page", "PostSynq on LinkedIn", L.postsynq.linkedin, "_blank")
    expect("page", `Call ${L.postsynq.phone}`, L.postsynq.tel)
    expect("page", new RegExp(L.postsynq.email.replace(/\./g, "\\.")), L.postsynq.mailto)
    check(!links.some(l => /instagram logo|Call \+91/.test(l.name) && l.href === "/pricing"), `${tag}: contact card no longer links to /pricing`)
  }
  if (key === "pricing") for (const plan of ["Basic", "Growth", "Business"]) expect("page", new RegExp(`Choose ${plan}`), L.app.signup)
  if (key === "about") {
    // The leadership team cards have no social, website or email links.
    const teamLinks = await page.locator("section[data-framer-name='Team'] a, section[data-framer-name='Team'] [href], section[data-framer-name='Team'] [data-href]").count()
    check(teamLinks === 0, `${tag}: leadership team cards have no links`, `${teamLinks} found`)
  }
  await page.close()
}

// Internal routes resolve.
for (const href of [...internal].sort()) {
  const res = await fetch(LOC + href)
  check(res.status === 200, `internal route ${href} -> ${res.status}`)
}

// Navbar (desktop) and mobile menu: real clicks, then back/forward.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(LOC + "/", { waitUntil: "networkidle" })
  for (const [name, route] of [["About", "/about"], ["Features", "/feature"], ["Pricing", "/pricing"], ["Contact", "/contact"]]) {
    await page.locator("nav:visible a:visible", { hasText: new RegExp(`^${name}$`) }).first().click()
    await page.waitForURL(LOC + route, { timeout: 20000 }).then(() => check(true, `navbar ${name} -> ${route}`), () => check(false, `navbar ${name} -> ${route}`, page.url()))
  }
  await page.locator("nav:visible a[href='/']:visible").first().click()
  await page.waitForURL(LOC + "/").then(() => check(true, "navbar logo -> /"), () => check(false, "navbar logo -> /", page.url()))
  await page.goBack(); await page.waitForURL(LOC + "/contact").then(() => check(true, "back -> /contact"), () => check(false, "back -> /contact", page.url()))
  await page.goBack(); await page.waitForURL(LOC + "/pricing").then(() => check(true, "back -> /pricing"), () => check(false, "back -> /pricing", page.url()))
  await page.goForward(); await page.waitForURL(LOC + "/contact").then(() => check(true, "forward -> /contact"), () => check(false, "forward -> /contact", page.url()))
  // Keyboard: Enter on a focused footer link navigates.
  await page.locator("[data-framer-name='Footer'] footer:visible a", { hasText: /^Pricing$/ }).focus()
  await page.keyboard.press("Enter")
  await page.waitForURL(LOC + "/pricing").then(() => check(true, "Enter on a focused footer link navigates"), () => check(false, "Enter on a focused footer link navigates", page.url()))
  // Clicking an external profile opens a new tab with the exact URL (no network wait).
  // The new tab's first request is the link target (LinkedIn then shows bots a challenge page).
  const firstReq = page.context().waitForEvent("request", { predicate: r => /linkedin\.com/.test(r.url()) && r.isNavigationRequest(), timeout: 20000 })
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.locator("[data-framer-name='Footer'] footer:visible a[aria-label='PostSynq on LinkedIn']").click()])
  const first = (await firstReq).url()
  check(first === L.postsynq.linkedin && popup !== page, "PostSynq LinkedIn icon opens the profile in a new tab", first)
  await popup.close()
  await page.close()
}
for (const [name, route] of [["About", "/about"], ["Features", "/feature"], ["Pricing", "/pricing"], ["Contact", "/contact"]]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(LOC + "/", { waitUntil: "networkidle" })
  await page.locator("nav:visible [data-framer-name='Menu Icon']").first().click()
  await page.waitForTimeout(400)
  await page.locator("nav:visible a:visible", { hasText: new RegExp(`^${name}$`) }).first().click()
  await page.waitForURL(LOC + route, { timeout: 20000 }).then(() => check(true, `mobile menu ${name} -> ${route}`), () => check(false, `mobile menu ${name} -> ${route}`, page.url()))
  await page.close()
}
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(LOC + "/", { waitUntil: "networkidle" })
  await page.locator("nav:visible [data-framer-name='Menu Icon']").first().click()
  await page.waitForTimeout(400)
  const app = await page.locator("nav:visible a:visible").evaluateAll(as => as.map(a => a.getAttribute("href")))
  check(app.includes(L.app.login) && app.includes(L.app.signup), "mobile menu has Log in and Start free trial app links", app.join(", "))
  await page.close()
}
await browser.close()

if (process.argv.includes("--external")) {
  console.log("\nExternal destinations (informational; social sites often block automated requests):")
  const urls = [...new Set([...Object.values(L.postsynq), ...Object.values(L.app), ...Object.values(L.atspeed)].filter(u => /^https?:/.test(u)))]
  for (const u of urls) {
    try { const r = await fetch(u, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (link-check)" } }); console.log(`  ${r.status}  ${u}${r.url !== u ? "  -> " + r.url : ""}`) }
    catch (e) { console.log(`  ERR  ${u}  ${e.cause?.code || e.message}`) }
  }
}
fs.writeFileSync("visual-audit/links-report.json", JSON.stringify(inventory, null, 1))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0) // don't wait on keep-alive sockets from the external checks
