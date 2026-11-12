# Export from the LiveChat staging database (for the bot's knowledge base)

For someone who **can already reach** the staging database. It only reads. Nothing in the database is changed.
No password is stored in these files: you type it when asked.

## 0. Use a read-only account (recommended)
An admin account is not needed. Ask the database owner to create one that can only read the tables below:

```sql
CREATE USER 'botstudy'@'%' IDENTIFIED BY '<a new password>';
GRANT SELECT ON livechat.merchants, livechat.messages, livechat.conversations, livechat.quick_replies,
                livechat.quick_reply_categories, livechat.message_keywords, livechat.customer_ranks TO 'botstudy'@'%';
```

## 1. Counts (no text, no personal data)
Windows (Command Prompt, not PowerShell):
```
mysql -h <host> -P 3306 -u <user> -p --batch livechat < counts.sql > counts.tsv
```

## 2. The tables that hold no customer chat text
```
mysqldump -h <host> -P 3306 -u <user> -p --single-transaction --no-tablespaces --result-file=staging-nonpersonal.sql livechat merchants quick_replies quick_reply_categories message_keywords customer_ranks
```

## 3. Question -> staff answer pairs, personal details masked
```
mysql -h <host> -P 3306 -u <user> -p --batch --default-character-set=utf8mb4 livechat < pairs.sql > pairs.tsv
```
Use the `mysql` program of **MySQL 8** (the old one in XAMPP cannot sign in to a MySQL 8 server).
In PowerShell, `<` and `>` do not work like this: run the line inside `cmd /c "..."`.

## What is masked, and what is not
* Masked: email addresses, web addresses, phone numbers, and any run of 6 or more digits (bank, card, ID, reference numbers).
* Not exported at all: customer names, emails, phones, customer ids, operator names.
* **Not removable by a program:** a name that a customer or a staff member typed inside a message.
  **Someone must read through `pairs.tsv` before it leaves the company**, and delete or edit such lines.

## Send the files
Send `counts.tsv`, `staging-nonpersonal.sql` and `pairs.tsv` over a company-approved channel. Then change the database password.
