/**
 * `/dechat` - the DeChat deep link.
 *
 * It renders the same controller and bottom navigation as `/` but opens directly on
 * `DeChatPanel`; the engineer/audit toggle still behaves identically on every route.
 */

import { ConsoleShell } from "@/components/agent-console/ConsoleShell";

export default function DeChatPage() {
  return <ConsoleShell initialView="dechat" />;
}