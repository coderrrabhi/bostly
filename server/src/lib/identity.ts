import { pool } from "../db";

export type LegacyIdentity = { legacyId: string; isAdmin: boolean };

/** The session cookie stores the account UUID directly, so no remote lookup is needed. */
export function resolveLegacyId(userId: string): Promise<string> {
  return Promise.resolve(userId);
}

export async function isLegacyAdmin(legacyId: string): Promise<boolean> {
  const role = await pool.query<{ role: string }>(
    "SELECT role::text AS role FROM lovable_legacy.user_roles WHERE user_id = $1::uuid AND role = 'admin' LIMIT 1",
    [legacyId],
  );
  return role.rows[0]?.role === "admin";
}

export async function resolveIdentity(userId: string): Promise<LegacyIdentity> {
  return { legacyId: userId, isAdmin: await isLegacyAdmin(userId) };
}

export async function assertLegacyAdmin(userId: string): Promise<string> {
  const identity = await resolveIdentity(userId);
  if (!identity.isAdmin) throw new Error("Admin access required.");
  return identity.legacyId;
}

export function forgetIdentity(_userId: string): void {
  // nothing cached
}
