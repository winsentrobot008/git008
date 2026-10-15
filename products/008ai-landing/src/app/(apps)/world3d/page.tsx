import type { Metadata } from "next";
import World3DApp from "@/components/world3d/World3DApp";

/**
 * /world3d - the AI 3D Immersive Space surface.
 *
 * Server component: metadata only. The viewer, the upload pipeline and the splat
 * renderer are all browser-side, so they live behind the client boundary in
 * World3DApp and nothing WebGL-adjacent is evaluated while this route is rendered
 * on the server.
 *
 * Metadata is intentionally English-only: the i18n gate forbids CJK in a route
 * file, and the client shell translates every visible string from the dictionary
 * at runtime.
 */

export const metadata: Metadata = {
  title: "AI 3D Immersive Space - turn a photo or clip into an explorable 3D scene | 008AI",
  description:
    "Upload a JPG, PNG or MP4 and step into the space it describes. 008AI lifts a 3D reconstruction out of a single photo or a short clip and hands you an interactive scene to orbit, pan and inspect.",
  metadataBase: new URL("https://008ai.online"),
  keywords: [
    "AI 3D reconstruction",
    "photo to 3D",
    "3D scene viewer",
    "gaussian splatting",
    "immersive space",
    "008AI",
  ],
  alternates: { canonical: "/world3d" },
  openGraph: {
    title: "AI 3D Immersive Space | 008AI",
    description:
      "One photo or a short clip becomes an explorable 3D scene. Orbit, pan and inspect it in the browser.",
    url: "https://008ai.online/world3d",
    siteName: "008AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI 3D Immersive Space | 008AI",
    description: "Photos and video into an explorable 3D scene. 008ai.online",
  },
};

export default function World3DPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <World3DApp />
    </main>
  );
}