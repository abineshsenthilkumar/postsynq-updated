import type { CSSProperties, ReactNode } from "react"
import s from "./create-once.module.css"

/**
 * Features page: "Create once, publish everywhere" (Figma file Vj5CRB8MXjn98WXeIhmnZG,
 * section 1094:2, v2). Four product visuals built in HTML/CSS from the Figma frames
 * (1094:3, 1094:426, 1094:851, 1094:1306), each with its caption. All images and icons
 * are local files in /public/images/features. Text styles of the label, heading and
 * captions are the site's own Framer presets (same as the rest of the Features page).
 *
 * `children` is rendered under the grid (the page passes the existing
 * "Start free trial" button from the Framer page).
 */

const IMG = "/images/features"
const ICON = `${IMG}/icons`

// Framer text presets (app/_framer/framer.css) used by this section on the Framer page.
const T = {
  label: "framer-text framer-styles-preset-h286f8",
  heading: "framer-text framer-styles-preset-12lj5ox",
  captionTitle: "framer-text framer-styles-preset-tg2l96",
  captionText: "framer-text framer-styles-preset-9oy5h3",
}
const center = { "--framer-text-alignment": "center" } as CSSProperties
const muted = { "--framer-text-color": "var(--token-ea690d84-0c2d-4322-885a-8bb8fee7e329, rgb(65, 87, 98))" } as CSSProperties

const captions = [
  { title: "Approve, then we post", text: "Review every post Synq AI prepares. Nothing goes live without your OK." },
  { title: "Ready-made templates", text: "Carousels and posts already designed. Just add your details." },
  { title: "Post everywhere in one go", text: "Publish to every connected platform at once, customised for each." },
  { title: "Vectorize & customise", text: "Turn any post into an editable vector and change it your way." },
]

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.frame}>
      <div className={s.visual} role="img" aria-label={label}>
        <img className={s.dots} src={`${ICON}/dots-pattern.svg`} alt="" />
        <div aria-hidden="true">{children}</div>
      </div>
    </div>
  )
}

function Tick() {
  return <span className={s.tick}>✓</span>
}

/** Visual 14 · Approve, then we post */
function ApproveVisual() {
  const channels = [
    { name: "instagram", bg: "#e1306c" },
    { name: "facebook", bg: "#1877f2" },
    { name: "linkedin", bg: "#0077b5" },
    { name: "x", bg: "#000" },
  ]
  return (
    <Frame label="Synq AI prepared a Diwali offer post for Brew Lane Café, waiting for your approval before it goes live on Friday at 7:00 PM">
      <div className={`${s.card} ${s.v14Card}`}>
        <div className={s.row} style={{ gap: "calc(10 * var(--u))" }}>
          <span className={s.aiBadge}><img src={`${ICON}/synq-ai.svg`} alt="" /></span>
          <div className={s.stack} style={{ gap: "calc(2 * var(--u))" }}>
            <p className={s.title15}>Synq AI prepared a post</p>
            <p className={s.sub12}>Ready for your review · Fri, 7:00 PM</p>
          </div>
        </div>
        <div className={s.postArt}>
          <img className={s.postPhoto} src={`${IMG}/approve-post.jpg`} alt="" loading="lazy" decoding="async" />
          <p className={s.postKicker}>BREW LANE CAFÉ · THIS WEEK ONLY</p>
          <p className={s.postTitle}>Diwali<br />Offer 20% off</p>
        </div>
        <p className={s.caption14}>Light up your evenings at Brew Lane. Our festive menu is here, with saffron lattes and more.</p>
        <div className={`${s.row} ${s.channels}`}>
          {channels.map(c => (
            <span key={c.name} className={`${s.chip} ${s.chip22}`} style={{ background: c.bg }}><img src={`${ICON}/${c.name}.svg`} alt="" /></span>
          ))}
          <p className={s.channelsText}>4 channels</p>
        </div>
        <div className={s.actions}>
          <span className={s.btnEdit}>Edit</span>
          <span className={`${s.btnDark} ${s.btnApprove}`}>{"✓  Approve"}</span>
        </div>
      </div>
      <div className={`${s.pill} ${s.v14Status}`}><span className={s.waitDot} />Waiting for your OK</div>
      <div className={`${s.toast} ${s.v14Toast}`}><Tick />Goes live Fri, 7:00 PM</div>
    </Frame>
  )
}

/** Visual 15 · Ready-made templates */
function TemplatesVisual() {
  // Crop of each photo inside its 180 x 150 slot (Figma image fill: size and offset in %).
  const tiles = [
    { file: "template-diwali.jpg", text: "Diwali\nOffer", img: { width: "100%", height: "179.38%", top: "-32.38%" }, first: true },
    { file: "template-new-arrivals.jpg", text: "New\narrivals", img: { width: "100.01%", height: "158.47%", top: "-22.87%" } },
    { file: "template-festive-menu.jpg", text: "Festive\nMenu", img: { width: "106.18%", height: "100.01%", top: "0" } },
    { file: "template-coffee-tips.jpg", text: "5 \ncoffee tips", img: { width: "100.01%", height: "179.6%", top: "-51.33%" } },
  ]
  return (
    <Frame label="Choosing a ready-made Festive template from the café and restaurant pack; your logo and colours are added automatically">
      <div className={`${s.card} ${s.v15Card}`}>
        <div className={`${s.between} ${s.w386}`}>
          <p className={s.cardTitle18}>Templates</p>
          <p className={s.search}>Search</p>
        </div>
        <div className={s.filters}>
          {["All", "Festive", "Offers", "Menu"].map(f => (
            <p key={f} className={`${s.filter} ${f === "Festive" ? s.filterOn : ""}`}>{f}</p>
          ))}
        </div>
        <div className={s.tiles}>
          {tiles.map(t => (
            <div key={t.file} className={s.tile}>
              <div className={`${s.tileImage} ${t.first ? s.tileImageFirst : ""}`}>
                <img src={`${IMG}/${t.file}`} alt="" loading="lazy" decoding="async" style={t.img} />
              </div>
              <p className={s.tileText}>{t.text}</p>
            </div>
          ))}
        </div>
        <div className={`${s.between} ${s.w386}`}>
          <p className={s.pack}>Café &amp; restaurant pack</p>
          <p className={s.useTemplate}>Use template</p>
        </div>
      </div>
      <div className={`${s.toast} ${s.v15Toast}`}><Tick />Your logo &amp; colours added</div>
      <div className={`${s.pill} ${s.v15Selected}`}><Tick />Selected</div>
    </Frame>
  )
}

/** Visual 16 · Post everywhere in one go */
function PublishVisual() {
  const rows = [
    { icon: "instagram-lg", bg: "#e1306c", name: "Instagram", info: "Reel · 9:16" },
    { icon: "facebook-lg", bg: "#1877f2", name: "Facebook", info: "Reel + post" },
    { icon: "linkedin-lg", bg: "#0077b5", name: "LinkedIn", info: "Video post" },
    { icon: "x-lg", bg: "#000", name: "X", info: "Video + caption" },
    { icon: "youtube", bg: "#f00", name: "YouTube", info: "Short" },
    { icon: "threads", bg: "#000", name: "Threads", info: "Post" },
  ]
  return (
    <Frame label="Publishing the Festive Menu reel to Instagram, Facebook, LinkedIn, X, YouTube and Threads at once">
      <div className={`${s.card} ${s.v16Card}`}>
        <div className={s.row} style={{ gap: "calc(12 * var(--u))" }}>
          <div className={s.reelArt}>
            <img src={`${ICON}/post-art-ellipse.svg`} alt="" />
            <p className={s.reelText}>{"Festive\nMenu"}</p>
          </div>
          <div className={s.stack} style={{ gap: "calc(2 * var(--u))" }}>
            <p className={s.title15}>Festive Menu · Reel</p>
            <p className={s.sub12}>Publish to 6 channels</p>
          </div>
        </div>
        <div className={s.list}>
          {rows.map(r => (
            <div key={r.name} className={s.channelRow}>
              <span className={`${s.chip} ${s.chip28}`} style={{ background: r.bg }}><img src={`${ICON}/${r.icon}.svg`} alt="" /></span>
              <div className={`${s.stack} ${s.channelInfo}`}>
                <p className={s.channelName}>{r.name}</p>
                <p className={s.sub12}>{r.info}</p>
              </div>
              <span className={s.checkBox}>✓</span>
            </div>
          ))}
        </div>
        <span className={`${s.btnDark} ${s.publishBtn}`}>{"→  Publish everywhere"}</span>
      </div>
      <div className={`${s.toast} ${s.v16Toast}`}><Tick />Published to 6 channels</div>
    </Frame>
  )
}

/** Visual 17 · Vectorize & customise */
function VectorizeVisual() {
  const handles = [[84.5, 144.5], [241.5, 144.5], [84.5, 216.5], [241.5, 216.5]]
  const layers = [
    { icon: "T", name: "Headline", on: true },
    { icon: "○", name: "Circle" },
    { icon: "▢", name: "Background" },
  ]
  return (
    <Frame label="Editing a vectorized Diwali offer post: change colours, font and layers in seconds">
      <div className={`${s.card} ${s.v17Card}`}>
        <div className={`${s.between} ${s.w404}`}>
          <p className={s.cardTitle16}>Edit post</p>
          <p className={s.limeTag}>Vector · 6 layers</p>
        </div>
        <div className={s.canvasWrap}>
          <div className={s.canvasPhoto}><img src={`${IMG}/vectorize-post.jpg`} alt="" loading="lazy" decoding="async" /></div>
          <p className={s.canvasText}>{"Diwali\nOffer 20%"}</p>
          <span className={s.selection} />
          {handles.map(([x, y]) => (
            <span key={`${x}-${y}`} className={s.handle} style={{ left: `calc(${x} * var(--u))`, top: `calc(${y} * var(--u))` }} />
          ))}
        </div>
        <div className={`${s.tools} ${s.w404}`}>
          <img className={s.swatches} src={`${ICON}/colour-swatches.svg`} alt="" />
          <p className={s.fontTag}>Onest · SemiBold</p>
          <p className={s.vectorizeTag}>Vectorize</p>
        </div>
        <div className={s.layers}>
          {layers.map(l => (
            <div key={l.name} className={`${s.layer} ${l.on ? s.layerOn : ""}`}>
              <span className={s.layerIcon}>{l.icon}</span>
              <span className={s.layerName}>{l.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={`${s.toast} ${s.v17Toast}`}><Tick />Edits in seconds, no designer</div>
    </Frame>
  )
}

const visuals = [ApproveVisual, TemplatesVisual, PublishVisual, VectorizeVisual]

export default function CreateOncePublishEverywhere({ children }: { children?: ReactNode }) {
  return (
    <section className={s.section} data-framer-name="Create Once" aria-labelledby="create-once-heading">
      <div className={s.head}>
        <p className={T.label} style={center}>create &amp; publish</p>
        <h2 id="create-once-heading" className={T.heading} style={center}>Create once,<br className={s.desktopBreak} /> publish everywhere</h2>
      </div>
      <ul className={s.grid}>
        {visuals.map((Visual, i) => (
          <li key={captions[i].title} className={s.item}>
            <Visual />
            <div className={s.caption}>
              <h3 className={T.captionTitle}>{captions[i].title}</h3>
              <p className={T.captionText} style={muted}>{captions[i].text}</p>
            </div>
          </li>
        ))}
      </ul>
      {children && <div className={s.cta}>{children}</div>}
    </section>
  )
}
