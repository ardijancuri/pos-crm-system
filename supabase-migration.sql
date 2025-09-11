-- POS CRM System Database Migration for Supabase
-- Run this SQL in your Supabase SQL Editor

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  password_hash VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'client' CHECK (role IN ('admin', 'client')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create unique index for non-null emails
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique 
ON users (email) 
WHERE email IS NOT NULL;

-- Create products table
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  imei VARCHAR(255),
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  stock_status VARCHAR(50) NOT NULL DEFAULT 'enabled' CHECK (stock_status IN ('enabled', 'disabled')),
  category VARCHAR(50) NOT NULL DEFAULT 'accessories' CHECK (category IN ('accessories', 'smartphones')),
  subcategory VARCHAR(50),
  model VARCHAR(100),
  color VARCHAR(50),
  storage_gb VARCHAR(50),
  barcode VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  client_id INTEGER,
  guest_name VARCHAR(255),
  guest_email VARCHAR(255),
  guest_phone VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'shipped', 'completed', 'cancelled')),
  original_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (original_status IN ('pending', 'approved', 'shipped', 'completed', 'cancelled')),
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(10,2) DEFAULT 0.00,
  discount_currency VARCHAR(10) DEFAULT 'EUR',
  original_total DECIMAL(10,2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (client_id IS NOT NULL OR (guest_name IS NOT NULL))
);

-- Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
);

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL DEFAULT 'POS CRM System',
  company_address TEXT,
  company_city_state VARCHAR(255),
  company_phone VARCHAR(100),
  company_email VARCHAR(255),
  exchange_rate DECIMAL(10,2) DEFAULT 61.50,
  smartphone_subcategories JSONB,
  accessory_subcategories JSONB,
  smartphone_models JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create user_debt_adjustments table
CREATE TABLE IF NOT EXISTS user_debt_adjustments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  adjustment_amount DECIMAL(10,2) NOT NULL,
  adjustment_type VARCHAR(50) NOT NULL CHECK (adjustment_type IN ('manual_set', 'manual_reduction')),
  currency VARCHAR(10) CHECK (currency IN ('EUR','MKD') OR currency IS NULL),
  notes TEXT,
  created_by INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
);


-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_subcategory ON products(subcategory);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_user_debt_adjustments_user_currency ON user_debt_adjustments(user_id, currency);

-- Create trigram indexes for fast search
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_description_trgm ON products USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_imei_trgm ON products USING gin (imei gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_color_trgm ON products USING gin (color gin_trgm_ops);

-- Insert default settings
INSERT INTO settings (
  company_name, 
  company_address, 
  company_city_state, 
  company_phone, 
  company_email, 
  smartphone_subcategories, 
  accessory_subcategories,
  smartphone_models
) VALUES (
  'POS CRM System',
  '123 Business Street',
  'City, State 12345',
  '(555) 123-4567',
  'info@poscrm.com',
  '["iPhone","Samsung","Xiaomi"]'::jsonb,
  '["telephone","smart_watch","headphones","tablet"]'::jsonb,
  '[]'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Insert default admin user (password: Admin@2024Secure!)
INSERT INTO users (name, email, password_hash, role) VALUES (
  'Admin User', 
  'admin@poscrm.com', 
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- Admin@2024Secure!
  'admin'
) ON CONFLICT (email) DO NOTHING;

-- Insert sample client users
INSERT INTO users (name, phone, role) VALUES 
  ('John Doe', '+389 70 123 456', 'client'),
  ('Jane Smith', '+389 71 234 567', 'client')
ON CONFLICT DO NOTHING;

-- Insert sample products
INSERT INTO products (name, description, price, stock_quantity, stock_status, category, subcategory) VALUES 
  ('iPhone 15 Pro', 'Latest iPhone with advanced features', 999.99, 50, 'enabled', 'smartphones', null),
  ('Samsung Galaxy S24', 'Premium Android smartphone', 899.99, 45, 'enabled', 'smartphones', null),
  ('AirPods Pro', 'Wireless earbuds with noise cancellation', 249.99, 100, 'enabled', 'accessories', 'headphones'),
  ('MacBook Pro 16"', 'Professional laptop for power users', 2499.99, 20, 'enabled', 'accessories', 'tablet'),
  ('iPad Air', 'Versatile tablet for work and play', 599.99, 75, 'enabled', 'accessories', 'tablet'),
  ('Apple Watch Series 9', 'Advanced smartwatch with health features', 399.99, 60, 'enabled', 'accessories', 'smart_watch'),
  ('USB-C Cable', 'High-quality charging cable', 19.99, 200, 'enabled', 'accessories', 'telephone'),
  ('Wireless Charger', 'Fast wireless charging pad', 49.99, 80, 'enabled', 'accessories', 'telephone')
ON CONFLICT DO NOTHING;

