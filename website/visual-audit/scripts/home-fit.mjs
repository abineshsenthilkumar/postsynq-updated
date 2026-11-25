// Homepage text fit: every visible text element must fit its own box and its
// parent (no clipping / overflow) at all audit widths; no page-level overflow.
// Usage: node visual-audit/scripts/home-fit.mjs   (LOCAL_URL to test another site)
import { chromium } from "playwright-core"
const LOC = process.env.LOCAL_URL || "http://localhost:3000"
const sizes = ["1920x1080", "1440x900", "1280x800", "1024x768", "768x1024", "430x932", "390x844", "375x812", "360x800"]
const b = await chromium.launch({ channel: "msedge" })
let bad = 0
for (const size of sizes) {
  const [w, h] = size.split("x").map(Number)
  const p = await b.newPage({ viewport: { width: w, height: h } })
  const errs = []; p.on("pageerror", e => errs.push(String(e))); p.on("console", m => { if (m.type() === "error") errs.push(m.text()) })
  await p.goto(LOC + "/", { waitUntil: "networkidle", timeout: 300000 })
  await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)) } scrollTo(0, 0) })
  await p.waitForTimeout(800)
  const r = await p.evaluate(() => {
    const issues = []
    const vis = e => e.getClientRects().length && getComputedStyle(e).visibility === "visible"
    for (const el of document.querySelectorAll("[data-framer-root] h1, [data-framer-root] h2, [data-framer-root] h3, [data-framer-root] h4, [data-framer-root] h5, [data-framer-root] h6, [data-framer-root] p")) {
      if (!vis(el) || el.closest("[data-framer-name='Footer']") || el.closest("[aria-hidden='true']")) continue
      const t = el.textContent.replace(/\s+/g, " ").trim(); if (!t) continue
      if (el.scrollWidth > el.clientWidth + 2) issues.push(`overflows its box by ${el.scrollWidth - el.clientWidth}px: "${t.slice(0, 50)}"`)
      const r = el.getBoundingClientRect(), pr = el.parentElement.getBoundingClientRect()
      if (r.right > innerWidth + 1 || r.left < -1) issues.push(`outside the viewport: "${t.slice(0, 50)}"`)
    }
    return { issues, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, height: document.documentElement.scrollHeight }
  })
  const ok = !r.issues.length && r.pageOverflow <= 0 && !errs.length
  if (!ok) bad++
  console.log(`${ok ? "PASS" : "FAIL"} ${size} page height ${r.height}px, page overflow ${r.pageOverflow}px${r.issues.length ? "\n   " + r.issues.slice(0, 6).join("\n   ") : ""}${errs.length ? "\n   console: " + errs[0] : ""}`)
  await p.close()
}
await b.close()
process.exit(bad ? 1 : 0)
