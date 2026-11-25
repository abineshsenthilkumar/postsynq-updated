// Text-layer geometry: Figma (absolute position inside each 570x680 frame, from the
// saved get_metadata dump) vs the rendered visual at 570px. Prints dx/dy/dw/dh per text.
// Usage: node visual-audit/scripts/create-once-geometry.mjs <metadata.json>
import fs from "node:fs"
import { chromium } from "playwright-core"
const xml = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).map(x => x.text).join("\n")
const frames = { "1094:3": 0, "1094:426": 1, "1094:851": 2, "1094:1306": 3 }
// Parse tags into a tree with absolute coordinates.
const figma = [[], [], [], []]
const stack = []; const re = /<(\/?)([a-z-]+)([^>]*?)(\/?)>/g; let m
const attr = (a, k) => { const r = a.match(new RegExp(`${k}="([^"]*)"`)); return r ? r[1] : null }
while ((m = re.exec(xml))) {
  const [, close, tag, a, self] = m
  if (close) { stack.pop(); continue }
  const parent = stack[stack.length - 1]
  const node = { id: attr(a, "id"), type: tag, name: (attr(a, "name") || "").replace(/&amp;/g, "&"), x: +attr(a, "x"), y: +attr(a, "y"), w: +attr(a, "width"), h: +attr(a, "height") }
  node.frame = parent ? parent.frame : undefined
  if (frames[node.id] !== undefined) { node.frame = frames[node.id]; node.ax = 0; node.ay = 0 }
  else if (parent && parent.frame !== undefined) { node.ax = parent.ax + node.x; node.ay = parent.ay + node.y }
  if (node.frame !== undefined && tag === "text" && node.ax !== undefined) figma[node.frame].push(node)
  if (!self) stack.push(node)
}
const b = await chromium.launch({ channel: "msedge" })
const p = await b.newPage({ viewport: { width: 618, height: 1000 } })
await p.goto((process.env.LOCAL_URL || "http://localhost:3000") + "/feature", { waitUntil: "networkidle", timeout: 300000 })
await p.evaluate(() => document.fonts.ready)
const ours = await p.evaluate(() => [...document.querySelectorAll("section[data-framer-name='Create Once'] [role='img']")].map(v => {
  const o = v.getBoundingClientRect(); const out = []
  const w = document.createTreeWalker(v, NodeFilter.SHOW_TEXT); let t
  while ((t = w.nextNode())) {
    const s = t.nodeValue.trim(); if (!s) continue
    const r = document.createRange(); r.selectNodeContents(t); const b = r.getBoundingClientRect()
    out.push({ text: s.replace(/\s+/g, " "), x: b.left - o.left, y: b.top - o.top, w: b.width, h: b.height })
  }
  return out
}))
await b.close()
for (let i = 0; i < 4; i++) {
  console.log(`\n=== visual ${i + 1}`)
  const used = new Set()
  for (const f of figma[i]) {
    const key = f.name.replace(/\s+/g, " ").trim()
    const o = ours[i].find((x, j) => !used.has(j) && (x.text === key || key.startsWith(x.text)) && used.add(j))
    if (!o) { console.log(`  (not matched) "${key}"`); continue }
    const d = (a, b) => (a - b).toFixed(1).padStart(6)
    console.log(`  ${key.slice(0, 32).padEnd(32)} dx${d(o.x, f.ax)} dy${d(o.y, f.ay)}  w ${o.w.toFixed(1)}/${f.w}  h ${o.h.toFixed(1)}/${f.h}`)
  }
}
