-- Plain counts per merchant (no text, no personal data). READ ONLY.
SET SESSION TRANSACTION READ ONLY;
SELECT mer.slug AS merchant,
       (SELECT COUNT(*) FROM conversations c WHERE c.tenant_id = mer.id) AS chats,
       (SELECT COUNT(*) FROM messages m WHERE m.tenant_id = mer.id) AS messages,
       (SELECT COUNT(*) FROM messages m WHERE m.tenant_id = mer.id AND m.sender_type IN ('visitor','customer')) AS customer_messages,
       (SELECT COUNT(*) FROM messages m WHERE m.tenant_id = mer.id AND m.sender_type = 'operator') AS staff_messages,
       (SELECT COUNT(*) FROM quick_replies q WHERE q.tenant_id = mer.id) AS quick_replies
FROM merchants mer ORDER BY mer.slug;
