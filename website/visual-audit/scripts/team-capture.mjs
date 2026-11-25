// Screenshots + checks of the About page leadership team section ("Team").
// Usage: node visual-audit/scripts/team-capture.mjs <before|after|live> [sizes]
// LOCAL_URL overrides the site (default http://localhost:3000).
import { chromium } from "playwright-core"
import fs from "node:fs"
import path from "node:path"

const LOC = process.env.LOCAL_URL || "http://localhost:3000"
const mode = process.argv[2] || "after"
const sizes = (process.argv[3] || "1920x1080,1440x900,1280x800,1024x768,768x1024,430x932,390x844,375x812,360x800").split(",")
const out = path.resolve("visual-audit/team", mode)
fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: "msedge" })
const report = []
for (const size of sizes) {
  const [w, h] = size.split("x").map(Number)
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = [], failed = []
  page.on("pageerror", e => errors.push(String(e)))
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()) })
  page.on("response", r => { if (r.status() >= 400 && r.request().resourceType() === "image") failed.push(`${r.status()} ${r.url()}`) })
  await page.goto(LOC + "/about", { waitUntil: "networkidle", timeout: 120000 })
  const section = page.locator("section[data-framer-name='Team']")
  await section.scrollIntoViewIfNeeded()
  await page.waitForTimeout(1500)
  await page.evaluate(async () => {
    document.querySelectorAll("img[loading=lazy]").forEach(i => { i.loading = "eager" })
    await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 15000) })))
  })
  await page.addStyleTag({ content: "nextjs-portal, [data-next-badge-root] { display: none !important; }" })
  await page.evaluate(() => { for (const el of document.querySelectorAll("#main *")) if (getComputedStyle(el).position === "fixed" && !el.closest("section")) el.style.visibility = "hidden" })
  await page.waitForTimeout(500)
  await section.screenshot({ path: path.join(out, `${size}.png`) })
  const info = await section.evaluate(s => {
    const vis = e => e.getClientRects().length && getComputedStyle(e).visibility === "visible"
    const box = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
    const cards = [...s.querySelectorAll("[data-framer-name='List'] [data-framer-name='Avatar']")].filter(vis).map(av => {
      const card = av.parentElement
      const title = card.querySelector("[data-framer-name='Title']")
      const ps = title ? [...title.querySelectorAll("p,h1,h2,h3,h4,h5,h6")].map(p => p.textContent.trim()) : []
      const img = av.querySelector("img")
      return { name: ps[0], role: ps[1], img: (img?.currentSrc || img?.src || "").replace(/\?.*/, "").split("/").pop(), alt: img?.alt, imgBox: box(av), card: box(card), lastText: title ? box(title) : null }
    })
    return {
      section: box(s),
      cards,
      links: [...s.querySelectorAll("a, [href], [data-href]")].length,
      linkRows: s.querySelectorAll("[data-framer-name='Links']").length,
      focusable: [...s.querySelectorAll("a, button, [tabindex]")].length,
    }
  })
  info.overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  report.push({ size, ...info, errors: errors.slice(0, 3), failed })
  console.log(JSON.stringify({ size, ...info, errors: errors.length, failed }))
  await page.close()
}
await browser.close()
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2))
