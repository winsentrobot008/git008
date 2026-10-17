/**
 * The display alias behind a `.008ai` DeChat identity.
 *
 * It is derived from the manifest owner, never typed into a component. The app does not create a
 * per-visitor wallet address, so the alias identifies the live node rather than pretending to be a
 * newly minted account.
 */
export function deriveCommsAlias(owner: string | null): string | null {
  if (owner === null) {
    return null;
  }
  const body = owner.replace(/^0x/i, "").toLowerCase();
  if (body.length < 6) {
    return null;
  }
  return body.slice(0, 6);
}
