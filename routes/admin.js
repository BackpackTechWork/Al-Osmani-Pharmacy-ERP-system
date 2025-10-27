const express = require("express")
const router = express.Router()
const bcrypt = require("bcryptjs")
const { requireRole } = require("../middleware/auth")
const db = require("../config/database")
const multer = require("multer")
const sharp = require("sharp")
const path = require("path")
const fs = require("fs").promises


router.use(requireRole("admin"))

async function generateUniqueSKU() {
  for (let i = 0; i < 5; i++) {
    const randomDigits = Math.floor(1000000 + Math.random() * 9000000);
    const sku = `MP${randomDigits}`;
    const [existing] = await db.query("SELECT 1 FROM products WHERE sku = ? LIMIT 1", [sku]);
    if (existing.length === 0) return sku;
  }
  return `MP${Date.now().toString().slice(-7)}`;
}


const storage = multer.memoryStorage()
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
    const mimetype = allowedTypes.test(file.mimetype)
    
    if (mimetype && extname) {
      return cb(null, true)
    } else {
      cb(new Error("Only image files are allowed!"))
    }
  }
})


async function processAndSaveImage(file, productName) {
  try {
    const timestamp = Date.now()
    const sanitizedName = productName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    const filename = `${sanitizedName}_${timestamp}.webp`
    const outputPath = path.join(__dirname, '../public/Product Images', filename)
    

    await sharp(file.buffer)
      .resize(800, 800, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 80 })
      .toFile(outputPath)
    
    return `/Product Images/${filename}`
  } catch (error) {
    console.error("Image processing error:", error)
    throw error
  }
}


router.get("/dashboard", async (req, res) => {
  try {
    const [[branchCount]] = await db.query(
      "SELECT COUNT(*) as count FROM branches WHERE is_active = TRUE"
    );
    const [[customerCount]] = await db.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'customer' AND is_active = TRUE"
    );    
    const [[productCount]] = await db.query(
      "SELECT COUNT(*) as count FROM products WHERE is_active = TRUE"
    );


    let orderCount = 0;
    try {
      const [[orders]] = await db.query(
        "SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'processing')"
      );
      orderCount = orders.count;
    } catch (err) {

      orderCount = 0;
    }


    const [lowStock] = await db.query(`
      SELECT 
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        b.id AS branch_id,
        b.name AS branch_name,
        COALESCE((
          SELECT SUM(r.quantity)
          FROM restock r
          WHERE r.product_id = i.product_id 
            AND r.branch_id = i.branch_id
        ), 0)
        - COALESCE((
          SELECT SUM(oi.quantity)
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE oi.product_id = i.product_id 
            AND o.branch_id = i.branch_id
            AND o.status IN ('shipped', 'completed', 'ready')
        ), 0)
        - COALESCE((
          SELECT SUM(si.quantity)
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE si.product_id = i.product_id 
            AND s.branch_id = i.branch_id
            AND s.payment_status = 'paid'
        ), 0) AS total_stock,
        p.floor_level
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      JOIN branches b ON i.branch_id = b.id
      WHERE p.is_active = TRUE
      HAVING total_stock <= p.floor_level OR ABS(total_stock - p.floor_level) = 20
      ORDER BY b.name, p.name
    `);
    

    let salesByBranch = [];
    let salesByBranchChart = [];
    
    try {
      const [branchData] = await db.query(`
        SELECT 
          b.id,
          b.name,
          COUNT(combined.id) AS sale_count,
          COALESCE(SUM(combined.total_revenue), 0) AS total_sales
        FROM (
          -- Combine Sales + Completed Orders
          SELECT s.id, s.branch_id, s.total AS total_revenue
          FROM sales s
          WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND s.payment_status = 'paid'
    
          UNION ALL
    
          SELECT o.id, o.branch_id, o.total AS total_revenue
          FROM orders o
          WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND o.status = 'completed'
        ) AS combined
        JOIN branches b ON b.id = combined.branch_id
        WHERE b.is_active = TRUE
        GROUP BY b.id, b.name
        ORDER BY total_sales DESC
        LIMIT 10;
      `);
    

      salesByBranch = branchData.map(b => ({
        id: b.id,
        name: b.name,
        sale_count: b.sale_count,
        total_sales: parseFloat(b.total_sales || 0),
      }));
    
      salesByBranchChart = branchData.map(b => ({
        name: b.name,
        total_revenue: parseFloat(b.total_sales || 0),
      }));
    } catch (err) {
      console.log("Sales/Orders by branch data may not be available:", err.message);
      salesByBranch = [];
      salesByBranchChart = [];
    }
    
    

    let recentSales = [];
    try {
      const [sales] = await db.query(`
        SELECT s.*, b.name as branch_name, u.first_name, u.last_name
        FROM sales s
        JOIN branches b ON s.branch_id = b.id
        JOIN users u ON s.employee_id = u.id
        ORDER BY s.created_at DESC
        LIMIT 10
      `);
      recentSales = sales;
    } catch (err) {
      console.log("Sales table may not exist yet:", err.message);
      recentSales = [];
    }


    let salesOverTime = [];
    try {
      const [salesData] = await db.query(`
        SELECT DATE(s.created_at) as date, 
              COALESCE(SUM(s.total), 0) as sales_total
        FROM sales s
        WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(s.created_at)
      `);

      const [orderData] = await db.query(`
        SELECT DATE(o.created_at) as date, 
               COALESCE(SUM(o.total), 0) as orders_total
        FROM orders o
        WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND o.status = 'completed'
        GROUP BY DATE(o.created_at)
      `);      


      const map = new Map();

      salesData.forEach(row => {
        const d = row.date.toISOString().split('T')[0];
        map.set(d, { date: d, sales_total: row.sales_total, orders_total: 0 });
      });

      orderData.forEach(row => {
        const d = row.date.toISOString().split('T')[0];
        if (map.has(d)) {
          map.get(d).orders_total = row.orders_total;
        } else {
          map.set(d, { date: d, sales_total: 0, orders_total: row.orders_total });
        }
      });

      salesOverTime = Array.from(map.values()).sort((a, b) => new Date(a.date) - new Date(b.date));
    } catch (err) {
      console.log("Sales/Orders over time data may not be available:", err.message);
      salesOverTime = [];
    }


    let topProducts = [];
    try {
      const [productsData] = await db.query(`
        SELECT 
          p.id,
          p.name,
          p.sku,
          SUM(total_quantity) AS total_quantity_sold,
          SUM(total_revenue) AS total_revenue
        FROM (
          -- From Sales
          SELECT 
            si.product_id,
            SUM(si.quantity) AS total_quantity,
            COALESCE(SUM(si.subtotal), 0) AS total_revenue
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND s.payment_status = 'paid'
          GROUP BY si.product_id
          
          UNION ALL
          
          -- From Completed Orders
          SELECT 
            oi.product_id,
            SUM(oi.quantity) AS total_quantity,
            COALESCE(SUM(oi.subtotal), 0) AS total_revenue
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND o.status = 'completed'
          GROUP BY oi.product_id
        ) AS combined
        JOIN products p ON p.id = combined.product_id
        GROUP BY p.id, p.name, p.sku
        ORDER BY total_quantity_sold DESC
        LIMIT 10;
      `);
      topProducts = productsData;
    } catch (err) {
      console.log("Top products data may not be available:", err.message);
      topProducts = [];
    }




    let inventoryStatus = [];
    try {
      const [inventoryData] = await db.query(`
        SELECT status, COUNT(*) as count
        FROM (
          SELECT 
            CASE 
              WHEN ABS(total_stock - floor_level) = 20 THEN 'Critical'
              WHEN total_stock < floor_level THEN 'Reorder'
              ELSE 'In Stock'
            END as status
          FROM (
            SELECT i.product_id, i.branch_id,
              COALESCE((
                SELECT SUM(r.quantity)
                FROM restock r
                WHERE r.product_id = i.product_id 
                  AND r.branch_id = i.branch_id
              ), 0) - 
              COALESCE((
                SELECT SUM(oi.quantity)
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                WHERE oi.product_id = i.product_id 
                  AND o.branch_id = i.branch_id
                  AND o.status IN ('shipped', 'completed', 'ready')
              ), 0) -
              COALESCE((
                SELECT SUM(si.quantity)
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.id
                WHERE si.product_id = i.product_id 
                  AND s.branch_id = i.branch_id
                  AND s.payment_status = 'paid'
              ), 0) AS total_stock,
              p.floor_level
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            WHERE p.is_active = TRUE
          ) AS stock_calc
        ) AS filtered_stock
        WHERE status IN ('Critical', 'Reorder', 'In Stock')
        GROUP BY status
      `);      
      inventoryStatus = inventoryData;
    } catch (err) {
      console.log("Inventory status data may not be available:", err.message);
      inventoryStatus = [];
    }

    res.render("admin/dashboard", {
      title: "Admin Dashboard",
      stats: {
        branches: branchCount.count,
        customers: customerCount.count,
        products: productCount.count,
        orders: orderCount,
        user: req.session.user,
      },
      lowStock,
      salesByBranchChart,
      salesByBranch,
      recentSales,
      salesOverTime,
      topProducts,
      inventoryStatus,
      user: req.session.user,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    req.session.error = "Error loading dashboard";
    res.redirect("/");
  }
});



router.get("/branches", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const offset = (page - 1) * limit
    const search = req.query.search || ""
    const statusFilter = req.query.status || ""


    let whereConditions = []
    let queryParams = []

    if (search) {
      whereConditions.push("(b.name LIKE ? OR b.city LIKE ? OR b.state LIKE ? OR b.address LIKE ?)")
      const searchPattern = `%${search}%`
      queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern)
    }

    if (statusFilter === "active") {
      whereConditions.push("b.is_active = TRUE")
    } else if (statusFilter === "inactive") {
      whereConditions.push("b.is_active = FALSE")
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""


    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM branches b ${whereClause}`,
      queryParams
    )
    const totalPages = Math.ceil(total / limit)

    const [branches] = await db.query(
      `SELECT b.*, 
        (SELECT COUNT(*) FROM users WHERE branch_id = b.id AND is_active = TRUE) as employee_count,
        (SELECT COUNT(DISTINCT product_id) FROM inventory WHERE branch_id = b.id) as product_count
       FROM branches b
       ${whereClause}
       ORDER BY b.name
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    )

    res.render("admin/branches", {
      title: "Branch Management",
      branches,
      currentPage: page,
      totalPages,
      totalBranches: total,
      search,
      statusFilter
    })
  } catch (error) {
    console.error("Branches error:", error)
    req.session.error = "Error loading branches"
    res.redirect("/admin/dashboard")
  }
})


router.get("/branches/add", (req, res) => {
  res.render("admin/branch-form", {
    title: "Add Branch",
    branch: null,
  })
})


router.post("/branches/add", async (req, res) => {
  const { name, address, city, state, zipCode } = req.body

  try {
    await db.query(
      "INSERT INTO branches (name, address, city, state, zip_code) VALUES (?, ?, ?, ?, ?)",
      [name, address, city, state, zipCode],
    )

    req.session.success = "Branch added successfully"
    res.redirect("/admin/branches")
  } catch (error) {
    console.error("Add branch error:", error)
    req.session.error = "Error adding branch"
    res.redirect("/admin/branches/add")
  }
})


router.get("/branches/edit/:id", async (req, res) => {
  try {
    const [branches] = await db.query("SELECT * FROM branches WHERE id = ?", [req.params.id])

    if (branches.length === 0) {
      req.session.error = "Branch not found"
      return res.redirect("/admin/branches")
    }

    res.render("admin/branch-form", {
      title: "Edit Branch",
      branch: branches[0],
    })
  } catch (error) {
    console.error("Edit branch error:", error)
    req.session.error = "Error loading branch"
    res.redirect("/admin/branches")
  }
})


router.post("/branches/edit/:id", async (req, res) => {
  const { name, address, city, state, zipCode, isActive } = req.body

  try {
    await db.query(
      "UPDATE branches SET name = ?, address = ?, city = ?, state = ?, zip_code = ?, is_active = ? WHERE id = ?",
      [name, address, city, state, zipCode, isActive === "on" ? 1 : 0, req.params.id],
    )

    req.session.success = "Branch updated successfully"
    res.redirect("/admin/branches")
  } catch (error) {
    console.error("Update branch error:", error)
    req.session.error = "Error updating branch"
    res.redirect(`/admin/branches/edit/${req.params.id}`)
  }
})


router.post("/branches/delete/:id", async (req, res) => {
  try {
    await db.query("UPDATE branches SET is_active = FALSE WHERE id = ?", [req.params.id])
    req.session.success = "Branch deactivated successfully"
    res.redirect("/admin/branches")
  } catch (error) {
    console.error("Delete branch error:", error)
    req.session.error = "Error deactivating branch"
    res.redirect("/admin/branches")
  }
})


router.get("/users", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const offset = (page - 1) * limit
    const search = req.query.search || ""
    const roleFilter = req.query.role || ""
    const statusFilter = req.query.status || ""
    const branchFilter = req.query.branch || ""


    let whereConditions = []
    let queryParams = []

    if (search) {
      whereConditions.push(`
        (CONCAT(u.first_name, ' ', u.last_name) LIKE ? 
         OR u.first_name LIKE ? 
         OR u.last_name LIKE ? 
         OR u.username LIKE ? 
         OR u.email LIKE ? 
         OR u.phone LIKE ?)
      `)
      const searchPattern = `%${search}%`
      queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
    }    

    if (roleFilter) {
      whereConditions.push("u.role = ?")
      queryParams.push(roleFilter)
    }

    if (statusFilter === "active") {
      whereConditions.push("u.is_active = TRUE")
    } else if (statusFilter === "inactive") {
      whereConditions.push("u.is_active = FALSE")
    }

    if (branchFilter) {
      whereConditions.push("u.branch_id = ?")
      queryParams.push(branchFilter)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""


    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM users u ${whereClause}`,
      queryParams
    )
    const totalPages = Math.ceil(total / limit)

    const [users] = await db.query(
      `SELECT u.*, b.name as branch_name
       FROM users u
       LEFT JOIN branches b ON u.branch_id = b.id
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    )


    const [branches] = await db.query("SELECT id, name FROM branches WHERE is_active = TRUE ORDER BY name")

    res.render("admin/users", {
      title: "User Management",
      users,
      branches,
      currentPage: page,
      totalPages,
      totalUsers: total,
      search,
      roleFilter,
      statusFilter,
      branchFilter,
    })
  } catch (error) {
    console.error("Users error:", error)
    req.session.error = "Error loading users"
    res.redirect("/admin/dashboard")
  }
})


router.get("/users/add", async (req, res) => {
  try {
    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")


    const formData = req.session.formData || null
    const userBranches = formData ? formData.employeeBranches : []

    res.render("admin/user-form", {
      title: "Add User",
      formUser: null,
      branches,
      userBranches,
      formData, 
    })


    delete req.session.formData
  } catch (error) {
    console.error("Add user page error:", error)
    req.session.error = "Error loading form"
    res.redirect("/admin/users")
  }
})


router.post("/users/add", async (req, res) => {
  const { username, email, password, firstName, lastName, phone, role, branchId, employeeBranches } = req.body

  try {
    const passwordHash = await bcrypt.hash(password, 10)

    const [result] = await db.query(
      "INSERT INTO users (username, email, password_hash, first_name, last_name, phone, role, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [username, email, passwordHash, firstName, lastName, phone, role, branchId || null],
    )


    if (role === "employee" && employeeBranches) {
      const branches = Array.isArray(employeeBranches) ? employeeBranches : [employeeBranches]
      for (const branchId of branches) {
        await db.query("INSERT INTO employee_branch_access (employee_id, branch_id) VALUES (?, ?)", [
          result.insertId,
          branchId,
        ])
      }
    }

    req.session.success = "User added successfully"
    res.redirect("/admin/users")
  } catch (error) {
    console.error("Add user error:", error)
    
    let errorMessage = "Error adding user"
    

    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('users.email')) {
        errorMessage = "Email address already exists. Please use a different email."
      } else if (error.sqlMessage.includes('users.username')) {
        errorMessage = "Username already exists. Please choose a different username."
      } else {
        errorMessage = "Duplicate entry found. Please check your input."
      }
    } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      errorMessage = "Invalid branch selected. Please choose a valid branch."
    } else if (error.code === 'ER_BAD_NULL_ERROR') {
      errorMessage = "Required fields are missing. Please fill in all required fields."
    }
    

    req.session.formData = {
      username,
      email,
      firstName,
      lastName,
      phone,
      role,
      branchId,
      employeeBranches: Array.isArray(employeeBranches) ? employeeBranches : (employeeBranches ? [employeeBranches] : [])
    }
    

    const errorParams = new URLSearchParams({
      error: 'true',
      message: encodeURIComponent(errorMessage)
    })
    
    res.redirect(`/admin/users/add?${errorParams.toString()}`)
  }
})


router.get("/users/edit/:id", async (req, res) => {
  try {
    const [users] = await db.query("SELECT * FROM users WHERE id = ?", [req.params.id])
    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")
    const [userBranches] = await db.query("SELECT branch_id FROM employee_branch_access WHERE employee_id = ?", [
      req.params.id,
    ])

    if (users.length === 0) {
      req.session.error = "User not found"
      return res.redirect("/admin/users")
    }


    const formData = req.session.formData || null
    const preservedUserBranches = formData ? formData.employeeBranches : userBranches.map((b) => b.branch_id)

    res.render("admin/user-form", {
      title: "Edit User",
      formUser: users[0],
      branches,
      userBranches: preservedUserBranches,
      formData, 
    })


    delete req.session.formData
  } catch (error) {
    console.error("Edit user error:", error)
    req.session.error = "Error loading user"
    res.redirect("/admin/users")
  }
})


router.post("/users/edit/:id", async (req, res) => {
  const { firstName, lastName, email, phone, role, branchId, isActive, employeeBranches, newPassword } = req.body

  try {

    const [userToEdit] = await db.query("SELECT role FROM users WHERE id = ?", [req.params.id])
    
    if (userToEdit.length === 0) {
      req.session.error = "User not found"
      return res.redirect("/admin/users")
    }


    if (userToEdit[0].role === 'admin' && newPassword) {
      req.session.error = "Cannot change password for admin users"
      return res.redirect(`/admin/users/edit/${req.params.id}`)
    }


    await db.query(
      "UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, role = ?, branch_id = ?, is_active = ? WHERE id = ?",
      [firstName, lastName, email, phone, role, branchId || null, isActive === "on" ? 1 : 0, req.params.id],
    )


    if (newPassword && newPassword.trim() && userToEdit[0].role !== 'admin') {
      const passwordHash = await bcrypt.hash(newPassword, 10)
      await db.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, req.params.id])
    }

    
    if (role === "employee") {
      await db.query("DELETE FROM employee_branch_access WHERE employee_id = ?", [req.params.id])

      if (employeeBranches) {
        const branches = Array.isArray(employeeBranches) ? employeeBranches : [employeeBranches]
        for (const branchId of branches) {
          await db.query("INSERT INTO employee_branch_access (employee_id, branch_id) VALUES (?, ?)", [
            req.params.id,
            branchId,
          ])
        }
      }
    }

    let successMessage = "User updated successfully"
    if (newPassword && newPassword.trim() && userToEdit[0].role !== 'admin') {
      successMessage = "User updated successfully and password changed"
    }

    req.session.success = successMessage
    res.redirect("/admin/users")
  } catch (error) {
    console.error("Update user error:", error)
    
    let errorMessage = "Error updating user"
    
    
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('users.email')) {
        errorMessage = "Email address already exists. Please use a different email."
      } else if (error.sqlMessage.includes('users.username')) {
        errorMessage = "Username already exists. Please choose a different username."
      } else {
        errorMessage = "Duplicate entry found. Please check your input."
      }
    } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      errorMessage = "Invalid branch selected. Please choose a valid branch."
    } else if (error.code === 'ER_BAD_NULL_ERROR') {
      errorMessage = "Required fields are missing. Please fill in all required fields."
    }
    
    
    req.session.formData = {
      firstName,
      lastName,
      email,
      phone,
      role,
      branchId,
      isActive,
      employeeBranches: Array.isArray(employeeBranches) ? employeeBranches : (employeeBranches ? [employeeBranches] : [])
    }
    
    
    const errorParams = new URLSearchParams({
      error: 'true',
      message: encodeURIComponent(errorMessage)
    })
    
    res.redirect(`/admin/users/edit/${req.params.id}?${errorParams.toString()}`)
  }
})


router.post("/users/delete/:id", async (req, res) => {
  try {
    await db.query("UPDATE users SET is_active = FALSE WHERE id = ?", [req.params.id])
    req.session.success = "User deactivated successfully"
    res.redirect("/admin/users")
  } catch (error) {
    console.error("Delete user error:", error)
    req.session.error = "Error deactivating user"
    res.redirect("/admin/users")
  }
})


router.get("/products", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const offset = (page - 1) * limit
    const search = req.query.search || ""
    const statusFilter = req.query.status || ""
    const prescriptionFilter = req.query.prescription || ""
    const categoryFilter = req.query.category || ""


    let whereConditions = []
    let queryParams = []

    if (search) {
      whereConditions.push("(p.name LIKE ? OR p.sku LIKE ? OR p.manufacturer LIKE ?)")
      const searchPattern = `%${search}%`
      queryParams.push(searchPattern, searchPattern, searchPattern)
    }

    if (statusFilter === "active") {
      whereConditions.push("p.is_active = TRUE")
    } else if (statusFilter === "inactive") {
      whereConditions.push("p.is_active = FALSE")
    }

    if (prescriptionFilter === "yes") {
      whereConditions.push("p.requires_prescription = TRUE")
    } else if (prescriptionFilter === "no") {
      whereConditions.push("p.requires_prescription = FALSE")
    }

    if (categoryFilter) {

      if (Array.isArray(categoryFilter)) {
        const placeholders = categoryFilter.map(() => '?').join(',')
        whereConditions.push(`p.category_id IN (${placeholders})`)
        queryParams.push(...categoryFilter)
      } else {
        whereConditions.push("p.category_id = ?")
        queryParams.push(categoryFilter)
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""


    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM products p ${whereClause}`,
      queryParams
    )
    const totalPages = Math.ceil(total / limit)

    const [products] = await db.query(
      `SELECT p.*, c.name as category_name,
        p.floor_level
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${whereClause}
       ORDER BY p.name
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    )

    const [categories] = await db.query("SELECT * FROM categories ORDER BY name")

    res.render("admin/products", {
      title: "Product Management",
      products,
      categories,
      currentPage: page,
      totalPages,
      totalProducts: total,
      search,
      statusFilter,
      prescriptionFilter,
      categoryFilter
    })
  } catch (error) {
    console.error("Products error:", error)
    req.session.error = "Error loading products"
    res.redirect("/admin/dashboard")
  }
})


router.get("/products/add", async (req, res) => {
  try {
    const [categories] = await db.query("SELECT * FROM categories ORDER BY name")
    

    const returnUrl = new URLSearchParams(req.query).toString()

    res.render("admin/product-form", {
      title: "Add Product",
      product: null,
      categories,
      returnUrl,
    })
  } catch (error) {
    console.error("Add product page error:", error)
    req.session.error = "Error loading form"
    res.redirect("/admin/products")
  }
})


router.post("/products/add", upload.single('productImage'), async (req, res) => {
  const { name, description, categoryId, unitPrice, costPrice, floorLevel, requiresPrescription, manufacturer, imageUrl, returnUrl } = req.body

  try {

    const sku = await generateUniqueSKU()
    
    let finalImageUrl = null
    

    if (req.file) {

      finalImageUrl = await processAndSaveImage(req.file, name)
    } else if (imageUrl && imageUrl.trim()) {

      finalImageUrl = imageUrl.trim()
    }
    
    await db.query(
      "INSERT INTO products (name, description, category_id, sku, unit_price, cost_price, floor_level, requires_prescription, manufacturer, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        name,
        description,
        categoryId || null,
        sku,
        unitPrice,
        costPrice,
        floorLevel || 50,
        requiresPrescription === "on" ? 1 : 0,
        manufacturer || null,
        finalImageUrl,
      ],
    )

    req.session.success = `Product added successfully with SKU: ${sku}`
    

    let redirectUrl = "/admin/products"
    if (returnUrl) {

      const params = new URLSearchParams(returnUrl)
      const hasFilters = (params.get('search') && params.get('search').trim()) || 
                       (params.get('status') && params.get('status').trim()) || 
                       (params.get('prescription') && params.get('prescription').trim()) || 
                       (params.get('category') && params.get('category').trim())

      if (hasFilters) {

        params.set('page', '1')
        redirectUrl = "/admin/products?" + params.toString()
      } else {

        redirectUrl = "/admin/products?" + returnUrl
      }

    }
    
    res.redirect(redirectUrl)
  } catch (error) {
    console.error("Add product error:", error)
    req.session.error = "Error adding product"
    res.redirect("/admin/products/add")
  }
})


router.get("/products/edit/:id", async (req, res) => {
  try {
    const [products] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id])
    const [categories] = await db.query("SELECT * FROM categories ORDER BY name")

    if (products.length === 0) {
      req.session.error = "Product not found"
      return res.redirect("/admin/products")
    }


    const returnUrl = new URLSearchParams(req.query).toString()

    res.render("admin/product-form", {
      title: "Edit Product",
      product: products[0],
      categories,
      returnUrl,
    })
  } catch (error) {
    console.error("Edit product error:", error)
    req.session.error = "Error loading product"
    res.redirect("/admin/products")
  }
})


router.post("/products/edit/:id", upload.single('productImage'), async (req, res) => {
  const {
    name,
    description,
    categoryId,
    unitPrice,
    costPrice,
    floorLevel,
    requiresPrescription,
    manufacturer,
    isActive,
    imageUrl,
    keepExistingImage,
    returnUrl
  } = req.body

  try {
    let finalImageUrl = null
    

    const [currentProduct] = await db.query("SELECT image_url FROM products WHERE id = ?", [req.params.id])
    
    if (keepExistingImage === "true" && currentProduct.length > 0) {

      finalImageUrl = currentProduct[0].image_url
    } else if (req.file) {

      finalImageUrl = await processAndSaveImage(req.file, name)
      

      if (currentProduct.length > 0 && currentProduct[0].image_url && currentProduct[0].image_url.startsWith('/Product Images/')) {
        try {
          const oldImagePath = path.join(__dirname, '../public', currentProduct[0].image_url)
          await fs.unlink(oldImagePath)
        } catch (err) {
          console.error("Error deleting old image:", err)
        }
      }
    } else if (imageUrl && imageUrl.trim()) {

      finalImageUrl = imageUrl.trim()
    }
    

    await db.query(
      "UPDATE products SET name = ?, description = ?, category_id = ?, unit_price = ?, cost_price = ?, floor_level = ?, requires_prescription = ?, manufacturer = ?, is_active = ?, image_url = ? WHERE id = ?",
      [
        name,
        description,
        categoryId || null,
        unitPrice,
        costPrice,
        floorLevel || 50,
        requiresPrescription === "on" ? 1 : 0,
        manufacturer || null,
        isActive === "on" ? 1 : 0,
        finalImageUrl,
        req.params.id,
      ],
    )

    req.session.success = "Product updated successfully"
    

    let redirectUrl = "/admin/products"
    if (returnUrl) {

      const params = new URLSearchParams(returnUrl)
      const hasFilters = (params.get('search') && params.get('search').trim()) || 
                       (params.get('status') && params.get('status').trim()) || 
                       (params.get('prescription') && params.get('prescription').trim()) || 
                       (params.get('category') && params.get('category').trim())
      
      if (hasFilters) {

        params.set('page', '1')
        redirectUrl = "/admin/products?" + params.toString()
      } else {

        redirectUrl = "/admin/products?" + returnUrl
      }

    }
    
    res.redirect(redirectUrl)
  } catch (error) {
    console.error("Update product error:", error)
    req.session.error = "Error updating product"
    res.redirect(`/admin/products/edit/${req.params.id}`)
  }
})


router.post("/products/delete/:id", async (req, res) => {
  try {
    await db.query("UPDATE products SET is_active = FALSE WHERE id = ?", [req.params.id])
    req.session.success = "Product deactivated successfully"
    res.redirect("/admin/products")
  } catch (error) {
    console.error("Delete product error:", error)
    req.session.error = "Error deactivating product"
    res.redirect("/admin/products")
  }
})


router.get("/inventory", async (req, res) => {
  const branch = req.query.branch || ''
  res.redirect(`/admin/inventory/stock-management${branch ? '?branch=' + branch : ''}`)
})


router.get("/inventory/stock-management", async (req, res) => {
  try {
    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")
    const selectedBranch = req.query.branch || (branches.length > 0 ? branches[0].id : null)
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const offset = (page - 1) * limit
    const search = req.query.search || ""
    const categoryFilter = req.query.category || ""
    const stockStatusFilter = req.query.stockStatus || ""

    if (!selectedBranch) {
      return res.render("admin/stock-management", {
        title: "Stock Management",
        branches,
        selectedBranch: null,
        inventory: [],
        categories: [],
        currentPage: 1,
        totalPages: 0,
        totalInventory: 0,
        search: "",
        categoryFilter: "",
        stockStatusFilter: "",
      })
    }



    let baseQuery = `SELECT i.id, i.product_id, i.branch_id, i.created_at, i.updated_at,
              p.name as product_name, p.sku, p.unit_price, p.cost_price, p.image_url, 
              p.floor_level,
              c.name as category_name,
              
              -- Calculate Total Stock efficiently
              COALESCE((
                SELECT SUM(r.quantity)
                FROM restock r
                WHERE r.product_id = i.product_id 
                  AND r.branch_id = i.branch_id
              ), 0) - 
              COALESCE((
                SELECT SUM(oi.quantity)
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                WHERE oi.product_id = i.product_id 
                  AND o.branch_id = i.branch_id
                  AND o.status IN ('shipped', 'completed', 'ready')
              ), 0) -
              COALESCE((
                SELECT SUM(si.quantity)
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.id
                WHERE si.product_id = i.product_id 
                  AND s.branch_id = i.branch_id
                  AND s.payment_status = 'paid'
              ), 0) AS total_stock
              
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE i.branch_id = ?`
    
    const queryParams = [selectedBranch]
    const countParams = [selectedBranch]

    if (search) {
      baseQuery += ` AND (p.name LIKE ? OR p.sku LIKE ?)`
      const searchTerm = `%${search}%`
      queryParams.push(searchTerm, searchTerm)
      countParams.push(searchTerm, searchTerm)
    }

    if (categoryFilter) {

      if (Array.isArray(categoryFilter)) {
        const placeholders = categoryFilter.map(() => '?').join(',')
        baseQuery += ` AND p.category_id IN (${placeholders})`
        queryParams.push(...categoryFilter)
        countParams.push(...categoryFilter)
      } else {
        baseQuery += ` AND p.category_id = ?`
        queryParams.push(categoryFilter)
        countParams.push(categoryFilter)
      }
    }


    let query = `SELECT * FROM (${baseQuery}) AS inventory_with_stock WHERE 1=1`
    

    if (stockStatusFilter) {
      if (stockStatusFilter === 'critical') {
        query += ` AND ABS(total_stock - floor_level) = 20`
      } else if (stockStatusFilter === 'reorder') {
        query += ` AND total_stock < floor_level AND ABS(total_stock - floor_level) != 20`
      } else if (stockStatusFilter === 'in_stock') {
        query += ` AND total_stock >= floor_level AND ABS(total_stock - floor_level) != 20`
      }
    }

    query += ` ORDER BY product_name LIMIT ? OFFSET ?`
    queryParams.push(limit, offset)


    let countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) AS inventory_with_stock WHERE 1=1`
    
    if (stockStatusFilter) {
      if (stockStatusFilter === 'critical') {
        countQuery += ` AND ABS(total_stock - floor_level) = 20`
      } else if (stockStatusFilter === 'reorder') {
        countQuery += ` AND total_stock < floor_level AND ABS(total_stock - floor_level) != 20`
      } else if (stockStatusFilter === 'in_stock') {
        countQuery += ` AND total_stock >= floor_level AND ABS(total_stock - floor_level) != 20`
      }
    }

    const [inventory] = await db.query(query, queryParams)
    const [[{ total }]] = await db.query(countQuery, countParams)
    const [categories] = await db.query("SELECT * FROM categories ORDER BY name")


    inventory.forEach(item => {
      const stock = item.total_stock
      const floorLevel = item.floor_level
      const diff = Math.abs(stock - floorLevel)
      

      if (stock === 0) {
        item.stock_status = 'reorder'
        item.stock_status_label = 'Reorder'
        item.stock_status_color = '#dc3545' 
        item.stock_status_text_color = '#ffffff' 
      } else if (stock < floorLevel) {

        item.stock_status = 'reorder'
        item.stock_status_label = 'Reorder'
        item.stock_status_color = '#dc3545' 
        item.stock_status_text_color = '#ffffff' 
      } else if (diff === 20) {

        item.stock_status = 'critical'
        item.stock_status_label = 'Critical'
        item.stock_status_color = '#ffc107' 
        item.stock_status_text_color = '#000000' 
      } else {

        item.stock_status = 'in_stock'
        item.stock_status_label = 'In Stock'
        item.stock_status_color = '#28a745' 
        item.stock_status_text_color = '#ffffff' 
      }
    })

    const totalPages = Math.ceil(total / limit)

    res.render("admin/stock-management", {
      title: "Stock Management",
      branches,
      selectedBranch: Number.parseInt(selectedBranch),
      inventory,
      categories,
      currentPage: page,
      totalPages,
      totalInventory: total,
      search,
      categoryFilter,
      stockStatusFilter,
    })
  } catch (error) {
    console.error("Stock Management error:", error)
    req.session.error = "Error loading stock management"
    res.redirect("/admin/dashboard")
  }
})


router.get("/inventory/restock", async (req, res) => {
  try {
    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")
    const selectedBranch = req.query.branch || (branches.length > 0 ? branches[0].id : null)
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const offset = (page - 1) * limit
    const search = req.query.search || ""
    const batchFilter = req.query.batch || ""
    const categoryFilter = req.query.category || ""

    let restockData = []
    let products = []
    let categories = []
    let batchNumbers = []
    let total = 0
    
    if (selectedBranch) {



      const [allCategories] = await db.query("SELECT id, name FROM categories ORDER BY name")
      categories = allCategories


      try {
        const [batches] = await db.query(
          "SELECT DISTINCT batch_number FROM restock WHERE branch_id = ? ORDER BY batch_number DESC",
          [selectedBranch]
        )
        batchNumbers = batches.map(b => b.batch_number)
      } catch (err) {
        console.log("Could not fetch batch numbers:", err.message)
        batchNumbers = []
      }


      let whereConditions = ["r.branch_id = ?"]
      let queryParams = [selectedBranch]

      if (search) {
        whereConditions.push("(p.name LIKE ? OR p.sku LIKE ?)")
        const searchPattern = `%${search}%`
        queryParams.push(searchPattern, searchPattern)
      }


      if (categoryFilter) {

        if (Array.isArray(categoryFilter)) {
          const placeholders = categoryFilter.map(() => '?').join(',')
          whereConditions.push(`p.category_id IN (${placeholders})`)
          queryParams.push(...categoryFilter)
        } else {
          whereConditions.push("p.category_id = ?")
          queryParams.push(categoryFilter)
        }
      }

      if (batchFilter) {
        whereConditions.push("r.batch_number = ?")
        queryParams.push(batchFilter)
      }

      const whereClause = whereConditions.join(" AND ")


      try {
        const [[{ count }]] = await db.query(
          `SELECT COUNT(*) as count FROM restock r
           JOIN products p ON r.product_id = p.id
           WHERE ${whereClause}`,
          queryParams
        )
        total = count
      } catch (err) {
        console.log("Restock table may not exist yet:", err.message)
        total = 0
      }


      try {
        const [restocks] = await db.query(
          `SELECT r.*, p.name as product_name, p.sku, p.image_url,
            c.name as category_name
           FROM restock r
           JOIN products p ON r.product_id = p.id
           LEFT JOIN categories c ON p.category_id = c.id
           WHERE ${whereClause}
           ORDER BY r.created_at DESC
           LIMIT ? OFFSET ?`,
          [...queryParams, limit, offset]
        )
        restockData = restocks
      } catch (err) {
        console.log("Restock table may not exist yet:", err.message)
        restockData = []
      }
    }

    const totalPages = Math.ceil(total / limit)

    res.render("admin/restock", {
      title: "Restock Management",
      branches,
      selectedBranch: selectedBranch ? Number.parseInt(selectedBranch) : null,
      restockData,
      categories,
      batchNumbers,
      currentPage: page,
      totalPages,
      totalRestock: total,
      search,
      categoryFilter,
      batchFilter,
    })
  } catch (error) {
    console.error("Restock error:", error)
    req.session.error = "Error loading restock data"
    res.redirect("/admin/dashboard")
  }
})


router.get("/inventory/restock/add", async (req, res) => {
  try {
    const branchId = req.query.branch || ""

    const [products] = await db.query("SELECT id, name, sku FROM products WHERE is_active = TRUE ORDER BY name")
    const [branches] = await db.query("SELECT id, name FROM branches WHERE is_active = TRUE ORDER BY name")
    const productId = req.query.product || "";

    res.render("admin/restock-form", {
      title: "Add Restock",
      restock: null,
      products,
      branches,
      branchId,
      productId,
    })
  } catch (error) {
    console.error("Add restock page error:", error)
    req.session.error = "Error loading form"
    res.redirect("/admin/inventory/restock")
  }
})


router.get("/inventory/restock/edit/:id", async (req, res) => {
  try {
    const [restocks] = await db.query(
      "SELECT * FROM restock WHERE id = ?",
      [req.params.id]
    )

    if (restocks.length === 0) {
      req.session.error = "Restock entry not found"
      return res.redirect("/admin/inventory/restock")
    }

    const branchId = restocks[0].branch_id
    const [products] = await db.query("SELECT id, name, sku FROM products WHERE is_active = TRUE ORDER BY name")
    const [branches] = await db.query("SELECT id, name FROM branches WHERE is_active = TRUE ORDER BY name")

    res.render("admin/restock-form", {
      title: "Edit Restock",
      restock: restocks[0],
      products,
      branches,
      branchId,
    })
  } catch (error) {
    console.error("Edit restock error:", error)
    req.session.error = "Error loading restock"
    res.redirect("/admin/inventory/restock")
  }
})


router.post("/inventory/restock/add", async (req, res) => {
  const { productId, branchId, quantity, expiryDate } = req.body

  try {

    const [existingInventory] = await db.query(
      "SELECT id FROM inventory WHERE product_id = ? AND branch_id = ?",
      [productId, branchId]
    )


    if (existingInventory.length === 0) {
      await db.query(
        "INSERT INTO inventory (product_id, branch_id) VALUES (?, ?)",
        [productId, branchId]
      )
    }

    const today = new Date()
    const dd = String(today.getDate()).padStart(2, '0')
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const yy = String(today.getFullYear()).slice(-2)
    const batchNumber = `${dd}${mm}${yy}`

    await db.query(
      "INSERT INTO restock (product_id, branch_id, quantity, expiry_date, batch_number) VALUES (?, ?, ?, ?, ?)",
      [productId, branchId, quantity, expiryDate, batchNumber]
    )

    req.session.success = "Restock entry added successfully"
    res.redirect(`/admin/inventory/restock?branch=${branchId}`)
  } catch (error) {
    console.error("Add restock error:", error)
    req.session.error = "Error adding restock entry"
    res.redirect(`/admin/inventory/restock?branch=${branchId}`)
  }
})


router.post("/inventory/restock/edit/:id", async (req, res) => {
  const { productId, branchId, quantity, expiryDate } = req.body

  try {

    const [existingInventory] = await db.query(
      "SELECT id FROM inventory WHERE product_id = ? AND branch_id = ?",
      [productId, branchId]
    )


    if (existingInventory.length === 0) {
      await db.query(
        "INSERT INTO inventory (product_id, branch_id) VALUES (?, ?)",
        [productId, branchId]
      )
    }

    await db.query(
      "UPDATE restock SET branch_id = ?, quantity = ?, expiry_date = ? WHERE id = ?",
      [branchId, quantity, expiryDate, req.params.id]
    )

    req.session.success = "Restock entry updated successfully"
    res.redirect(`/admin/inventory/restock?branch=${branchId}`)
  } catch (error) {
    console.error("Update restock error:", error)
    req.session.error = "Error updating restock entry"
    res.redirect(`/admin/inventory/restock?branch=${branchId}`)
  }
})


router.post("/inventory/restock/delete/:id", async (req, res) => {
  const { branchId } = req.body
  
  try {
    await db.query("DELETE FROM restock WHERE id = ?", [req.params.id])
    req.session.success = "Restock entry deleted successfully"
    res.redirect(`/admin/inventory/restock?branch=${branchId}`)
  } catch (error) {
    console.error("Delete restock error:", error)
    req.session.error = "Error deleting restock entry"
    res.redirect(`/admin/inventory/restock?branch=${branchId}`)
  }
})


router.get("/inventory/orders", async (req, res) => {
  try {
    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")
    const selectedBranch = req.query.branch || (branches.length > 0 ? branches[0].id : null)
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const offset = (page - 1) * limit
    const search = req.query.search || ""
    const orderType = req.query.type || ""
    const statusFilter = req.query.status || ""

    let orders = []
    let total = 0
    
    if (selectedBranch) {

      let whereConditions = ["o.branch_id = ?"]
      let queryParams = [selectedBranch]

      if (search) {
        whereConditions.push("(CONCAT(cu.first_name, ' ', cu.last_name) LIKE ? OR o.id LIKE ?)")
        const searchPattern = `%${search}%`
        queryParams.push(searchPattern, searchPattern)
      }

      if (orderType) {
        whereConditions.push("o.order_type = ?")
        queryParams.push(orderType)
      }

      if (statusFilter) {
        whereConditions.push("o.status = ?")
        queryParams.push(statusFilter)
      }

      const whereClause = whereConditions.join(" AND ")


      try {
        const [[{ count }]] = await db.query(
          `SELECT COUNT(*) as count FROM orders o
           JOIN users cu ON o.customer_id = cu.id
           WHERE ${whereClause}`,
          queryParams
        )
        total = count
      } catch (err) {
        console.log("Orders table may not exist yet:", err.message)
        total = 0
      }


      try {
        const [ordersList] = await db.query(
          `SELECT o.*, 
            CONCAT(cu.first_name, ' ', cu.last_name) as customer_name,
            cu.email as customer_email,
            cu.phone as customer_phone,
            CONCAT(cr.first_name, ' ', cr.last_name) as created_by_name,
            CONCAT(up.first_name, ' ', up.last_name) as updated_by_name,
            COUNT(oi.id) as product_count,
            SUM(oi.quantity) as total_items
           FROM orders o
           JOIN users cu ON o.customer_id = cu.id
           LEFT JOIN users cr ON o.created_by = cr.id
           LEFT JOIN users up ON o.updated_by = up.id
           LEFT JOIN order_items oi ON oi.order_id = o.id
           WHERE ${whereClause}
           GROUP BY o.id
           ORDER BY o.created_at DESC
           LIMIT ? OFFSET ?`,
          [...queryParams, limit, offset]
        )
        orders = ordersList
      } catch (err) {
        console.log("Orders table may not exist yet:", err.message)
        orders = []
      }
    }

    const totalPages = Math.ceil(total / limit)

    res.render("admin/orders", {
      title: "Order Management",
      branches,
      selectedBranch: selectedBranch ? Number.parseInt(selectedBranch) : null,
      orders,
      currentPage: page,
      totalPages,
      totalOrders: total,
      search,
      orderType,
      statusFilter,
    })
  } catch (error) {
    console.error("Orders error:", error)
    req.session.error = "Error loading orders"
    res.redirect("/admin/dashboard")
  }
})


router.get("/inventory/orders/add", async (req, res) => {
  try {
    const branchId = req.query.branch
    if (!branchId) {
      req.session.error = "Please select a branch first"
      return res.redirect("/admin/inventory/orders")
    }

    const [customers] = await db.query("SELECT id, first_name, last_name, email, phone FROM users WHERE role = 'customer' AND is_active = TRUE ORDER BY first_name")


    const baseQuery = `
      SELECT p.id, p.name, p.sku, p.unit_price, p.image_url, p.floor_level,
             (
               COALESCE((
                 SELECT SUM(r.quantity)
                 FROM restock r
                 WHERE r.product_id = i.product_id 
                   AND r.branch_id = i.branch_id
               ), 0) 
               - COALESCE((
                 SELECT SUM(oi.quantity)
                 FROM order_items oi
                 JOIN orders o ON oi.order_id = o.id
                 WHERE oi.product_id = i.product_id 
                   AND o.branch_id = i.branch_id
                   AND o.status IN ('shipped', 'completed', 'ready')
               ), 0)
               - COALESCE((
                 SELECT SUM(si.quantity)
                 FROM sale_items si
                 JOIN sales s ON si.sale_id = s.id
                 WHERE si.product_id = i.product_id 
                   AND s.branch_id = i.branch_id
                   AND s.payment_status = 'paid'
               ), 0)
             ) AS total_stock
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.branch_id = ? AND p.is_active = TRUE
    `

    const [productsRaw] = await db.query(baseQuery, [branchId])
    const products = productsRaw
    .filter(p => (p.total_stock || 0) > 0)
    .map(p => {
      const stock = p.total_stock || 0;
      const floor = p.floor_level || 0;
      const diff = Math.abs(stock - floor);
      let stock_status = {
        key: 'in_stock',
        label: 'In Stock',
        color: '#28a745',
        textColor: '#ffffff'
      };
      if (stock === 0 || stock < floor) {
        stock_status = { key: 'reorder', label: 'Reorder', color: '#dc3545', textColor: '#ffffff' };
      } else if (diff === 20) {
        stock_status = { key: 'critical', label: 'Critical', color: '#ffc107', textColor: '#000000' };
      }
      return { ...p, stock_status };
    });  
    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")

    res.render("admin/order-form", {
      title: "Add Order",
      order: null,
      customers,
      products,
      branches,
      branchId,
    })
  } catch (error) {
    console.error("Add order page error:", error)
    req.session.error = "Error loading form"
    res.redirect("/admin/inventory/orders")
  }
})


router.post("/inventory/orders/add", async (req, res) => {
  const { 
    customerId, branchId, orderType, status, subtotal, tax, discount, discountType,
    deliveryFee, total, deliveryAddress, deliveryCity, deliveryState, deliveryZip, notes,
    orderItems
  } = req.body

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()


    let items = []
    try {
      items = orderItems ? JSON.parse(orderItems) : []
    } catch (err) {
      items = []
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('No order items provided')
    }


    const requestedByProduct = new Map()
    for (const item of items) {
      const pid = Number(item.productId)
      const qty = Number(item.quantity) || 0
      requestedByProduct.set(pid, (requestedByProduct.get(pid) || 0) + qty)
    }


    const productIds = Array.from(requestedByProduct.keys())
    const placeholders = productIds.map(() => '?').join(',')
    const [rows] = await connection.query(
      `SELECT p.id,
              (
                COALESCE((SELECT SUM(r.quantity) FROM restock r WHERE r.product_id = p.id AND r.branch_id = ?), 0)
                - COALESCE((
                    SELECT SUM(oi.quantity)
                    FROM order_items oi
                    JOIN orders o ON oi.order_id = o.id
                    WHERE oi.product_id = p.id AND o.branch_id = ? AND o.status IN ('shipped','completed','ready')
                  ), 0)
                - COALESCE((
                    SELECT SUM(si.quantity)
                    FROM sale_items si
                    JOIN sales s ON si.sale_id = s.id
                    WHERE si.product_id = p.id AND s.branch_id = ? AND s.payment_status = 'paid'
                  ), 0)
              ) as total_stock
       FROM products p
       WHERE p.id IN (${placeholders})`,
      [branchId, branchId, branchId, ...productIds]
    )

    const availableByProduct = new Map(rows.map(r => [Number(r.id), Number(r.total_stock) || 0]))
    const violations = []
    for (const [pid, qty] of requestedByProduct.entries()) {
      const available = availableByProduct.get(pid) || 0
      if (qty > available) {
        violations.push({ productId: pid, requested: qty, available })
      }
    }

    if (violations.length > 0) {
      await connection.rollback()
      req.session.error = `Insufficient stock for ${violations.length} item(s). Please refresh and try again.`
      return res.redirect(`/admin/inventory/orders/add?branch=${branchId}`)
    }


    const [result] = await connection.query(
      `INSERT INTO orders (customer_id, branch_id, order_type, status, subtotal, tax, discount, discount_type, 
       delivery_fee, total, delivery_address, delivery_city, delivery_state, delivery_zip, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerId, branchId, orderType, status, subtotal, tax, discount || 0, discountType || 'fixed',
        deliveryFee || 0, total, deliveryAddress || null, deliveryCity || null, deliveryState || null,
        deliveryZip || null, notes || null, req.session.user.id
      ]
    )

    const orderId = result.insertId


    if (orderItems) {
      let items = []
      try {
        items = JSON.parse(orderItems)
      } catch (err) {
        console.error("Error parsing order items:", err)
        items = []
      }
      
      for (const item of items) {
        await connection.query(
          "INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)",
          [orderId, item.productId, item.quantity, item.unitPrice, item.subtotal]
        )
      }
    }

    await connection.commit()
    req.session.success = "Order added successfully"
    res.redirect(`/admin/inventory/orders?branch=${branchId}`)
  } catch (error) {
    await connection.rollback()
    console.error("Add order error:", error)
    req.session.error = "Error adding order"
    res.redirect(`/admin/inventory/orders/add?branch=${branchId}`)
  } finally {
    connection.release()
  }
})



router.get("/inventory/branch-products", async (req, res) => {
  try {
    const branchId = req.query.branch
    if (!branchId) {
      return res.status(400).json({ success: false, message: "branch is required" })
    }

    const baseQuery = `
      SELECT p.id, p.name, p.sku, p.unit_price, p.image_url, p.floor_level,
             (
               COALESCE((
                 SELECT SUM(r.quantity)
                 FROM restock r
                 WHERE r.product_id = i.product_id 
                   AND r.branch_id = i.branch_id
               ), 0) 
               - COALESCE((
                 SELECT SUM(oi.quantity)
                 FROM order_items oi
                 JOIN orders o ON oi.order_id = o.id
                 WHERE oi.product_id = i.product_id 
                   AND o.branch_id = i.branch_id
                   AND o.status IN ('shipped', 'completed', 'ready')
               ), 0)
               - COALESCE((
                 SELECT SUM(si.quantity)
                 FROM sale_items si
                 JOIN sales s ON si.sale_id = s.id
                 WHERE si.product_id = i.product_id 
                   AND s.branch_id = i.branch_id
                   AND s.payment_status = 'paid'
               ), 0)
             ) AS total_stock
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.branch_id = ? AND p.is_active = TRUE
      ORDER BY p.name
    `

    const [rows] = await db.query(baseQuery, [branchId])
    const products = rows
      .filter(p => (p.total_stock || 0) > 0)
      .map(p => {
        const stock = p.total_stock || 0
        const floor = p.floor_level || 0
        const diff = Math.abs(stock - floor)
        let stock_status = {
          key: 'in_stock',
          label: 'In Stock',
          color: '#28a745',
          textColor: '#ffffff'
        }
        if (stock === 0 || stock < floor) {
          stock_status = { key: 'reorder', label: 'Reorder', color: '#dc3545', textColor: '#ffffff' }
        } else if (diff === 20) {
          stock_status = { key: 'critical', label: 'Critical', color: '#ffc107', textColor: '#000000' }
        }
        return { ...p, stock_status }
      })

    res.json({ success: true, products })
  } catch (error) {
    console.error("Branch products fetch error:", error)
    res.status(500).json({ success: false, message: "Error fetching products" })
  }
})

router.get("/inventory/orders/view/:id", async (req, res) => {
  try {
    const [orders] = await db.query(
      `SELECT o.*, 
        CONCAT(cu.first_name, ' ', cu.last_name) as customer_name,
        cu.email as customer_email,
        cu.phone as customer_phone,
        b.name as branch_name,
        CONCAT(cr.first_name, ' ', cr.last_name) as created_by_name,
        CONCAT(up.first_name, ' ', up.last_name) as updated_by_name
       FROM orders o
       JOIN users cu ON o.customer_id = cu.id
       LEFT JOIN branches b ON o.branch_id = b.id
       LEFT JOIN users cr ON o.created_by = cr.id
       LEFT JOIN users up ON o.updated_by = up.id
       WHERE o.id = ?`,
      [req.params.id]
    )

    if (orders.length === 0) {
      req.session.error = "Order not found"
      return res.redirect("/admin/inventory/orders")
    }

    const [items] = await db.query(
      `SELECT oi.*, p.name as product_name, p.sku
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [req.params.id]
    )

    res.render("admin/order-view", {
      title: "Order Details",
      order: orders[0],
      items,
    })
  } catch (error) {
    console.error("View order error:", error)
    req.session.error = "Error loading order"
    res.redirect("/admin/inventory/orders")
  }
})


router.get("/inventory/orders/edit/:id", async (req, res) => {
  try {
    const [orders] = await db.query("SELECT * FROM orders WHERE id = ?", [req.params.id])

    if (orders.length === 0) {
      req.session.error = "Order not found"
      return res.redirect("/admin/inventory/orders")
    }

    const [items] = await db.query(
      `SELECT oi.*, p.name as product_name, p.sku
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [req.params.id]
    )

    const branchId = orders[0].branch_id
    const [customers] = await db.query("SELECT id, first_name, last_name, email, phone FROM users WHERE role = 'customer' AND is_active = TRUE ORDER BY first_name")


    const baseQuery = `
      SELECT p.id, p.name, p.sku, p.unit_price, p.image_url, p.floor_level,
             (
               COALESCE((
                 SELECT SUM(r.quantity)
                 FROM restock r
                 WHERE r.product_id = i.product_id 
                   AND r.branch_id = i.branch_id
               ), 0) 
               - COALESCE((
                 SELECT SUM(oi.quantity)
                 FROM order_items oi
                 JOIN orders o ON oi.order_id = o.id
                 WHERE oi.product_id = i.product_id 
                   AND o.branch_id = i.branch_id
                   AND o.status IN ('shipped', 'completed', 'ready')
               ), 0)
               - COALESCE((
                 SELECT SUM(si.quantity)
                 FROM sale_items si
                 JOIN sales s ON si.sale_id = s.id
                 WHERE si.product_id = i.product_id 
                   AND s.branch_id = i.branch_id
                   AND s.payment_status = 'paid'
               ), 0)
             ) AS total_stock
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.branch_id = ? AND p.is_active = TRUE
    `

    const [productsRaw] = await db.query(baseQuery, [branchId])
    const products = productsRaw
    .filter(p => (p.total_stock || 0) > 0)
    .map(p => {
      const stock = p.total_stock || 0;
      const floor = p.floor_level || 0;
      const diff = Math.abs(stock - floor);
      let stock_status = {
        key: 'in_stock',
        label: 'In Stock',
        color: '#28a745',
        textColor: '#ffffff'
      };
      if (stock === 0 || stock < floor) {
        stock_status = { key: 'reorder', label: 'Reorder', color: '#dc3545', textColor: '#ffffff' };
      } else if (diff === 20) {
        stock_status = { key: 'critical', label: 'Critical', color: '#ffc107', textColor: '#000000' };
      }
      return { ...p, stock_status }; 
    });
    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")

    res.render("admin/order-form", {
      title: "Edit Order",
      order: { ...orders[0], items },
      customers,
      products,
      branches,
      branchId,
    })
  } catch (error) {
    console.error("Edit order error:", error)
    req.session.error = "Error loading order"
    res.redirect("/admin/inventory/orders")
  }
})


router.post("/inventory/orders/edit/:id", async (req, res) => {
  const { 
    customerId, branchId, orderType, status, subtotal, tax, discount, discountType,
    deliveryFee, total, deliveryAddress, deliveryCity, deliveryState, deliveryZip, notes,
    orderItems
  } = req.body

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()


    await connection.query(
      `UPDATE orders SET customer_id = ?, order_type = ?, status = ?, subtotal = ?, tax = ?, 
       discount = ?, discount_type = ?, delivery_fee = ?, total = ?, delivery_address = ?, 
       delivery_city = ?, delivery_state = ?, delivery_zip = ?, notes = ?, updated_by = ?
       WHERE id = ?`,
      [
        customerId, orderType, status, subtotal, tax, discount || 0, discountType || 'fixed',
        deliveryFee || 0, total, deliveryAddress || null, deliveryCity || null, deliveryState || null,
        deliveryZip || null, notes || null, req.session.user.id, req.params.id
      ]
    )


    await connection.query("DELETE FROM order_items WHERE order_id = ?", [req.params.id])


    if (orderItems) {
      let items = []
      try {
        items = JSON.parse(orderItems)
      } catch (err) {
        console.error("Error parsing order items:", err)
        items = []
      }
      
      for (const item of items) {
        await connection.query(
          "INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)",
          [req.params.id, item.productId, item.quantity, item.unitPrice, item.subtotal]
        )
      }
    }

    await connection.commit()
    req.session.success = "Order updated successfully"
    res.redirect(`/admin/inventory/orders?branch=${branchId}`)
  } catch (error) {
    await connection.rollback()
    console.error("Update order error:", error)
    req.session.error = "Error updating order"
    res.redirect(`/admin/inventory/orders/edit/${req.params.id}`)
  } finally {
    connection.release()
  }
})


router.post("/inventory/orders/delete/:id", async (req, res) => {
  const { branchId } = req.body

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()


    await connection.query("DELETE FROM order_items WHERE order_id = ?", [req.params.id])


    await connection.query("DELETE FROM orders WHERE id = ?", [req.params.id])

    await connection.commit()
    req.session.success = "Order deleted successfully"
    res.redirect(`/admin/inventory/orders?branch=${branchId}`)
  } catch (error) {
    await connection.rollback()
    console.error("Delete order error:", error)
    req.session.error = "Error deleting order"
    res.redirect(`/admin/inventory/orders?branch=${branchId}`)
  } finally {
    connection.release()
  }
})


router.post("/inventory/orders/add-customer", async (req, res) => {
  try {
    const { firstName, lastName, email, phone, address, city, state, zipCode } = req.body


    if (!firstName || !lastName || !email) {
      return res.status(400).json({ 
        success: false, 
        message: "First name, last name, and email are required" 
      })
    }


    const [existingUser] = await db.query("SELECT id FROM users WHERE email = ?", [email])
    if (existingUser.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Customer with this email already exists" 
      })
    }


    const [result] = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, address, city, state, zip_code, role, is_active, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'customer', TRUE, NOW())`,
      [firstName, lastName, email, phone || null, address || null, city || null, state || null, zipCode || null]
    )

    res.json({ 
      success: true, 
      message: "Customer added successfully",
      customer: {
        id: result.insertId,
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: phone,
        full_name: `${firstName} ${lastName}`
      }
    })
  } catch (error) {
    console.error("Add customer error:", error)
    res.status(500).json({ 
      success: false, 
      message: "Error adding customer" 
    })
  }
})


router.get("/inventory/orders/print/:id", async (req, res) => {
  try {
    const [orders] = await db.query(`
      SELECT o.*, 
             u.first_name as customer_name, u.last_name as customer_last_name, u.email as customer_email, u.phone as customer_phone,
             b.name as branch_name,
             creator.first_name as created_by_name, creator.last_name as created_by_last_name,
             updater.first_name as updated_by_name, updater.last_name as updated_by_last_name
      FROM orders o
      LEFT JOIN users u ON o.customer_id = u.id
      LEFT JOIN branches b ON o.branch_id = b.id
      LEFT JOIN users creator ON o.created_by = creator.id
      LEFT JOIN users updater ON o.updated_by = updater.id
      WHERE o.id = ?
    `, [req.params.id])

    if (orders.length === 0) {
      req.session.error = "Order not found"
      return res.redirect("/admin/inventory/orders")
    }

    const order = orders[0]
    order.customer_name = `${order.customer_name} ${order.customer_last_name}`
    order.created_by_name = `${order.created_by_name} ${order.created_by_last_name}`
    if (order.updated_by_name) {
      order.updated_by_name = `${order.updated_by_name} ${order.updated_by_last_name}`
    }

    const [items] = await db.query(`
      SELECT oi.*, p.name as product_name, p.sku
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [req.params.id])

    res.render("admin/order-receipt", {
      title: "Order Receipt",
      order,
      items
    })
  } catch (error) {
    console.error("Print receipt error:", error)
    req.session.error = "Error loading receipt"
    res.redirect("/admin/inventory/orders")
  }
})


router.post("/inventory/orders/bulk-print", async (req, res) => {
  let { orderIds, branchId } = req.body
  

  if (typeof orderIds === 'string') {
    try {
      orderIds = JSON.parse(orderIds)
    } catch (error) {
      console.error("Error parsing orderIds:", error)
      req.session.error = "Invalid order selection"
      return res.redirect(`/admin/inventory/orders?branch=${branchId}`)
    }
  }

  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    req.session.error = "No orders selected"
    return res.redirect(`/admin/inventory/orders?branch=${branchId}`)
  }

  if (orderIds.length === 1) {

    return res.redirect(`/admin/inventory/orders/print/${orderIds[0]}`)
  } else {

    try {
      const placeholders = orderIds.map(() => '?').join(',')
      const [orders] = await db.query(`
        SELECT o.*, 
               u.first_name as customer_name, u.last_name as customer_last_name, u.email as customer_email, u.phone as customer_phone,
               b.name as branch_name,
               creator.first_name as created_by_name, creator.last_name as created_by_last_name,
               updater.first_name as updated_by_name, updater.last_name as updated_by_last_name
        FROM orders o
        LEFT JOIN users u ON o.customer_id = u.id
        LEFT JOIN branches b ON o.branch_id = b.id
        LEFT JOIN users creator ON o.created_by = creator.id
        LEFT JOIN users updater ON o.updated_by = updater.id
        WHERE o.id IN (${placeholders})
        ORDER BY o.created_at DESC
      `, orderIds)


      const [allItems] = await db.query(`
        SELECT oi.*, p.name as product_name, p.sku, oi.order_id
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id IN (${placeholders})
        ORDER BY oi.order_id, oi.id
      `, orderIds)


      const itemsByOrder = {}
      allItems.forEach(item => {
        if (!itemsByOrder[item.order_id]) {
          itemsByOrder[item.order_id] = []
        }
        itemsByOrder[item.order_id].push(item)
      })


      const processedOrders = orders.map(order => {
        order.customer_name = `${order.customer_name} ${order.customer_last_name}`
        order.created_by_name = `${order.created_by_name} ${order.created_by_last_name}`
        if (order.updated_by_name) {
          order.updated_by_name = `${order.updated_by_name} ${order.updated_by_last_name}`
        }
        order.items = itemsByOrder[order.id] || []
        return order
      })

      res.render("admin/order-receipt-bulk", {
        title: "Bulk Order Receipts",
        orders: processedOrders,
        branchId
      })
    } catch (error) {
      console.error("Bulk print error:", error)
      req.session.error = "Error loading orders"
      res.redirect(`/admin/inventory/orders?branch=${branchId}`)
    }
  }
})


router.post("/inventory/orders/bulk-update", async (req, res) => {
  let { orderIds, status, branchId } = req.body


  if (typeof orderIds === 'string') {
    try {
      orderIds = JSON.parse(orderIds)
    } catch (error) {
      console.error("Error parsing orderIds:", error)
      req.session.error = "Invalid order selection"
      return res.redirect(`/admin/inventory/orders?branch=${branchId}`)
    }
  }

  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    req.session.error = "No orders selected"
    return res.redirect(`/admin/inventory/orders?branch=${branchId}`)
  }

  if (!status) {
    req.session.error = "No status selected"
    return res.redirect(`/admin/inventory/orders?branch=${branchId}`)
  }

  try {
    const placeholders = orderIds.map(() => '?').join(',')
    await db.query(
      `UPDATE orders SET status = ?, updated_by = ? WHERE id IN (${placeholders})`,
      [status, req.session.user.id, ...orderIds]
    )

    req.session.success = `${orderIds.length} order(s) updated to ${status}`
    res.redirect(`/admin/inventory/orders?branch=${branchId}`)
  } catch (error) {
    console.error("Bulk update error:", error)
    req.session.error = "Error updating orders"
    res.redirect(`/admin/inventory/orders?branch=${branchId}`)
  }
})


router.get("/inventory/add", async (req, res) => {
  try {
    const branchId = req.query.branch || ""
    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")
    const [products] = await db.query("SELECT * FROM products WHERE is_active = TRUE ORDER BY name")


    const [existingInv] = await db.query("SELECT product_id, branch_id FROM inventory")
    

    const existingInventory = {}
    existingInv.forEach(inv => {
      if (!existingInventory[inv.branch_id]) {
        existingInventory[inv.branch_id] = []
      }
      existingInventory[inv.branch_id].push(inv.product_id)
    })


    if (branchId) {
      const existing = existingInventory[branchId] || []
      products.forEach(product => {
        product.in_branch = existing.includes(product.id)
      })
    }

    res.render("admin/inventory-form", {
      title: "Add Products to Branch",
      inventory: null,
      branches,
      products,
      branchId,
      existingInventory,
    })
  } catch (error) {
    console.error("Add inventory page error:", error)
    req.session.error = "Error loading form"
    res.redirect("/admin/inventory")
  }
})


router.post("/inventory/add", async (req, res) => {
  const { productIds, branchId } = req.body

  try {
    let ids = []
    try {
      ids = JSON.parse(productIds)
    } catch (err) {
      req.session.error = "Invalid product selection"
      return res.redirect("/admin/inventory/add")
    }

    if (!ids || ids.length === 0) {
      req.session.error = "Please select at least one product"
      return res.redirect("/admin/inventory/add")
    }


    const placeholders = ids.map(() => '?').join(',')
    const [existing] = await db.query(
      `SELECT product_id FROM inventory WHERE branch_id = ? AND product_id IN (${placeholders})`,
      [branchId, ...ids]
    )

    const existingIds = existing.map(row => row.product_id)
    const newIds = ids.filter(id => !existingIds.includes(parseInt(id)))

    if (newIds.length === 0) {
      req.session.error = "All selected products are already in this branch"
      return res.redirect(`/admin/inventory/add?branch=${branchId}`)
    }


    const insertPromises = newIds.map(productId =>
      db.query(
        "INSERT INTO inventory (product_id, branch_id) VALUES (?, ?)",
        [productId, branchId]
      )
    )
    await Promise.all(insertPromises)

    let message = `${newIds.length} product(s) added successfully`
    if (existingIds.length > 0) {
      message += ` (${existingIds.length} skipped - already in branch)`
    }

    req.session.success = message
    res.redirect(`/admin/inventory/stock-management?branch=${branchId}`)
  } catch (error) {
    console.error("Add inventory error:", error)
    req.session.error = "Error adding inventory"
    res.redirect("/admin/inventory/add")
  }
})


router.post("/inventory/add-and-restock", async (req, res) => {
  const { productIds, branchId } = req.body

  try {
    let ids = []
    try {
      ids = JSON.parse(productIds)
    } catch (err) {
      req.session.error = "Invalid product selection"
      return res.redirect("/admin/inventory/add")
    }

    if (!ids || ids.length === 0) {
      req.session.error = "Please select at least one product"
      return res.redirect("/admin/inventory/add")
    }


    const placeholders = ids.map(() => '?').join(',')
    const [existing] = await db.query(
      `SELECT product_id FROM inventory WHERE branch_id = ? AND product_id IN (${placeholders})`,
      [branchId, ...ids]
    )

    const existingIds = existing.map(row => row.product_id)
    const newIds = ids.filter(id => !existingIds.includes(parseInt(id)))


    if (newIds.length > 0) {
      const insertPromises = newIds.map(productId =>
        db.query(
          "INSERT INTO inventory (product_id, branch_id) VALUES (?, ?)",
          [productId, branchId]
        )
      )
      await Promise.all(insertPromises)
    }


    req.session.addedProducts = newIds.length
    req.session.existingProducts = existingIds.length
    res.redirect(`/admin/inventory/restock/bulk-add?branch=${branchId}&products=${ids.join(',')}`)
  } catch (error) {
    console.error("Add and restock error:", error)
    req.session.error = "Error adding inventory"
    res.redirect("/admin/inventory/add")
  }
})


router.get("/inventory/restock/bulk-add", async (req, res) => {
  try {
    const branchId = req.query.branch
    const productIds = req.query.products ? req.query.products.split(',') : []

    if (!branchId || productIds.length === 0) {
      req.session.error = "Invalid restock request"
      return res.redirect("/admin/inventory/restock")
    }

    const [branches] = await db.query("SELECT id, name FROM branches WHERE is_active = TRUE ORDER BY name")
    
    const placeholders = productIds.map(() => '?').join(',')
    const [products] = await db.query(
      `SELECT id, name, sku FROM products WHERE id IN (${placeholders}) ORDER BY name`,
      productIds
    )

    res.render("admin/restock-bulk-form", {
      title: "Bulk Restock",
      branches,
      products,
      branchId,
      addedProducts: req.session.addedProducts || 0,
      existingProducts: req.session.existingProducts || 0,
    })


    delete req.session.addedProducts
    delete req.session.existingProducts
  } catch (error) {
    console.error("Bulk restock page error:", error)
    req.session.error = "Error loading bulk restock form"
    res.redirect("/admin/inventory/restock")
  }
})


router.post("/inventory/restock/bulk-add", async (req, res) => {
  const { branchId, restockData } = req.body

  try {
    let items = []
    try {
      items = JSON.parse(restockData)
    } catch (err) {
      req.session.error = "Invalid restock data"
      return res.redirect("/admin/inventory/restock")
    }

    if (!items || items.length === 0) {
      req.session.error = "No restock data provided"
      return res.redirect("/admin/inventory/restock")
    }


    const uniqueProductIds = [...new Set(items.map(item => item.productId))]
    

    const placeholders = uniqueProductIds.map(() => '?').join(',')
    const [existingInventory] = await db.query(
      `SELECT product_id FROM inventory WHERE product_id IN (${placeholders}) AND branch_id = ?`,
      [...uniqueProductIds, branchId]
    )
    
    const existingProductIds = existingInventory.map(row => row.product_id)
    const newProductIds = uniqueProductIds.filter(id => !existingProductIds.includes(parseInt(id)))
    

    if (newProductIds.length > 0) {
      const inventoryInsertPromises = newProductIds.map(productId =>
        db.query(
          "INSERT INTO inventory (product_id, branch_id) VALUES (?, ?)",
          [productId, branchId]
        )
      )
      await Promise.all(inventoryInsertPromises)
    }

    const today = new Date()
    const dd = String(today.getDate()).padStart(2, '0')
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const yy = String(today.getFullYear()).slice(-2)
    const batchNumber = `${dd}${mm}${yy}`

    const insertPromises = items.map(item =>
      db.query(
        "INSERT INTO restock (product_id, branch_id, quantity, expiry_date, batch_number) VALUES (?, ?, ?, ?, ?)",
        [item.productId, branchId, item.quantity, item.expiryDate, batchNumber]
      )
    )
    await Promise.all(insertPromises)

    req.session.success = `${items.length} product(s) restocked successfully with batch #${batchNumber}`
    res.redirect(`/admin/inventory/restock?branch=${branchId}`)
  } catch (error) {
    console.error("Bulk restock error:", error)
    req.session.error = "Error adding restock entries"
    res.redirect(`/admin/inventory/restock?branch=${branchId}`)
  }
})


router.get("/inventory/edit/:id", async (req, res) => {
  try {
    const [inventory] = await db.query(
      `SELECT i.*, p.name as product_name, b.name as branch_name
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       JOIN branches b ON i.branch_id = b.id
       WHERE i.id = ?`,
      [req.params.id],
    )

    if (inventory.length === 0) {
      req.session.error = "Inventory item not found"
      return res.redirect("/admin/inventory")
    }

    res.render("admin/inventory-form", {
      title: "Edit Inventory",
      inventory: inventory[0],
      branches: null,
      products: null,
      branchId: inventory[0].branch_id,
      existingInventory: {},
    })
  } catch (error) {
    console.error("Edit inventory error:", error)
    req.session.error = "Error loading inventory"
    res.redirect("/admin/inventory")
  }
})


router.post("/inventory/delete/:id", async (req, res) => {
  const { branchId } = req.body
  
  try {
    const [current] = await db.query("SELECT * FROM inventory WHERE id = ?", [req.params.id])

    if (current.length === 0) {
      req.session.error = "Inventory item not found"
      return res.redirect("/admin/inventory")
    }


    await db.query("DELETE FROM inventory WHERE id = ?", [req.params.id])

    req.session.success = "Product removed from branch inventory successfully"
    res.redirect(`/admin/inventory/stock-management?branch=${branchId || current[0].branch_id}`)
  } catch (error) {
    console.error("Delete inventory error:", error)
    req.session.error = "Error removing product from inventory"
    res.redirect(`/admin/inventory/stock-management?branch=${req.body.branchId}`)
  }
})


router.post("/inventory/bulk-delete", async (req, res) => {
  const { inventoryIds, branchId } = req.body
  
  try {
    let ids = []
    try {
      ids = JSON.parse(inventoryIds)
    } catch (err) {
      req.session.error = "Invalid selection"
      return res.redirect(`/admin/inventory/stock-management?branch=${branchId}`)
    }

    if (!ids || ids.length === 0) {
      req.session.error = "No items selected"
      return res.redirect(`/admin/inventory/stock-management?branch=${branchId}`)
    }


    const placeholders = ids.map(() => '?').join(',')
    const result = await db.query(
      `DELETE FROM inventory WHERE id IN (${placeholders})`,
      ids
    )

    req.session.success = `Successfully removed ${ids.length} product${ids.length > 1 ? 's' : ''} from branch inventory`
    res.redirect(`/admin/inventory/stock-management?branch=${branchId}`)
  } catch (error) {
    console.error("Bulk delete inventory error:", error)
    req.session.error = "Error removing products from inventory"
    res.redirect(`/admin/inventory/stock-management?branch=${req.body.branchId}`)
  }
})


router.post("/inventory/bulk-restock", async (req, res) => {
  const { productIds, branchId, selectedProducts } = req.body
  
  try {
    let ids = []
    let products = []
    
    try {
      ids = JSON.parse(productIds)
      products = JSON.parse(selectedProducts)
    } catch (err) {
      req.session.error = "Invalid product selection"
      return res.redirect(`/admin/inventory/stock-management?branch=${branchId}`)
    }

    if (!ids || ids.length === 0) {
      req.session.error = "No products selected"
      return res.redirect(`/admin/inventory/stock-management?branch=${branchId}`)
    }


    const [[branch]] = await db.query("SELECT name FROM branches WHERE id = ?", [branchId])
    const branchName = branch ? branch.name : 'Unknown Branch'


    const now = new Date()
    const day = String(now.getDate()).padStart(2, '0')
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const year = String(now.getFullYear()).slice(-2)
    const autoBatchNumber = `${day}${month}${year}`


    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    res.render("admin/bulk-restock", {
      title: "Bulk Restock",
      selectedProducts: products,
      productIds: ids,
      branchId: Number.parseInt(branchId),
      branchName,
      autoBatchNumber,
      tomorrow: tomorrowStr
    })
  } catch (error) {
    console.error("Bulk restock page error:", error)
    req.session.error = "Error loading bulk restock page"
    res.redirect(`/admin/inventory/stock-management?branch=${req.body.branchId}`)
  }
})


router.post("/inventory/bulk-restock-process", async (req, res) => {
  const { productIds, branchId, quantity, expiryDate } = req.body;
  
  try {
    let ids = [];
    try {
      ids = JSON.parse(productIds);
    } catch (err) {
      req.session.error = "Invalid product selection";
      return res.redirect(`/admin/inventory/stock-management?branch=${branchId}`);
    }

    if (!ids || ids.length === 0) {
      req.session.error = "No products selected";
      return res.redirect(`/admin/inventory/stock-management?branch=${branchId}`);
    }

    const qty = parseInt(quantity);
    if (!qty || qty < 1) {
      req.session.error = "Invalid quantity";
      return res.redirect(`/admin/inventory/stock-management?branch=${branchId}`);
    }

    if (!expiryDate) {
      req.session.error = "Expiry date is required";
      return res.redirect(`/admin/inventory/stock-management?branch=${branchId}`);
    }


    const placeholdersExisting = ids.map(() => '?').join(',');
    const [existingInventory] = await db.query(
      `SELECT product_id FROM inventory WHERE product_id IN (${placeholdersExisting}) AND branch_id = ?`,
      [...ids, branchId]
    );

    const existingProductIds = existingInventory.map(row => row.product_id);
    const newProductIds = ids.filter(id => !existingProductIds.includes(parseInt(id)));


    if (newProductIds.length > 0) {
      const inventoryInsertPromises = newProductIds.map(productId =>
        db.query(
          "INSERT INTO inventory (product_id, branch_id) VALUES (?, ?)",
          [productId, branchId]
        )
      );
      await Promise.all(inventoryInsertPromises);
    }


    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const autoBatchNumber = `${day}${month}${year}`;


    const restockValues = ids.map(productId => [
      productId,
      branchId,
      qty,
      expiryDate,
      autoBatchNumber
    ]);

    const placeholdersRestock = restockValues.map(() => '(?, ?, ?, ?, ?)').join(',');
    const flatValues = restockValues.flat();

    await db.query(
      `INSERT INTO restock (product_id, branch_id, quantity, expiry_date, batch_number) 
       VALUES ${placeholdersRestock}`,
      flatValues
    );

    req.session.success = `Successfully restocked ${ids.length} product${ids.length > 1 ? 's' : ''} with ${qty} unit${qty > 1 ? 's' : ''} each (Batch: ${autoBatchNumber})`;
    res.redirect(`/admin/inventory/stock-management?branch=${branchId}`);
  } catch (error) {
    console.error("Bulk restock process error:", error);
    req.session.error = "Error restocking products: " + error.message;
    res.redirect(`/admin/inventory/stock-management?branch=${req.body.branchId}`);
  }
});



router.get("/categories", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const offset = (page - 1) * limit
    const search = req.query.search || ""


    let whereConditions = []
    let queryParams = []

    if (search) {
      whereConditions.push("(c.name LIKE ? OR c.description LIKE ?)")
      const searchPattern = `%${search}%`
      queryParams.push(searchPattern, searchPattern)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""


    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM categories c ${whereClause}`,
      queryParams
    )
    const totalPages = Math.ceil(total / limit)

    const [categories] = await db.query(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM products WHERE category_id = c.id) as product_count
       FROM categories c
       ${whereClause}
       ORDER BY c.name
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    )

    res.render("admin/categories", {
      title: "Category Management",
      categories,
      currentPage: page,
      totalPages,
      totalCategories: total,
      search
    })
  } catch (error) {
    console.error("Categories error:", error)
    req.session.error = "Error loading categories"
    res.redirect("/admin/dashboard")
  }
})


router.get("/categories/add", async (req, res) => {
  try {
    const editId = req.query.edit;
    let category = null;
    
    if (editId) {
      const [categories] = await db.query("SELECT * FROM categories WHERE id = ?", [editId]);
      if (categories.length > 0) {
        category = categories[0];
      }
    }
    
    res.render("admin/category-add", {
      title: editId ? "Edit Category" : "Add Category",
      category: category,
      isEdit: !!editId
    });
  } catch (error) {
    console.error("Add category page error:", error);
    req.session.error = "Error loading form";
    res.redirect("/admin/categories");
  }
  });

router.post("/categories/add", async (req, res) => {
  const { categories, editId } = req.body

  try {
    if (categories && Array.isArray(categories)) {

      const validCategories = categories.filter(cat => cat.name && cat.name.trim())
      
      if (validCategories.length === 0) {
        req.session.error = "No valid categories provided"
        return res.redirect("/admin/categories/add")
      }

      const insertPromises = validCategories.map(category =>
        db.query("INSERT INTO categories (name, description) VALUES (?, ?)", [
          category.name.trim(),
          category.description ? category.description.trim() : null
        ])
      )

      await Promise.all(insertPromises)
      req.session.success = `${validCategories.length} categories added successfully`
    } else {

      const { name, description } = req.body
      
      if (editId) {

        await db.query("UPDATE categories SET name = ?, description = ? WHERE id = ?", [
          name,
          description || null,
          editId
        ])
        req.session.success = "Category updated successfully"
      } else {

        await db.query("INSERT INTO categories (name, description) VALUES (?, ?)", [name, description || null])
        req.session.success = "Category added successfully"
      }
    }

    res.redirect("/admin/categories")
  } catch (error) {
    console.error("Add/Edit category error:", error)
    req.session.error = "Error saving category"
    res.redirect("/admin/categories/add")
  }
})


router.post("/categories/edit/:id", async (req, res) => {
  const { name, description } = req.body

  try {
    await db.query("UPDATE categories SET name = ?, description = ? WHERE id = ?", [
      name,
      description || null,
      req.params.id,
    ])

    req.session.success = "Category updated successfully"
    res.redirect("/admin/categories")
  } catch (error) {
    console.error("Update category error:", error)
    req.session.error = "Error updating category"
    res.redirect("/admin/categories")
  }
})


router.post("/categories/delete/:id", async (req, res) => {
  try {

    const [[count]] = await db.query("SELECT COUNT(*) as count FROM products WHERE category_id = ?", [req.params.id])

    if (count.count > 0) {
      req.session.error = "Cannot delete category with products. Please reassign products first."
      return res.redirect("/admin/categories")
    }

    await db.query("DELETE FROM categories WHERE id = ?", [req.params.id])
    req.session.success = "Category deleted successfully"
    res.redirect("/admin/categories")
  } catch (error) {
    console.error("Delete category error:", error)
    req.session.error = "Error deleting category"
    res.redirect("/admin/categories")
  }
})




router.get("/sales", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const offset = (page - 1) * limit
    const search = req.query.search || ""
    const employeeFilter = req.query.employee || ""
    const branchFilter = req.query.branch || ""
    const paymentMethodFilter = req.query.paymentMethod || ""
    const statusFilter = req.query.status || ""


    let whereConditions = []
    let queryParams = []


    if (search) {
      whereConditions.push(`s.id IN (
        SELECT DISTINCT si.sale_id 
        FROM sale_items si 
        JOIN products p ON si.product_id = p.id 
        WHERE p.name LIKE ?
      )`)
      queryParams.push(`%${search}%`)
    }

    if (employeeFilter) {
      whereConditions.push("s.employee_id = ?")
      queryParams.push(employeeFilter)
    }

    if (branchFilter) {
      whereConditions.push("s.branch_id = ?")
      queryParams.push(branchFilter)
    }

    if (paymentMethodFilter) {
      whereConditions.push("s.payment_method = ?")
      queryParams.push(paymentMethodFilter)
    }

    if (statusFilter) {
      whereConditions.push("s.payment_status = ?")
      queryParams.push(statusFilter)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""


    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM sales s ${whereClause}`,
      queryParams
    )
    const totalPages = Math.ceil(total / limit)


    const [sales] = await db.query(
      `SELECT s.*, 
        b.name as branch_name,
        CONCAT(u.first_name, ' ', u.last_name) as employee_name
       FROM sales s
       JOIN branches b ON s.branch_id = b.id
       JOIN users u ON s.employee_id = u.id
       ${whereClause}
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    )


    for (let sale of sales) {
      const [items] = await db.query(
        `SELECT si.*, p.name as product_name, p.sku
         FROM sale_items si
         JOIN products p ON si.product_id = p.id
         WHERE si.sale_id = ?`,
        [sale.id]
      )
      sale.items = items
      sale.item_count = items.length
    }


    const [branches] = await db.query("SELECT id, name FROM branches WHERE is_active = TRUE ORDER BY name")
    

    const [employees] = await db.query(
      "SELECT id, CONCAT(first_name, ' ', last_name) as name FROM users WHERE role = 'employee' AND is_active = TRUE ORDER BY first_name"
    )

    res.render("admin/sales", {
      title: "Sales Management",
      sales,
      branches,
      employees,
      currentPage: page,
      totalPages,
      totalSales: total,
      search,
      employeeFilter,
      branchFilter,
      paymentMethodFilter,
      statusFilter
    })
  } catch (error) {
    console.error("Sales error:", error)
    req.session.error = "Error loading sales"
    res.redirect("/admin/dashboard")
  }
})


router.get("/sales/print/:id", async (req, res) => {
  try {
    const [sales] = await db.query(
      `SELECT s.*, b.name as branch_name, b.address, b.city, b.state, b.zip_code,
              u.first_name as employee_first_name, u.last_name as employee_last_name,
              c.first_name as customer_first_name, c.last_name as customer_last_name
       FROM sales s
       JOIN branches b ON s.branch_id = b.id
       JOIN users u ON s.employee_id = u.id
       LEFT JOIN users c ON s.customer_id = c.id
       WHERE s.id = ?`,
      [req.params.id],
    )

    if (sales.length === 0) {
      req.session.error = "Sale not found"
      return res.redirect("/admin/sales")
    }

    const [items] = await db.query(
      `SELECT si.*, p.name as product_name, p.sku
       FROM sale_items si
       JOIN products p ON si.product_id = p.id
       WHERE si.sale_id = ?`,
      [req.params.id],
    )

    res.render("pos/receipt", {
      title: "Sale Receipt",
      sale: sales[0],
      items,
      backUrl: "/admin/sales",
      backLabel: "Sales Tab"
    })
  } catch (error) {
    console.error("Print receipt error:", error)
    req.session.error = "Error loading receipt"
    res.redirect("/admin/sales")
  }
})



router.post("/sales/bulk-print", async (req, res) => {
  console.log("Bulk print request received")
  let { saleIds } = req.body

  if (typeof saleIds === 'string') {
    try {
      saleIds = JSON.parse(saleIds)
    } catch (error) {
      console.error("Error parsing saleIds:", error)
      req.session.error = "Invalid sale selection"
      return res.redirect("/admin/sales")
    }
  }

  if (!saleIds || !Array.isArray(saleIds) || saleIds.length === 0) {
    req.session.error = "No sales selected"
    return res.redirect("/admin/sales")
  }

  if (saleIds.length === 1) {
    return res.redirect(`/admin/sales/print/${saleIds[0]}`)
  } else {
    try {
      const placeholders = saleIds.map(() => '?').join(',')
      const [sales] = await db.query(`
        SELECT s.*, 
               b.name as branch_name, b.address, b.city, b.state, b.zip_code,
               u.first_name as employee_first_name, u.last_name as employee_last_name,
               c.first_name as customer_first_name, c.last_name as customer_last_name
        FROM sales s
        JOIN branches b ON s.branch_id = b.id
        JOIN users u ON s.employee_id = u.id
        LEFT JOIN users c ON s.customer_id = c.id
        WHERE s.id IN (${placeholders})
        ORDER BY s.created_at DESC
      `, saleIds)

      const [allItems] = await db.query(`
        SELECT si.*, p.name as product_name, p.sku, si.sale_id
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        WHERE si.sale_id IN (${placeholders})
        ORDER BY si.sale_id, si.id
      `, saleIds)

      const itemsBySale = {}
      allItems.forEach(item => {
        if (!itemsBySale[item.sale_id]) {
          itemsBySale[item.sale_id] = []
        }
        itemsBySale[item.sale_id].push(item)
      })

      const processedSales = sales.map(sale => {
        sale.items = itemsBySale[sale.id] || []
        return sale
      })

      const backUrl = "/admin/sales"
      const backLabel = "Back to Sales Tab"

      res.render("admin/sales-receipt-bulk", {
        title: "Bulk Sale Receipts",
        sales: processedSales,
        backUrl,
        backLabel,
      })
    } catch (error) {
      console.error("Bulk print error:", error)
      req.session.error = "Error loading sales"
      res.redirect("/admin/sales")
    }
  }
})



router.post("/sales/delete/:id", async (req, res) => {
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()


    await connection.query("DELETE FROM sale_items WHERE sale_id = ?", [req.params.id])


    await connection.query("DELETE FROM sales WHERE id = ?", [req.params.id])

    await connection.commit()
    req.session.success = "Sale deleted successfully"
    res.redirect("/admin/sales")
  } catch (error) {
    await connection.rollback()
    console.error("Delete sale error:", error)
    req.session.error = "Error deleting sale"
    res.redirect("/admin/sales")
  } finally {
    connection.release()
  }
})


router.post("/sales/bulk-delete", async (req, res) => {
  let { saleIds } = req.body


  if (typeof saleIds === 'string') {
    try {
      saleIds = JSON.parse(saleIds)
    } catch (error) {
      console.error("Error parsing saleIds:", error)
      req.session.error = "Invalid sale selection"
      return res.redirect("/admin/sales")
    }
  }

  if (!saleIds || !Array.isArray(saleIds) || saleIds.length === 0) {
    req.session.error = "No sales selected"
    return res.redirect("/admin/sales")
  }

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()

    const placeholders = saleIds.map(() => '?').join(',')
    

    await connection.query(
      `DELETE FROM sale_items WHERE sale_id IN (${placeholders})`,
      saleIds
    )


    await connection.query(
      `DELETE FROM sales WHERE id IN (${placeholders})`,
      saleIds
    )

    await connection.commit()
    req.session.success = `${saleIds.length} sale(s) deleted successfully`
    res.redirect("/admin/sales")
  } catch (error) {
    await connection.rollback()
    console.error("Bulk delete error:", error)
    req.session.error = "Error deleting sales"
    res.redirect("/admin/sales")
  } finally {
    connection.release()
  }
})


router.get("/sales/edit/:id", async (req, res) => {
  try {
    const [sales] = await db.query("SELECT * FROM sales WHERE id = ?", [req.params.id])

    if (sales.length === 0) {
      req.session.error = "Sale not found"
      return res.redirect("/admin/sales")
    }

    const [items] = await db.query(
      `SELECT si.*, p.name as product_name, p.sku, p.unit_price as current_unit_price
       FROM sale_items si
       JOIN products p ON si.product_id = p.id
       WHERE si.sale_id = ?`,
      [req.params.id]
    )

    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")
    const [employees] = await db.query("SELECT id, CONCAT(first_name, ' ', last_name) as name FROM users WHERE role IN ('employee', 'admin') AND is_active = TRUE ORDER BY first_name")
    const [customers] = await db.query("SELECT id, first_name, last_name, email FROM users WHERE role = 'customer' AND is_active = TRUE ORDER BY first_name")
    const [products] = await db.query("SELECT id, name, sku, unit_price FROM products WHERE is_active = TRUE ORDER BY name")

    res.render("admin/sale-form", {
      title: "Edit Sale",
      sale: { ...sales[0], items },
      branches,
      employees,
      customers,
      products,
    })
  } catch (error) {
    console.error("Edit sale error:", error)
    req.session.error = "Error loading sale"
    res.redirect("/admin/sales")
  }
})


router.post("/sales/edit/:id", async (req, res) => {
  const { 
    branchId, employeeId, customerId, subtotal, tax, discount, discountType, total, 
    paymentMethod, paymentStatus, notes, saleItems
  } = req.body

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()

    const customerValue = customerId === "walk-in" ? null : customerId || null

    await connection.query(
      `UPDATE sales SET branch_id = ?, employee_id = ?, customer_id = ?, subtotal = ?, 
       tax = ?, discount = ?, discount_type = ?, total = ?, payment_method = ?, payment_status = ?, notes = ?
       WHERE id = ?`,
      [
        branchId, employeeId, customerValue, subtotal, tax, discount || 0, 
        discountType || 'fixed', total, paymentMethod, paymentStatus, notes || null, req.params.id
      ]
    )

    await connection.query("DELETE FROM sale_items WHERE sale_id = ?", [req.params.id])

    if (saleItems) {
      let items = []
      try {
        items = JSON.parse(saleItems)
      } catch (err) {
        console.error("Error parsing sale items:", err)
        items = []
      }
      
      for (const item of items) {
        await connection.query(
          "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)",
          [req.params.id, item.productId, item.quantity, item.unitPrice, item.subtotal]
        )
      }
    }

    await connection.commit()
    req.session.success = "Sale updated successfully"
    res.redirect("/admin/sales")
  } catch (error) {
    await connection.rollback()
    console.error("Update sale error:", error)
    req.session.error = "Error updating sale"
    res.redirect(`/admin/sales/edit/${req.params.id}`)
  } finally {
    connection.release()
  }
})


router.get("/inventory/incoming-orders", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 20
    const offset = (page - 1) * limit
    const search = req.query.search || ""
    const orderType = req.query.type || ""
    const statusFilter = req.query.status || ""

    let whereConditions = ["o.branch_id IS NULL"]
    let queryParams = []

    if (search) {
      whereConditions.push("(CONCAT(cu.first_name, ' ', cu.last_name) LIKE ? OR o.id LIKE ?)")
      const searchPattern = `%${search}%`
      queryParams.push(searchPattern, searchPattern)
    }

    if (orderType) {
      whereConditions.push("o.order_type = ?")
      queryParams.push(orderType)
    }

    if (statusFilter) {
      whereConditions.push("o.status = ?")
      queryParams.push(statusFilter)
    }

    const whereClause = whereConditions.join(" AND ")

    const [[{ count }]] = await db.query(
      `SELECT COUNT(*) as count FROM orders o
       JOIN users cu ON o.customer_id = cu.id
       WHERE ${whereClause}`,
      queryParams
    )
    const total = count

    const [orders] = await db.query(
      `SELECT o.*, 
        CONCAT(cu.first_name, ' ', cu.last_name) as customer_name,
        cu.email as customer_email,
        cu.phone as customer_phone,
        COUNT(oi.id) as product_count,
        SUM(oi.quantity) as total_items
       FROM orders o
       JOIN users cu ON o.customer_id = cu.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE ${whereClause}
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    )

    const totalPages = Math.ceil(total / limit)

    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")

    res.render("admin/incoming-orders", {
      title: "Incoming Orders",
      orders,
      branches,
      currentPage: page,
      totalPages,
      totalOrders: total,
      search,
      orderType,
      statusFilter
    })
  } catch (error) {
    console.error("Incoming orders error:", error)
    req.session.error = "Error loading incoming orders"
    res.redirect("/admin/dashboard")
  }
})


router.post("/inventory/incoming-orders/assign", async (req, res) => {
  const { orderIds, branchId, discount, discountType, deliveryFee, status } = req.body

  try {
    let ids = []
    try {
      ids = orderIds ? JSON.parse(orderIds) : []
    } catch (err) {
      ids = Array.isArray(orderIds) ? orderIds : [orderIds]
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      req.session.error = "No orders selected"
      return res.redirect("/admin/inventory/incoming-orders")
    }

    for (const orderId of ids) {
      const [orders] = await db.query("SELECT * FROM orders WHERE id = ?", [orderId])
      if (orders.length === 0) continue

      const order = orders[0]
      

      let newSubtotal = parseFloat(order.subtotal) || 0
      let newDiscount = parseFloat(discount) || 0
      let newDeliveryFee = parseFloat(deliveryFee) || 0
      let newTotal = newSubtotal

      if (discountType === 'percentage') {
        newTotal = newSubtotal - (newSubtotal * newDiscount / 100)
      } else {
        newTotal = newSubtotal - newDiscount
      }
      
      newTotal += newDeliveryFee


      const newStatus = status || 'pending'
      await db.query(
        `UPDATE orders 
         SET branch_id = ?, discount = ?, discount_type = ?, delivery_fee = ?, total = ?, status = ?, updated_by = ?
         WHERE id = ?`,
        [branchId, newDiscount, discountType || 'fixed', newDeliveryFee, newTotal, newStatus, req.session.user.id, orderId]
      )
    }

    req.session.success = `${ids.length} order(s) assigned to branch successfully`
    res.redirect("/admin/inventory/incoming-orders")
  } catch (error) {
    console.error("Assign orders error:", error)
    req.session.error = "Error assigning orders"
    res.redirect("/admin/inventory/incoming-orders")
  }
})

module.exports = router


