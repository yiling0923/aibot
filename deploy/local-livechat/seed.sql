-- Local test only. Adds one merchant ("Merchant A") and one admin to a fresh local LiveChat database.
-- Admin login: admin@a.test / Test1234!      Safe to run again: it never adds the same thing twice.
INSERT INTO merchants(public_id, name, slug, status, created_at, updated_at)
SELECT '01JTESTMERCHANTAAAAAAAAAAA', 'Merchant A', 'merch-a', 'active', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM merchants WHERE slug = 'merch-a');

INSERT INTO users(tenant_id, name, email, password, status, created_at, updated_at, email_verified_at)
SELECT m.id, 'Admin A', 'admin@a.test', '$2a$10$h6NQC1phEp2GkyZESrhFAO/IJsE/UALoNdIiiVW8A27kjZ93cadBm', 'active', NOW(), NOW(), NOW()
FROM merchants m WHERE m.slug = 'merch-a' AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@a.test');

INSERT INTO user_tenant_memberships(user_id, tenant_id, role_id, status, is_default, created_at, updated_at)
SELECT u.id, m.id, r.id, 'active', 1, NOW(), NOW()
FROM users u JOIN merchants m ON m.slug = 'merch-a' JOIN roles r ON r.name = 'merchant_admin'
WHERE u.email = 'admin@a.test' AND NOT EXISTS (SELECT 1 FROM user_tenant_memberships x WHERE x.user_id = u.id AND x.tenant_id = m.id);

INSERT INTO model_has_roles(role_id, model_type, model_id)
SELECT r.id, 'App\\Models\\User', u.id
FROM users u JOIN roles r ON r.name = 'merchant_admin'
WHERE u.email = 'admin@a.test' AND NOT EXISTS (SELECT 1 FROM model_has_roles x WHERE x.role_id = r.id AND x.model_id = u.id);
