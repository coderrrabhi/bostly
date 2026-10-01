---
name: Lovable database imports
description: Safe handling and compatibility rules for importing the original Supabase PostgreSQL backup.
---

Preserve imported Lovable/Supabase application tables in an isolated PostgreSQL schema rather than restoring over the active Replit schema. Never transplant Supabase passwords, sessions, refresh tokens, or confirmation/recovery tokens into Clerk. Safe identity metadata can be retained for email-based account claiming.

**Why:** The source backup contains Supabase platform schemas and was produced in PostgreSQL custom dump format 1.16, which older PostgreSQL 16 restore tools cannot read. Restoring it directly would collide with active tables and import incompatible authentication internals.

**How to apply:** Use PostgreSQL 17+ restore tooling to stage the archive, transfer public application tables into an isolated schema, compare every source/destination row count, and let Clerk users claim compatible profile/wallet records only after a server-side email match.

Legacy Supabase password digests are bcrypt and can be imported into Clerk without knowing plaintext passwords. Set the original Supabase UUID as Clerk's external ID so identity linkage remains deterministic.

**Why:** Requiring every returning user to sign up again would disconnect existing accounts and balances. Clerk accepts supported password digests during backend user creation.

**How to apply:** Import only email, bcrypt digest, and legacy UUID—never Supabase sessions, tokens, or recovery secrets. Clerk Development and Production are separate stores, so repeat a controlled import for Production when publishing.

After a password-digest migration, disable the Clerk instance HIBP check and clear each imported user's compromised-password flag only when preserving existing passwords is an explicit requirement.

**Why:** Clerk can accept a valid migrated bcrypt digest yet still block login and force a reset when the password appears in breach data.

**How to apply:** Update the Clerk instance with `hibp: false`, then use Clerk's supported `unsetPasswordCompromised` backend operation for migrated users identified by legacy external IDs. Explain that this weakens breach protection.

For migrated users who must retain password-only login, verify the original bcrypt digest server-side and exchange successful verification for a short-lived, one-use Clerk sign-in ticket.

**Why:** Replit-managed Clerk may enforce Device Trust on every new device even after HIBP is disabled, and accountless applications do not expose the setting needed to turn that verification off.

**How to apply:** Keep digests server-only, rate-limit attempts, use parameterized PostgreSQL `crypt` verification, issue a 60-second Clerk ticket, and redeem it in the browser. Never return hashes or log passwords.

Engagement orders built from a user's own provider bundle must not debit the Boostly wallet; calculate and record provider cost server-side, then create order items and scheduled runs in one transaction.

**Why:** The original product charges fulfillment against the user's connected provider account. Debiting the site wallet as well would charge the same order twice.

**How to apply:** Ignore client-supplied prices and identity, verify bundle/service ownership, recompute cost from owned provider services, and roll back the complete order if any item or schedule is invalid.

Imported provider API-key ciphertext cannot be reused when the source Edge Function encryption secret is absent from the backup. Require each affected user to re-enter the provider key once.

**Why:** The database contains ciphertext and key hints, but neither the PostgreSQL dump nor Supabase Vault contains the secret needed to decrypt it. Guessing or bypassing encryption cannot recover the credential safely.

**How to apply:** Keep imported provider metadata and mappings, show an explicit re-entry error, encrypt replacement keys with the current server secret, and never request provider keys through chat.