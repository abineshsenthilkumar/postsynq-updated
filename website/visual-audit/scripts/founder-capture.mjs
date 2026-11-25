// Screenshots of the About page founder statement ("Quote Video" section) and checks on it.
// Usage: node visual-audit/scripts/founder-capture.mjs <before|after> [sizes]
// Output: visual-audit/founder/<mode>/<WxH>.png and a JSON summary.
import { chromium } from "playwright-core"
import fs from "node:fs"
import path from "node:path"

const LOC = process.env.LOCAL_URL || "http://localhost:3000"
const mode = process.argv[2] || "after"
const sizes = (process.argv[3] || "1920x1080,1440x900,1280x800,1024x768,768x1024,430x932,390x844,375x812,360x800").split(",")
const out = path.resolve("visual-audit/founder", mode)
fs.mkdirSync(out, { recursive: true })
const HIDE = `nextjs-portal, [data-next-badge-root] { display: none !important; }`

const browser = await chromium.launch({ channel: "msedge" })
const report = []
for (const size of sizes) {
  const [w, h] = size.split("x").map(Number)
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = [], failed = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()) })
  page.on("requestfailed", r => failed.push(r.url()))
  page.on("response", r => { if (r.status() >= 400 && /\/assets\//.test(r.url())) failed.push(`${r.status()} ${r.url()}`) })
  await page.goto(LOC + "/about", { waitUntil: "networkidle", timeout: 120000 })
  const section = page.locator("section[data-framer-name='Quote Video']")
  await section.scrollIntoViewIfNeeded()
  await page.waitForTimeout(1500)
  await page.evaluate(async () => {
    document.querySelectorAll("img[loading=lazy]").forEach(i => { i.loading = "eager" })
    await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 15000) })))
  })
  await page.addStyleTag({ content: HIDE })
  await page.evaluate(() => { for (const el of document.querySelectorAll("#main *")) if (getComputedStyle(el).position === "fixed" && !el.closest("section")) el.style.visibility = "hidden" })
  await page.waitForTimeout(500)
  await section.screenshot({ path: path.join(out, `${size}.png`) })
  const info = await section.evaluate(s => {
    const vis = e => e && e.getClientRects().length && getComputedStyle(e).visibility === "visible"
    const q = [...s.querySelectorAll("h1,h2,h3,h4,h5,h6,p")].filter(vis).map(e => e.textContent.trim())
    const photo = [...s.querySelectorAll("[data-framer-name='Photo'] img, [data-framer-name='Video'] img")].find(vis)
    const avatar = [...s.querySelectorAll("[data-framer-name='Avatar'] > [data-framer-background-image-wrapper] img")].find(vis)
    const badge = [...s.querySelectorAll("[data-framer-name='Company'] img")].find(vis)
    const r = e => e ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(e.getBoundingClientRect()) : null
    return {
      texts: q,
      playButtons: [...s.querySelectorAll("[data-framer-name='Play Button']")].filter(vis).length,
      overlays: [...s.querySelectorAll("[data-framer-name='Overlay']")].filter(vis).length,
      videos: s.querySelectorAll("video, iframe").length,
      focusableInPhoto: [...s.querySelectorAll("[data-framer-name='Photo'] [tabindex], [data-framer-name='Video'] [tabindex], [data-highlight]")].length,
      photo: photo && { src: photo.currentSrc || photo.src, loaded: photo.complete && photo.naturalWidth > 0, alt: photo.alt, box: r(photo), filter: getComputedStyle(photo).filter, opacity: getComputedStyle(photo).opacity },
      avatar: avatar && { src: avatar.currentSrc || avatar.src, loaded: avatar.complete && avatar.naturalWidth > 0, alt: avatar.alt, box: r(avatar.parentElement) },
      badge: badge && { src: badge.src, box: r(badge.parentElement.parentElement) },
    }
  })
  // Clicking the photo must do nothing: same URL, no dialog, no new element.
  const photoBox = section.locator("[data-framer-name='Photo'], [data-framer-name='Video']").first()
  const before = page.url(), domBefore = await page.evaluate(() => document.querySelectorAll("*").length)
  if (await photoBox.count()) await photoBox.click({ force: true })
  await page.waitForTimeout(500)
  info.clickResult = { sameUrl: page.url() === before, dialogs: await page.locator("dialog[open], [role=dialog]").count(), domDelta: (await page.evaluate(() => document.querySelectorAll("*").length)) - domBefore }
  info.overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  report.push({ size, ...info, errors: errors.slice(0, 3), failed: failed.slice(0, 3) })
  console.log(JSON.stringify({ size, ...info, errors: errors.length, failed }))
  await page.close()
}
await browser.close()
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2))
