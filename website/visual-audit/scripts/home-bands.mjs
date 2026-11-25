// Full-page capture of the homepage cut into bands at section boundaries.
import { chromium } from "playwright-core"
import sharp from "sharp"
const [w, h] = (process.argv[2] || "1440x900").split("x").map(Number)
const out = process.argv[3]
const b = await chromium.launch({ channel: "msedge" })
const p = await b.newPage({ viewport: { width: w, height: h } })
await p.goto((process.env.LOCAL_URL || "http://localhost:3000") + "/", { waitUntil: "networkidle", timeout: 300000 })
await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 80)) } scrollTo(0, 0) })
await p.waitForTimeout(1500)
await p.addStyleTag({ content: "nextjs-portal{display:none!important}" })
await p.evaluate(() => { for (const el of document.querySelectorAll("#main *")) if (getComputedStyle(el).position === "fixed" && !el.closest("section")) el.style.visibility = "hidden" })
const secs = await p.evaluate(() => [...document.querySelectorAll("[data-framer-root] > section, [data-framer-root] > div[data-framer-name='Footer']")].filter(s => s.getClientRects().length).map(s => { const r = s.getBoundingClientRect(); return { name: s.getAttribute("data-framer-name"), y: Math.round(r.top + scrollY), h: Math.round(r.height) } }))
const buf = await p.screenshot({ fullPage: true })
const meta = await sharp(buf).metadata()
for (const [i, s] of secs.entries()) {
  const top = Math.max(0, s.y), height = Math.min(s.h, meta.height - top)
  if (height < 2) continue
  await sharp(buf).extract({ left: 0, top, width: meta.width, height }).toFile(`${out}/${String(i).padStart(2, "0")}-${(s.name || "section").replace(/\W+/g, "-")}.png`)
}
console.log(secs.map(s => `${s.name} y=${s.y} h=${s.h}`).join("\n"))
await b.close()
