require("dotenv").config()
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");


const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "password",
  database: process.env.DB_NAME || "pharmacy_inventory_system",
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});


const initializeDatabase = async () => {
  let connection;
  try {

    connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "password",
      port: process.env.DB_PORT || 3306,
      multipleStatements: true,
    });


    await connection.query(`CREATE DATABASE IF NOT EXISTS pharmacy_inventory`);
    
    await connection.query(`USE pharmacy_inventory`);


    const schema = `
    CREATE TABLE IF NOT EXISTS branches (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      address TEXT NOT NULL,
      city VARCHAR(100) NOT NULL,
      state VARCHAR(100) NOT NULL,
      zip_code VARCHAR(20) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(100) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      phone VARCHAR(20),
      role ENUM('admin', 'employee', 'customer') NOT NULL,
      branch_id INT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS employee_branch_access (
      id INT PRIMARY KEY AUTO_INCREMENT,
      employee_id INT NOT NULL,
      branch_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      UNIQUE KEY unique_employee_branch (employee_id, branch_id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category_id INT,
      sku VARCHAR(100) UNIQUE NOT NULL,
      unit_price DECIMAL(10, 2) NOT NULL,
      cost_price DECIMAL(10, 2) NOT NULL,
      floor_level INT NOT NULL DEFAULT 50,
      requires_prescription BOOLEAN DEFAULT FALSE,
      manufacturer VARCHAR(255),
      is_active BOOLEAN DEFAULT TRUE,
      image_url VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INT PRIMARY KEY AUTO_INCREMENT,
      product_id INT NOT NULL,
      branch_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS restock (
      id INT PRIMARY KEY AUTO_INCREMENT,
      product_id INT NOT NULL,
      branch_id INT NOT NULL,
      quantity INT NOT NULL,
      expiry_date DATE NOT NULL,
      batch_number VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      customer_id INT NOT NULL,
      branch_id INT,
      order_type ENUM('pickup', 'delivery') NOT NULL,
      status ENUM('pending', 'processing', 'ready', 'completed', 'cancelled', 'shipped', 'requested') DEFAULT 'pending',
      subtotal DECIMAL(10, 2) NOT NULL,
      tax DECIMAL(10, 2) NOT NULL DEFAULT 0,
      discount DECIMAL(10, 2) NOT NULL DEFAULT 0,
      discount_type ENUM('percentage', 'fixed') DEFAULT 'fixed',
      delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 0,
      total DECIMAL(10, 2) NOT NULL,
      delivery_address TEXT,
      delivery_city VARCHAR(100),
      delivery_state VARCHAR(100),
      delivery_zip VARCHAR(20),
      notes TEXT,
      created_by INT NOT NULL,
      updated_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL,
      unit_price DECIMAL(10, 2) NOT NULL,
      subtotal DECIMAL(10, 2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INT PRIMARY KEY AUTO_INCREMENT,
      branch_id INT NOT NULL,
      employee_id INT NOT NULL,
      customer_id INT,
      subtotal DECIMAL(10, 2) NOT NULL,
      tax DECIMAL(10, 2) NOT NULL DEFAULT 0,
      discount DECIMAL(10, 2) NOT NULL DEFAULT 0,
      discount_type ENUM('percentage', 'fixed') DEFAULT 'fixed',
      total DECIMAL(10, 2) NOT NULL,
      payment_method ENUM('cash', 'card', 'insurance') NOT NULL,
      payment_status ENUM('paid', 'pending', 'refunded') NOT NULL DEFAULT 'paid',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      sale_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL,
      unit_price DECIMAL(10, 2) NOT NULL,
      subtotal DECIMAL(10, 2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cart (
      id INT PRIMARY KEY AUTO_INCREMENT,
      customer_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE KEY unique_customer_product (customer_id, product_id),
      INDEX idx_customer_id (customer_id),
      INDEX idx_product_id (product_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      product_id INT NOT NULL,
      branch_id INT NOT NULL,
      transaction_type ENUM('restock', 'sale', 'adjustment', 'transfer', 'return') NOT NULL,
      quantity INT NOT NULL,
      reference_id INT,
      reference_type VARCHAR(50),
      performed_by INT NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE CASCADE
    );
    `;

    await connection.query(schema);

    const indexes = [
      { name: "idx_users_role", table: "users", columns: "role" },
      { name: "idx_users_branch", table: "users", columns: "branch_id" },
      { name: "idx_inventory_branch", table: "inventory", columns: "branch_id" },
      { name: "idx_inventory_product", table: "inventory", columns: "product_id" },
      { name: "idx_orders_customer", table: "orders", columns: "customer_id" },
      { name: "idx_orders_branch", table: "orders", columns: "branch_id" },
      { name: "idx_orders_status", table: "orders", columns: "status" },
      { name: "idx_sales_branch", table: "sales", columns: "branch_id" },
      { name: "idx_sales_employee", table: "sales", columns: "employee_id" },
      { name: "idx_sales_created", table: "sales", columns: "created_at" },

      { name: "idx_restock_product_branch", table: "restock", columns: "product_id, branch_id" },
      { name: "idx_order_items_product", table: "order_items", columns: "product_id" },
      { name: "idx_sale_items_product", table: "sale_items", columns: "product_id" },
      { name: "idx_sales_payment_status", table: "sales", columns: "payment_status" },
    ];


    for (const index of indexes) {
      try {
        const [existing] = await connection.query(
          `SELECT COUNT(*) as count FROM information_schema.STATISTICS 
           WHERE table_schema = ? AND table_name = ? AND index_name = ?`,
          ["pharmacy_inventory", index.table, index.name]
        );
        
        if (existing[0].count === 0) {
          await connection.query(`CREATE INDEX ${index.name} ON ${index.table}(${index.columns})`);
        }
      } catch (err) {

      }
    }

    const adminEmail = process.env.ADMIN_EMAIL || "admin@admin.com";
    const adminUsername = process.env.ADMIN_USERNAME || "admin";
    const adminPassword = process.env.ADMIN_PASSWORD || "password";
    const adminFirstName = process.env.ADMIN_FIRSTNAME || "System";
    const adminLastName = process.env.ADMIN_LASTNAME || "Admin";
    
    const [adminExists] = await connection.query(
      "SELECT id FROM users WHERE email = ?",
      [adminEmail]
    );
    
    if (adminExists.length === 0) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await connection.query(
        `INSERT INTO users (username, email, password_hash, first_name, last_name, role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [adminUsername, adminEmail, hashedPassword, adminFirstName, adminLastName, "admin"]
      );
      console.log(`Admin created: ${adminUsername} (${adminEmail})`);
    } else {
      console.log(`Admin already exists: ${adminUsername} (${adminEmail})`);
    }
  } catch (err) {
    console.error("Database initialization error:", err);
    process.exit(1);
  }
};


initializeDatabase().catch((err) => {
  process.exit(1);
});


module.exports = pool;
module.exports.initializeDatabase = initializeDatabase;
