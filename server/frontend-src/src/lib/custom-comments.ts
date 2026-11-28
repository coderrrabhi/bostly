/** Disabled custom comments retain their draft but never affect quote or request. */
export function activeCustomComments(enabled: boolean, text: string): string[] {
  return enabled ? text.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
}