-- Customer question -> staff answer pairs from the LiveChat staging database, with personal details masked.
-- READ ONLY: this file only has SELECT statements. Nothing is changed in the database.
--
-- What is exported: the merchant's slug, the chat number, the time, the customer's text, and the first staff reply after it.
-- What is NOT exported: customer names, emails, phone numbers, customer ids, operator names, any other table.
-- Masked inside the text: email addresses, web addresses, phone numbers and any run of 6 or more digits
-- (bank account, card, ID and reference numbers). Names written inside a message CANNOT be removed by a program,
-- so a person must still look at the file before it leaves the company.
SET SESSION TRANSACTION READ ONLY;
SET SESSION group_concat_max_len = 1000000;

SELECT
  mer.slug AS merchant,
  m.conversation_id AS chat,
  DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i') AS sent_at,
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(m.body, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', '[EMAIL]'),
        '(https?://|www\\.)[^ ]+', '[URL]'),
      '\\+?[0-9][0-9 .()-]{5,}[0-9]', '[NUMBER]'),
    '[0-9]{6,}', '[NUMBER]') AS customer_text,
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          (SELECT o.body FROM messages o
            WHERE o.conversation_id = m.conversation_id AND o.id > m.id
              AND o.sender_type = 'operator' AND o.visibility = 'public' AND o.message_type = 'text'
            ORDER BY o.id LIMIT 1),
          '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', '[EMAIL]'),
        '(https?://|www\\.)[^ ]+', '[URL]'),
      '\\+?[0-9][0-9 .()-]{5,}[0-9]', '[NUMBER]'),
    '[0-9]{6,}', '[NUMBER]') AS staff_reply
FROM messages m
JOIN merchants mer ON mer.id = m.tenant_id
WHERE m.sender_type IN ('visitor', 'customer')
  AND m.visibility = 'public'
  AND m.message_type = 'text'
  AND CHAR_LENGTH(m.body) BETWEEN 2 AND 500
ORDER BY mer.slug, m.conversation_id, m.id;
