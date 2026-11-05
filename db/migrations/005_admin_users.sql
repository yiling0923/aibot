-- People who can sign in to the control panel. A staff user belongs to one merchant and can only see and change that merchant.
CREATE TABLE admin_users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password_hash VARCHAR(300) NOT NULL,
  role VARCHAR(10) NOT NULL,                       -- admin (all merchants) | staff (one merchant)
  merchant_id BIGINT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE);
