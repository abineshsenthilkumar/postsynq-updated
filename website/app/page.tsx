import type { Metadata } from "next"
import HomePage from "./_framer/pages/home"
import { OFFICIAL_LINKS as L } from "../lib/links"

/**
 * Canonical address of the marketing site. The Netlify preview address is not
 * canonical: set NEXT_PUBLIC_SITE_URL only if the primary domain changes.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.postsynq.in"

const title = "PostSynq | AI Social Media Management & Automation"
const description =
  "Create, plan, design, schedule and publish social media content with PostSynq, an AI-powered social media management platform built for businesses."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "PostSynq",
    title,
    description,
    locale: "en_IN",
  },
  // No approved social preview image exists yet, so the compact card is used.
  twitter: { card: "summary", title, description },
}

// Structured data: only verified details (names, official links, contact email).
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${L.atspeed.website}#organization`,
      name: "AtSpeed Innovations",
      url: L.atspeed.website,
      email: L.atspeed.email,
      sameAs: [L.atspeed.linkedin, L.atspeed.instagram, L.atspeed.facebook],
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#postsynq`,
      name: "PostSynq",
      url: SITE_URL,
      email: L.postsynq.email,
      parentOrganization: { "@id": `${L.atspeed.website}#organization` },
      sameAs: [L.postsynq.linkedin, L.postsynq.instagram, L.postsynq.facebook],
    },
    {
      "@type": "SoftwareApplication",
      name: "PostSynq",
      url: SITE_URL,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Social media management",
      operatingSystem: "Web browser",
      description,
      publisher: { "@id": `${L.atspeed.website}#organization` },
      brand: { "@id": `${SITE_URL}/#postsynq` },
    },
  ],
}

export default function Page() {
  return (
    <>
      <HomePage />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    </>
  )
}

