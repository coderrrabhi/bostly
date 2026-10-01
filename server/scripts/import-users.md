# Keep existing users' passwords

1. Export accounts from the old backend (run where you have the old database URL):

   psql "$OLD_DB_URL" -c "\copy (SELECT id, email, raw_user_meta_data, created_at FROM auth.users) TO 'auth_users.csv' CSV HEADER"
   psql "$OLD_DB_URL" -c "\copy (SELECT id, encrypted_password FROM auth.users WHERE encrypted_password IS NOT NULL) TO 'auth_credentials.csv' CSV HEADER"

2. Export app data per table, e.g.:

   pg_dump "$OLD_DB_URL" --data-only --schema=public --no-owner > public_data.sql
   sed -i 's/public\./lovable_legacy./g' public_data.sql

3. Import into the VPS (after `schema.sql`). Disable the signup trigger while importing so
   profiles/wallets from the dump are not duplicated:

   psql "$DATABASE_URL" -c "ALTER TABLE lovable_legacy.auth_users DISABLE TRIGGER on_auth_user_created"
   psql "$DATABASE_URL" -c "\copy lovable_legacy.auth_users (id,email,raw_user_meta_data,created_at) FROM 'auth_users.csv' CSV HEADER"
   psql "$DATABASE_URL" -c "\copy lovable_legacy.auth_credentials (user_id,password_digest) FROM 'auth_credentials.csv' CSV HEADER"
   psql "$DATABASE_URL" -f public_data.sql
   psql "$DATABASE_URL" -c "ALTER TABLE lovable_legacy.auth_users ENABLE TRIGGER on_auth_user_created"

Passwords are bcrypt hashes and are checked with crypt() on login, so users sign in with
their existing password; the first login links them to a new session automatically.
