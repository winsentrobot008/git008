/**
 * `/agent` - the same console as `/`, kept as a stable address for the operator-facing docs, the demo
 * guide and any bookmark an owner already has. Both routes render {@link ConsoleShell}, so the consumer
 * view is the default and the developer toggle behaves identically on either URL.
 */

import { ConsoleShell } from "@/components/agent-console/ConsoleShell";

export default function AgentConsolePage() {
  return <ConsoleShell />;
}