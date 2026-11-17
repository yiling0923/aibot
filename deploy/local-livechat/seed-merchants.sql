-- Local test only. Adds five more merchants to the local LiveChat (named like the bot's demo merchants) and makes the local admin
-- (admin@a.test) a member of all of them, so LiveChat shows the merchant switcher like the real one.
-- Safe to run again: it never adds the same thing twice. Merchant A (see seed.sql) must exist first.
INSERT INTO merchants(public_id, name, slug, status, created_at, updated_at)
SELECT x.public_id, x.name, x.slug, 'active', NOW(), NOW() FROM (
  SELECT '01JTESTMERCHANTBBBBBBBBBBB' AS public_id, 'SwiftWallet' AS name, 'merch-b' AS slug UNION ALL
  SELECT '01JTESTMERCHANTCCCCCCCCCCC', 'MegaPlay', 'merch-c' UNION ALL
  SELECT '01JTESTMERCHANTDDDDDDDDDDD', 'BetKing', 'merch-d' UNION ALL
  SELECT '01JTESTMERCHANTEEEEEEEEEEE', 'CashPoint', 'merch-e' UNION ALL
  SELECT '01JTESTMERCHANTFFFFFFFFFFF', 'GameHub', 'merch-f') x
WHERE NOT EXISTS (SELECT 1 FROM merchants m WHERE m.slug = x.slug);

INSERT INTO user_tenant_memberships(user_id, tenant_id, role_id, status, is_default, created_at, updated_at)
SELECT u.id, m.id, r.id, 'active', 0, NOW(), NOW()
FROM users u JOIN merchants m ON m.slug IN ('merch-b', 'merch-c', 'merch-d', 'merch-e', 'merch-f') JOIN roles r ON r.name = 'merchant_admin'
WHERE u.email = 'admin@a.test' AND NOT EXISTS (SELECT 1 FROM user_tenant_memberships x WHERE x.user_id = u.id AND x.tenant_id = m.id);
