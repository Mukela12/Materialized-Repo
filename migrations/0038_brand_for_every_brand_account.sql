-- Every brand account has a brand (server/brandAccount.ts).
--
-- Signing up as a brand used to create only the user; the brands row that
-- products, creator invitations, campaigns and store connections hang off was
-- never made, so those accounts could not add a product ("No brand
-- available") and did not appear in the list creators tag brands from.
-- Sign-up now creates it; this gives one to every brand account that has
-- none, named after the account as sign-up does ("Your name or brand name").
-- On 29 Sep 2026 that was two accounts: the client's own and a test account.
INSERT INTO brands (name, owner_id, is_active)
SELECT COALESCE(NULLIF(btrim(u.display_name), ''), 'My brand'), u.id, true
  FROM users u
 WHERE u.role = 'brand'
   AND NOT EXISTS (SELECT 1 FROM brands b WHERE b.owner_id = u.id);
