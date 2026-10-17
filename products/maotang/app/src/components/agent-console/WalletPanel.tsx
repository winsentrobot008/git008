/**
 * Compatibility alias for the old component name.
 *
 * The wallet behaviour now lives in `components/console/VaultPanel.tsx`. Keeping this re-export for one
 * release means existing imports keep compiling while the new C-end tree names the panel by its product
 * role rather than its old wallet-only role.
 */

export {
  VaultPanel as WalletPanel,
  type VaultPanelProps as WalletPanelProps,
} from "@/components/console/VaultPanel";
