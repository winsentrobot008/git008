import type { MetadataRoute } from "next";

/**
 * The installable-app manifest.
 *
 * `display: "standalone"` is the whole point: Add to Home Screen opens the console full-screen with no
 * browser chrome, which is the surface the glass layout is designed for (the safe-area padding only
 * matters once the window extends under the status bar). The colours match the light console so the
 * splash screen does not flash a dark rectangle before the page paints.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "猫糖 (MAOTANG) - 个人 AI 节点",
    short_name: "MAOTANG",
    description: "Speak your intent. Locally vetted. Biometrically confirmed.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFF5F7",
    theme_color: "#FFB6C1",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
