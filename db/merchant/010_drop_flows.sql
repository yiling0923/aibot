-- Flows (a drawn conversation per topic) were removed. Merchant databases that had the table lose it; new ones never needed it.
DROP TABLE IF EXISTS flows;
