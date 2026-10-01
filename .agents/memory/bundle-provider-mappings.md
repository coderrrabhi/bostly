---
name: Bundle provider mappings
description: Durable ownership and rotation rule for user bundle service mappings.
---

Bundle provider/service mappings must remain attached to the user's stable provider account, even when that account's API key is rotated, fails testing, or is temporarily inactive. Inactivity affects dispatch eligibility, not configuration visibility or retention.

**Why:** Users should only need to replace or rotate provider credentials. Re-entering provider assignments and service numbers risks data loss and incorrect order routing.

**How to apply:** Credential operations may update encrypted keys and account health only. Bundle editors must display saved mappings for active and inactive accounts, and mapping saves must be tenant-scoped and atomic.