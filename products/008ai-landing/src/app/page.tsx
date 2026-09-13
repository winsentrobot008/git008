/**
 * Landing page - server shell.
 *
 * The per-build stamp is computed here, at build time, so the rendered HTML
 * still busts the edge cache on every deploy; computing it inside the client
 * component would turn it into a per-visitor timestamp instead. All copy and
 * interactivity live in LandingContent, which runs inside the language context.
 */

import LandingContent from "@/components/LandingContent";

// Per-build stamp (rendered in HTML footer → busts edge cache on each deploy)
const BUILD_STAMP = new Date().toISOString().slice(0, 16).replace(/\D/g, "");

export default function Home() {
  return <LandingContent buildStamp={BUILD_STAMP} />;
}
