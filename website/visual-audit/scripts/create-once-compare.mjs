// Compares the four "Create once, publish everywhere" visuals on /feature with the
// Figma renders (visual-audit/create-once/figma/*.png, 570 x 680). A 618px-wide
// window puts the grid in one column, so each visual renders at exactly 570px.
// Output: visual-audit/create-once/compare/<n>.png (Figma | site | diff) + similarity.
import { chromium } from "playwright-core"
import { PNG } from "pngjs"
import pixelmatch from "pixelmatch"
import fs from "node:fs"
import path from "node:path"
const LOC = process.env.LOCAL_URL || "http://localhost:3000"
const names = ["1-approve", "2-templates", "3-publish", "4-vectorize"]
const out = path.resolve("visual-audit/create-once/compare"); fs.mkdirSync(out, { recursive: true })
const b = await chromium.launch({ channel: "msedge" })
const p = await b.newPage({ viewport: { width: 618, height: 1000 }, deviceScaleFactor: 1 })
await p.goto(LOC + "/feature", { waitUntil: "networkidle", timeout: 300000 })
await p.evaluate(() => document.fonts.ready)
await p.addStyleTag({ content: "nextjs-portal, [data-next-badge-root] { display: none !important; }" })
const visuals = p.locator("section[data-framer-name='Create Once'] [role='img']")
console.log("visuals found:", await visuals.count())
for (const [i, n] of names.entries()) {
  const v = visuals.nth(i)
  await v.scrollIntoViewIfNeeded(); await p.waitForTimeout(400)
  await p.evaluate(async () => { await Promise.all([...document.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 10000) }))) })
  await p.evaluate(() => { for (const el of document.querySelectorAll("#main *")) if (getComputedStyle(el).position === "fixed" && !el.closest("section")) el.style.visibility = "hidden" })
  const box = await v.boundingBox()
  const shot = PNG.sync.read(await v.screenshot())
  const ref = PNG.sync.read(fs.readFileSync(`visual-audit/create-once/figma/${n}.png`))
  const w = Math.min(ref.width, shot.width), h = Math.min(ref.height, shot.height)
  const crop = img => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o }
  const diff = new PNG({ width: w, height: h })
  const px = pixelmatch(crop(ref).data, crop(shot).data, diff.data, w, h, { threshold: 0.1 })
  const side = new PNG({ width: w * 3 + 20, height: h }); side.data.fill(255)
  PNG.bitblt(crop(ref), side, 0, 0, w, h, 0, 0); PNG.bitblt(crop(shot), side, 0, 0, w, h, w + 10, 0); PNG.bitblt(diff, side, 0, 0, w, h, w * 2 + 20, 0)
  fs.writeFileSync(path.join(out, `${n}.png`), PNG.sync.write(side))
  console.log(`${n}: rendered ${Math.round(box.width)}x${Math.round(box.height)} (Figma ${ref.width}x${ref.height}), similarity ${(100 * (1 - px / (w * h))).toFixed(2)}%`)
}
await b.close()
