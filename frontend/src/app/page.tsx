/**
 * MAOTANG Web Agent OS - the entry screen.
 *
 * `/` and `/agent` are the same console: the C-end consumer view is the default face, and a header
 * switch flips the page to the M1-M5 engineer/audit console without a round trip. The page is a thin
 * server component; all of the behaviour (and the mode switch) lives in the client components.
 *
 * The DEX board that used to be `/` still ships, at `/dex`, unmodified.
 */

import { ConsoleShell } from "@/components/agent-console/ConsoleShell";

export default function HomePage() {
  return <ConsoleShell />;
}