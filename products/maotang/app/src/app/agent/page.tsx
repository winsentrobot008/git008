/**
 * `/agent` - the AI Node deep link. It renders the same controller as `/` but opens directly on
 * {@link AgentPanel}; the engineer/audit toggle still behaves identically on either URL.
 */

import { ConsoleShell } from "@/components/agent-console/ConsoleShell";

export default function AgentConsolePage() {
  return <ConsoleShell initialView="agent" />;
}
