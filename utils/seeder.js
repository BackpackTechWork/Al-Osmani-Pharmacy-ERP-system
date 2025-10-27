const bcrypt = require("bcrypt");
const pool = require("../config/database");

const seedData = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    
    console.log("\nStarting database seeding...\n");


    console.log("Seeding branches...");
    const [existingBranches] = await connection.query("SELECT COUNT(*) as count FROM branches");
    
    if (existingBranches[0].count === 0) {
      await connection.query(`
        INSERT INTO branches (name, address, city, state, zip_code, is_active) VALUES
        ('Main Branch', '123 Main Street', 'Khartoum', 'Khartoum State', '11111', TRUE),
        ('North Branch', '456 North Avenue', 'Omdurman', 'Khartoum State', '22222', TRUE),
        ('East Branch', '789 East Road', 'Bahri', 'Khartoum State', '33333', TRUE)
      `);
      console.log("Branches seeded successfully");
    } else {
      console.log("Branches already exist, skipping...");
    }


    console.log("Seeding categories...");
    const [existingCategories] = await connection.query("SELECT COUNT(*) as count FROM categories");
    
    if (existingCategories[0].count === 0) {
      await connection.query(`
        INSERT INTO categories (name, description) VALUES
        ('Pain Relief', 'Medications for pain management'),
        ('Antibiotics', 'Bacterial infection treatments'),
        ('Vitamins & Supplements', 'Nutritional supplements and vitamins'),
        ('Cold & Flu', 'Medications for cold and flu symptoms'),
        ('Digestive Health', 'Medications for digestive issues'),
        ('First Aid', 'First aid supplies and medications'),
        ('Skin Care', 'Topical treatments and skin care products'),
        ('Diabetes Care', 'Diabetes management products')
      `);
      console.log("Categories seeded successfully");
    } else {
      console.log("Categories already exist, skipping...");
    }


    const [categories] = await connection.query("SELECT id, name FROM categories");
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat.name] = cat.id;
    });


    console.log("Seeding products...");
    const [existingProducts] = await connection.query("SELECT COUNT(*) as count FROM products");
    
    if (existingProducts[0].count === 0) {
      await connection.query(`
        INSERT INTO products (name, description, category_id, sku, unit_price, cost_price, floor_level, requires_prescription, manufacturer, image_url) VALUES
        ('Paracetamol 500mg', 'Pain relief and fever reducer', ?, 'PAR-500-001', 5.00, 3.00, 100, FALSE, 'PharmaCorp', '/Product Images/Seed/paracetamol.jpg'),
        ('Ibuprofen 400mg', 'Anti-inflammatory pain relief', ?, 'IBU-400-001', 8.00, 5.00, 100, FALSE, 'MediPharm', '/Product Images/Seed/ibuprofen.jpg'),
        ('Amoxicillin 500mg', 'Broad-spectrum antibiotic', ?, 'AMO-500-001', 25.00, 15.00, 50, TRUE, 'BioMed Ltd', '/Product Images/Seed/amoxicillin.jpg'),
        ('Vitamin C 1000mg', 'Immune system support', ?, 'VIT-C-001', 15.00, 10.00, 75, FALSE, 'NutriHealth', '/Product Images/Seed/vitamin-c.jpg'),
        ('Multivitamin Daily', 'Complete daily vitamin supplement', ?, 'MUL-VIT-001', 30.00, 20.00, 60, FALSE, 'HealthPlus', '/Product Images/Seed/multivitamin.jpg'),
        ('Cough Syrup 100ml', 'Relief from cough and cold', ?, 'COU-SYR-001', 12.00, 7.00, 80, FALSE, 'ColdCare', '/Product Images/Seed/cough-syrup.jpg'),
        ('Loratadine 10mg', 'Antihistamine for allergies', ?, 'LOR-10-001', 10.00, 6.00, 70, FALSE, 'AllergyFree', '/Product Images/Seed/loratadine.jpg'),
        ('Omeprazole 20mg', 'Reduces stomach acid', ?, 'OME-20-001', 20.00, 12.00, 50, FALSE, 'DigestWell', '/Product Images/Seed/omeprazole.jpg'),
        ('Antiseptic Cream 50g', 'Prevents infection in cuts', ?, 'ANT-CRM-001', 8.00, 5.00, 100, FALSE, 'FirstAid Co', '/Product Images/Seed/antiseptic-cream.jpg'),
        ('Bandages Pack', 'Assorted bandages for wounds', ?, 'BAN-PCK-001', 5.00, 3.00, 150, FALSE, 'MedSupply', '/Product Images/Seed/bandages.jpg'),
        ('Hydrocortisone Cream 1%', 'Relief from itching and inflammation', ?, 'HYD-CRM-001', 15.00, 9.00, 60, FALSE, 'SkinCare Pro', '/Product Images/Seed/hydrocortisone.jpg'),
        ('Glucose Test Strips 50ct', 'Blood glucose monitoring', ?, 'GLU-TST-001', 40.00, 25.00, 40, FALSE, 'DiabetesCare', '/Product Images/Seed/glucose-strips.jpg'),
        ('Insulin Syringes 100ct', 'Sterile insulin syringes', ?, 'INS-SYR-001', 35.00, 22.00, 30, TRUE, 'MedEquip', '/Product Images/Seed/insulin-syringes.jpg'),
        ('Aspirin 75mg', 'Blood thinner and pain relief', ?, 'ASP-75-001', 6.00, 4.00, 100, FALSE, 'CardioHealth', '/Product Images/Seed/aspirin.jpg'),
        ('Cetirizine 10mg', 'Antihistamine for allergies', ?, 'CET-10-001', 9.00, 5.50, 80, FALSE, 'AllergyRelief', '/Product Images/Seed/cetirizine.jpg')
      `, [
        categoryMap['Pain Relief'], categoryMap['Pain Relief'], categoryMap['Antibiotics'],
        categoryMap['Vitamins & Supplements'], categoryMap['Vitamins & Supplements'],
        categoryMap['Cold & Flu'], categoryMap['Cold & Flu'], categoryMap['Digestive Health'],
        categoryMap['First Aid'], categoryMap['First Aid'], categoryMap['Skin Care'],
        categoryMap['Diabetes Care'], categoryMap['Diabetes Care'], categoryMap['Pain Relief'],
        categoryMap['Cold & Flu']
      ]);
      console.log("Products seeded successfully");
    } else {
      console.log("Products already exist, skipping...");
    }


    const [branches] = await connection.query("SELECT id FROM branches");
    const [products] = await connection.query("SELECT id FROM products");


    console.log("Seeding inventory...");
    const [existingInventory] = await connection.query("SELECT COUNT(*) as count FROM inventory");
    
    if (existingInventory[0].count === 0) {
      for (const branch of branches) {
        for (const product of products) {
          await connection.query(`
            INSERT INTO inventory (product_id, branch_id) VALUES (?, ?)
          `, [product.id, branch.id]);
        }
      }
      console.log("Inventory records seeded successfully");
    } else {
      console.log("Inventory records already exist, skipping...");
    }


    console.log("Seeding restock data...");
    const [existingRestock] = await connection.query("SELECT COUNT(*) as count FROM restock");
    
    if (existingRestock[0].count === 0) {
      for (const branch of branches) {
        for (const product of products) {
          const quantity = Math.floor(Math.random() * 400) + 100;
          const expiryDate = new Date();
          expiryDate.setFullYear(expiryDate.getFullYear() + (Math.random() > 0.5 ? 1 : 2));
          const formattedDate = expiryDate.toISOString().split('T')[0];
          const batchNumber = `BATCH-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
          
          await connection.query(`
            INSERT INTO restock (product_id, branch_id, quantity, expiry_date, batch_number)
            VALUES (?, ?, ?, ?, ?)
          `, [product.id, branch.id, quantity, formattedDate, batchNumber]);
        }
      }
      console.log("Restock data seeded successfully");
    } else {
      console.log("Restock data already exists, skipping...");
    }


    console.log("Seeding sample users...");
    const [existingUsers] = await connection.query("SELECT COUNT(*) as count FROM users WHERE role IN ('employee', 'customer')");
    
    if (existingUsers[0].count === 0) {
      const defaultPassword = await bcrypt.hash("1234567890", 10);
      
      for (let i = 1; i <= branches.length; i++) {
        await connection.query(`
          INSERT INTO users (username, email, password_hash, first_name, last_name, phone, role, branch_id, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 'employee', ?, TRUE)
        `, [
          `employee${i}`,
          `employee${i}@pharmacy.com`,
          defaultPassword,
          `Employee`,
          `${i}`,
          `+249 91${i} 234 567${i}`,
          branches[i - 1].id
        ]);
      }

      for (let i = 1; i <= 5; i++) {
        await connection.query(`
          INSERT INTO users (username, email, password_hash, first_name, last_name, phone, role, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 'customer', TRUE)
        `, [
          `customer${i}`,
          `customer${i}@email.com`,
          defaultPassword,
          `Customer`,
          `${i}`,
          `+249 92${i} 345 678${i}`
        ]);
      }
      
      console.log("Sample users seeded successfully");
      console.log("  Employee credentials: employee1 / password123");
      console.log("  Customer credentials: customer1 / password123");
    } else {
      console.log("Sample users already exist, skipping...");
    }

    console.log("Seeding sample orders...");
    const [existingOrders] = await connection.query("SELECT COUNT(*) as count FROM orders");
    
    if (existingOrders[0].count === 0) {
      const [customers] = await connection.query("SELECT id FROM users WHERE role = 'customer' LIMIT 5");
      const [admin] = await connection.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      
      if (customers.length > 0 && admin.length > 0) {
        for (let i = 0; i < 10; i++) {
          const customer = customers[Math.floor(Math.random() * customers.length)];
          const branch = branches[Math.floor(Math.random() * branches.length)];
          const orderType = Math.random() > 0.5 ? 'pickup' : 'delivery';
          const statuses = ['pending', 'processing', 'ready', 'completed', 'shipped'];
          const status = statuses[Math.floor(Math.random() * statuses.length)];
          
          const daysAgo = Math.floor(Math.random() * 30);
          const orderDate = new Date();
          orderDate.setDate(orderDate.getDate() - daysAgo);
          orderDate.setHours(Math.floor(Math.random() * 12) + 8);
          orderDate.setMinutes(Math.floor(Math.random() * 60));
          const formattedOrderDate = orderDate.toISOString().slice(0, 19).replace('T', ' ');
          
          const numItems = Math.floor(Math.random() * 4) + 1;
          let subtotal = 0;
          const orderItems = [];
          
          for (let j = 0; j < numItems; j++) {
            const product = products[Math.floor(Math.random() * products.length)];
            const quantity = Math.floor(Math.random() * 3) + 1;
            const [productData] = await connection.query("SELECT unit_price FROM products WHERE id = ?", [product.id]);
            const unitPrice = parseFloat(productData[0].unit_price);
            const itemSubtotal = unitPrice * quantity;
            subtotal += itemSubtotal;
            orderItems.push({ product_id: product.id, quantity, unit_price: unitPrice, subtotal: itemSubtotal });
          }
          
          const tax = subtotal * 0.08;
          const deliveryFee = orderType === 'delivery' ? 10.00 : 0;
          const total = subtotal + tax + deliveryFee;
          
          const [orderResult] = await connection.query(`
            INSERT INTO orders (customer_id, branch_id, order_type, status, subtotal, tax, delivery_fee, total, 
                                delivery_address, delivery_city, delivery_state, delivery_zip, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            customer.id, branch.id, orderType, status, subtotal, tax, deliveryFee, total,
            orderType === 'delivery' ? '456 Customer Street' : null,
            orderType === 'delivery' ? 'Khartoum' : null,
            orderType === 'delivery' ? 'Khartoum State' : null,
            orderType === 'delivery' ? '12345' : null,
            admin[0].id, formattedOrderDate, formattedOrderDate
          ]);
          
          for (const item of orderItems) {
            await connection.query(`
              INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [orderResult.insertId, item.product_id, item.quantity, item.unit_price, item.subtotal, formattedOrderDate]);
          }
        }
        console.log("Sample orders seeded successfully");
      }
    } else {
      console.log("Sample orders already exist, skipping...");
    }

    console.log("Seeding sample sales...");
    const [existingSales] = await connection.query("SELECT COUNT(*) as count FROM sales");
    
    if (existingSales[0].count === 0) {
      const [employees] = await connection.query("SELECT id, branch_id FROM users WHERE role = 'employee'");
      const [customers] = await connection.query("SELECT id FROM users WHERE role = 'customer' LIMIT 5");
      
      if (employees.length > 0) {
        for (let i = 0; i < 20; i++) {
          const employee = employees[Math.floor(Math.random() * employees.length)];
          const customer = Math.random() > 0.3 ? customers[Math.floor(Math.random() * customers.length)] : null;
          
          const daysAgo = Math.floor(Math.random() * 30);
          const saleDate = new Date();
          saleDate.setDate(saleDate.getDate() - daysAgo);
          saleDate.setHours(Math.floor(Math.random() * 12) + 8);
          saleDate.setMinutes(Math.floor(Math.random() * 60));
          const formattedSaleDate = saleDate.toISOString().slice(0, 19).replace('T', ' ');
          
          const numItems = Math.floor(Math.random() * 5) + 1;
          let subtotal = 0;
          const saleItems = [];
          
          for (let j = 0; j < numItems; j++) {
            const product = products[Math.floor(Math.random() * products.length)];
            const quantity = Math.floor(Math.random() * 4) + 1;
            const [productData] = await connection.query("SELECT unit_price FROM products WHERE id = ?", [product.id]);
            const unitPrice = parseFloat(productData[0].unit_price);
            const itemSubtotal = unitPrice * quantity;
            subtotal += itemSubtotal;
            saleItems.push({ product_id: product.id, quantity, unit_price: unitPrice, subtotal: itemSubtotal });
          }
          
          const discountType = Math.random() > 0.7 ? 'percentage' : 'fixed';
          const discount = Math.random() > 0.7 ? (discountType === 'percentage' ? 10 : 5) : 0;
          const discountAmount = discountType === 'percentage' ? (subtotal * discount / 100) : discount;
          const tax = (subtotal - discountAmount) * 0.08;
          const total = subtotal - discountAmount + tax;
          
          const paymentMethods = ['cash', 'card', 'insurance'];
          const paymentMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];
          
          const [saleResult] = await connection.query(`
            INSERT INTO sales (branch_id, employee_id, customer_id, subtotal, tax, discount, discount_type, 
                              total, payment_method, payment_status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)
          `, [employee.branch_id, employee.id, customer?.id || null, subtotal, tax, discount, discountType, total, paymentMethod, formattedSaleDate]);
          
          for (const item of saleItems) {
            await connection.query(`
              INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [saleResult.insertId, item.product_id, item.quantity, item.unit_price, item.subtotal, formattedSaleDate]);
            
            await connection.query(`
              INSERT INTO inventory_transactions (product_id, branch_id, transaction_type, quantity, 
                                                  reference_id, reference_type, performed_by, created_at)
              VALUES (?, ?, 'sale', ?, ?, 'sale', ?, ?)
            `, [item.product_id, employee.branch_id, -item.quantity, saleResult.insertId, employee.id, formattedSaleDate]);
          }
        }
        console.log("Sample sales seeded successfully");
      }
    } else {
      console.log("Sample sales already exist, skipping...");
    }

    console.log("\nDatabase seeding completed successfully!\n");
    
  } catch (error) {
    console.error("\nError seeding database:", error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

module.exports = seedData;
