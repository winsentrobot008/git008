/**
 * MAOTANG Web Agent OS - the entry screen.
 *
 * `/` and `/agent` are the same console: the C-end consumer view is the default face, and the menu drawer
 * flips the page to the M1-M5 engineer/audit console without a round trip. The page is a thin server
 * component; all of the behaviour (and the mode switch) lives in the client components.
 *
 * The legacy DEX board that used to be `/dex` is gone (see ADR-040), so `/` renders nothing but the
 * consumer view.
 */

import { ConsoleShell } from "@/components/agent-console/ConsoleShell";

export default function HomePage() {
  return <ConsoleShell />;
}