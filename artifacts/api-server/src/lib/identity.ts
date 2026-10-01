import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";

export type LegacyIdentity = { legacyId: string; isAdmin: boolean };

/**
 * Resolving the linked legacy UUID requires a round trip to Clerk's remote API.
 * Doing that on every request added hundreds of milliseconds per call, so the
 * mapping is cached per process. Only the id is cached: it is the immutable
 * external id assigned during migration. The admin role is read from the
 * database on every call so revoking it takes effect immediately.
 */
const LEGACY_ID_TTL_MS = 30 * 60_000;
const legacyIds = new Map<string, { expiresAt: number; value: Promise<string> }>();

export function resolveLegacyId(clerkUserId: string): Promise<string> {
  const cached = legacyIds.get(clerkUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = (async (): Promise<string> => {
    const user = await clerkClient.users.getUser(clerkUserId);
    if (!user.externalId) throw new Error("Your account is not linked to legacy data.");
    return user.externalId;
  })().catch((error: unknown) => {
    legacyIds.delete(clerkUserId);
    throw error;
  });
  legacyIds.set(clerkUserId, { expiresAt: Date.now() + LEGACY_ID_TTL_MS, value });
  return value;
}

export async function isLegacyAdmin(legacyId: string): Promise<boolean> {
  const role = await pool.query<{ role: string }>(
    "SELECT role::text AS role FROM lovable_legacy.user_roles WHERE user_id = $1::uuid LIMIT 1",
    [legacyId],
  );
  return role.rows[0]?.role === "admin";
}

export async function resolveIdentity(clerkUserId: string): Promise<LegacyIdentity> {
  const legacyId = await resolveLegacyId(clerkUserId);
  return { legacyId, isAdmin: await isLegacyAdmin(legacyId) };
}

export async function assertLegacyAdmin(clerkUserId: string): Promise<string> {
  const identity = await resolveIdentity(clerkUserId);
  if (!identity.isAdmin) throw new Error("Admin access required.");
  return identity.legacyId;
}

export function forgetIdentity(clerkUserId: string): void {
  legacyIds.delete(clerkUserId);
}
