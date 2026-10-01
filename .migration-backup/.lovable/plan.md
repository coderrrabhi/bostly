## Problem

Full Engagement page (`/full-engagement`) abhi bhi purane **admin bundles** (`engagement_bundles` + `bundle_items` + `services`) se data pull kar raha hai. Isliye jab user ki apni "My Bundles" empty hai, tab bhi Views/Likes/Shares/Reposts wagerah cards dikh jaate hain (admin ke create kiye bundles ki wajah se).

Aap chahte ho: **jo items user ke apne bundle mein honge, sirf wahi dikhein**. Empty bundle = empty breakdown.

## Fix

`src/pages/EngagementOrder.tsx` ko `user_bundles` + `user_bundle_items` + `user_services` par shift karna hai.

### Changes

1. **Bundle fetch** — `engagement_bundles` ki jagah:
   ```
   user_bundles (where user_id = auth.uid, is_active = true)
   └── user_bundle_items (engagement_type, quantity, user_service_id)
       └── user_services (rate, min_quantity, max_quantity)
   ```

2. **Available platforms** — sirf wahi platforms selector mein dikhein jinke liye user ne bundle banaya ho (aur usme kam se kam 1 item ho). Agar zero bundles → empty state: "Aap ne abhi tak koi bundle nahi banaya. `My Bundles` mein jaake create karo."

3. **Active engagement types** — user ke selected bundle ke `user_bundle_items[].engagement_type` se derive honge. Bundle empty → koi card render nahi hoga.

4. **Pricing** — har type ka rate `user_services.rate` (USD per 1000) se aayega, `bundle_items.price_per_k` fallback nahi. Min/max bhi `user_services` se.

5. **Realtime sync** — realtime subscription channels ko `user_bundles`, `user_bundle_items`, `user_services` par point karo (purane `bundle_items` / `engagement_bundles` / `services` channels hata do).

6. **Order submit path** — submit flow already `user-provider-manage` edge function use karta hai (My Bundles ke through), toh submission ko us edge function ke through hi route karna hai user's `user_service_id` ke saath. Purane admin-provider path ka reliance hata do.

7. **Empty state UI** — jab user ke paas koi active bundle nahi:
   - Platform selector chhupao
   - Big empty card: box icon + "No bundles yet" + CTA button → `/my-bundles`

### Files touched

- `src/pages/EngagementOrder.tsx` (main refactor — queries, memos, submit)
- Koi DB migration nahi chahiye; tables already exist.

## Out of scope

- Admin bundles (`engagement_bundles`) DB se delete nahi kar rahe (data preserve, sirf UI unhook).
- Mass Order / AI Intelligence pages already user-scoped bundles use karti hain.
