const express = require("express")
const router = express.Router()
const { requireRole, getUserBranches } = require("../middleware/auth")
const db = require("../config/database")


router.use(requireRole("employee", "admin"))


router.get("/dashboard", async (req, res) => {
  try {
    const branches = await getUserBranches(req.session.user.id, req.session.user.role)


    const [todaySales] = await db.query(
      `SELECT COUNT(*) as count
       FROM sales
       WHERE employee_id = ? AND DATE(created_at) = CURDATE()`,
      [req.session.user.id],
    )


    const branchIds = branches.map((b) => b.id)
    const placeholders = branchIds.map(() => "?").join(",")
    
    let todayOrdersCount = 0
    if (branchIds.length > 0) {
      const [todayOrders] = await db.query(
        `SELECT COUNT(*) as count
         FROM orders
         WHERE branch_id IN (${placeholders}) AND DATE(created_at) = CURDATE() AND updated_by = ?`,
        [...branchIds, req.session.user.id],
      )
      todayOrdersCount = todayOrders[0].count
    }


    const totalActivity = todaySales[0].count + todayOrdersCount
    let productivity = {
      count: totalActivity,
      title: "Keep Going!",
      message: "Every transaction counts. You're making a difference!",
      icon: "fa-smile",
      gradient: "#6c757d",
      gradientLight: "#95a5a6"
    }

    if (totalActivity === 0) {
      productivity = {
        count: totalActivity,
        title: "Ready to Start!",
        message: "A new day, new opportunities. Let's make it count!",
        icon: "fa-coffee",
        gradient: "#17a2b8",
        gradientLight: "#5dade2"
      }
    } else if (totalActivity >= 1 && totalActivity <= 5) {
      productivity = {
        count: totalActivity,
        title: "Great Start!",
        message: "You're off to a good beginning. Keep up the momentum!",
        icon: "fa-smile",
        gradient: "#28a745",
        gradientLight: "#52c97c"
      }
    } else if (totalActivity >= 6 && totalActivity <= 15) {
      productivity = {
        count: totalActivity,
        title: "Doing Great!",
        message: "Your hard work is showing. Customers appreciate you!",
        icon: "fa-grin-stars",
        gradient: "#fd7e14",
        gradientLight: "#ff9f40"
      }
    } else if (totalActivity > 15) {
      productivity = {
        count: totalActivity,
        title: "Outstanding Work!",
        message: "You're crushing it today! Amazing productivity!",
        icon: "fa-trophy",
        gradient: "#ffc107",
        gradientLight: "#ffd54f"
      }
    }


    let lowStock = []
    if (branchIds.length > 0) {
      const [lowStockData] = await db.query(`
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
        WHERE p.is_active = TRUE AND i.branch_id IN (${placeholders})
        HAVING total_stock < p.floor_level OR ABS(total_stock - p.floor_level) = 20
        ORDER BY b.name, p.name
        LIMIT 10
      `, branchIds)


      lowStock = lowStockData.map(item => {
        const stock = item.total_stock
        const floorLevel = item.floor_level
        const diff = Math.abs(stock - floorLevel)
        
        if (stock === 0 || stock < floorLevel) {
          item.stock_status = 'reorder'
          item.stock_status_label = 'Reorder'
          item.stock_status_color = '#dc3545'
          item.stock_status_text_color = '#ffffff'
        } else if (diff === 20) {
          item.stock_status = 'critical'
          item.stock_status_label = 'Critical'
          item.stock_status_color = '#ffc107'
          item.stock_status_text_color = '#000000'
        }
        return item
      })
    }


    const [incomingOrders] = await db.query(
      `SELECT o.*, 
        CONCAT(cu.first_name, ' ', cu.last_name) as customer_name,
        COUNT(oi.id) as product_count
       FROM orders o
       JOIN users cu ON o.customer_id = cu.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.branch_id IS NULL
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 10`
    )

    res.render("employee/dashboard", {
      title: "Employee Dashboard",
      branches,
      productivity,
      lowStock,
      incomingOrders,
    })
  } catch (error) {
    console.error("Employee dashboard error:", error)
    req.session.error = "Error loading dashboard"
    res.redirect("/")
  }
})


router.get("/inventory/stock-management", async (req, res) => {
  try {
    const branches = await getUserBranches(req.session.user.id, req.session.user.role)
    const selectedBranch = req.query.branch || (branches.length > 0 ? branches[0].id : null)
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const offset = (page - 1) * limit
    const search = req.query.search || ""
    const categoryFilter = req.query.category || ""
    const stockStatusFilter = req.query.stockStatus || ""

    if (!selectedBranch) {
      return res.render("employee/stock-management", {
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

    res.render("employee/stock-management", {
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
    res.redirect("/employee/dashboard")
  }
})


router.get("/inventory/orders", async (req, res) => {
  try {
    const branches = await getUserBranches(req.session.user.id, req.session.user.role)
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

    res.render("employee/orders", {
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
    res.redirect("/employee/dashboard")
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
      return res.redirect("/employee/inventory/orders")
    }

    const [items] = await db.query(
      `SELECT oi.*, p.name as product_name, p.sku
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [req.params.id]
    )

    res.render("employee/order-view", {
      title: "Order Details",
      order: orders[0],
      items,
    })
  } catch (error) {
    console.error("View order error:", error)
    req.session.error = "Error loading order"
    res.redirect("/employee/inventory/orders")
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
      return res.redirect("/employee/inventory/orders")
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
    res.redirect("/employee/inventory/orders")
  }
})


router.get("/sales", async (req, res) => {
  try {
    const branches = await getUserBranches(req.session.user.id, req.session.user.role)
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


    if (branches.length > 0) {
      const branchIds = branches.map(b => b.id)
      whereConditions.push(`s.branch_id IN (${branchIds.map(() => '?').join(',')})`)
      queryParams.push(...branchIds)
    } else {

      whereConditions.push("1 = 0")
    }

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


    const employeeBranchIds = branches.map(b => b.id)
    const [employees] = await db.query(
      `SELECT DISTINCT u.id, CONCAT(u.first_name, ' ', u.last_name) as name 
       FROM users u
       JOIN sales s ON u.id = s.employee_id
       WHERE u.role = 'employee' AND u.is_active = TRUE
       ${employeeBranchIds.length > 0 ? `AND s.branch_id IN (${employeeBranchIds.map(() => '?').join(',')})` : ''}
       ORDER BY name`,
      employeeBranchIds
    )

    res.render("employee/sales", {
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
    res.redirect("/employee/dashboard")
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
      return res.redirect("/employee/sales")
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
      backUrl: "/employee/sales",
      backLabel: "Sales"
    })
  } catch (error) {
    console.error("Print receipt error:", error)
    req.session.error = "Error loading receipt"
    res.redirect("/employee/sales")
  }
})


router.get("/inventory/orders/add", async (req, res) => {
  try {
    const branches = await getUserBranches(req.session.user.id, req.session.user.role)
    const branchId = req.query.branch || (branches.length > 0 ? branches[0].id : null)
    
    if (!branchId) {
      req.session.error = "You don't have access to any branches"
      return res.redirect("/employee/inventory/orders")
    }


    if (!branches.some(b => b.id === parseInt(branchId))) {
      req.session.error = "You don't have access to this branch"
      return res.redirect("/employee/inventory/orders")
    }

    const [customers] = await db.query(
      "SELECT id, first_name, last_name, email, phone FROM users WHERE role = 'customer' AND is_active = TRUE ORDER BY first_name"
    )


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

    res.render("admin/order-form", {
      title: "Add Order",
      order: null,
      customers,
      products,
      branches,
      branchId,
      isEmployee: true
    })
  } catch (error) {
    console.error("Add order page error:", error)
    req.session.error = "Error loading form"
    res.redirect("/employee/inventory/orders")
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

    const branches = await getUserBranches(req.session.user.id, req.session.user.role)
    if (!branches.some(b => b.id === parseInt(branchId))) {
      req.session.error = "You don't have access to this branch"
      return res.redirect("/employee/inventory/orders")
    }

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
      return res.redirect(`/employee/inventory/orders/add?branch=${branchId}`)
    }


    const [result] = await connection.query(
      `INSERT INTO orders (
        customer_id, branch_id, order_type, status, subtotal, tax, discount, discount_type,
        delivery_fee, total, delivery_address, delivery_city, delivery_state, delivery_zip, notes,
        created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerId, branchId, orderType, status, subtotal, tax, discount || 0, discountType || 'fixed',
        deliveryFee || 0, total, deliveryAddress, deliveryCity, deliveryState, deliveryZip, notes,
        req.session.user.id, req.session.user.id
      ]
    )

    const orderId = result.insertId


    for (const item of items) {
      await connection.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, item.productId, item.quantity, item.unitPrice, item.subtotal]
      )
    }

    await connection.commit()
    req.session.success = "Order created successfully"
    res.redirect(`/employee/inventory/orders?branch=${branchId}`)
  } catch (error) {
    await connection.rollback()
    console.error("Create order error:", error)
    req.session.error = error.message || "Error creating order"
    res.redirect(`/employee/inventory/orders/add?branch=${branchId}`)
  } finally {
    connection.release()
  }
})


router.post("/inventory/orders/bulk-update-status", async (req, res) => {
  const { orderIds, status, branch } = req.body

  try {

    const branches = await getUserBranches(req.session.user.id, req.session.user.role)
    const branchId = parseInt(branch)
    
    if (!branches.some(b => b.id === branchId)) {
      req.session.error = "You don't have access to this branch"
      return res.redirect(`/employee/inventory/orders?branch=${branchId}`)
    }

    let ids = []
    try {
      ids = orderIds ? JSON.parse(orderIds) : []
    } catch (err) {
      ids = Array.isArray(orderIds) ? orderIds : [orderIds]
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      req.session.error = "No orders selected"
      return res.redirect(`/employee/inventory/orders?branch=${branchId}`)
    }


    for (const orderId of ids) {
      const [orders] = await db.query(
        "SELECT branch_id FROM orders WHERE id = ?",
        [orderId]
      )
      
      if (orders.length === 0) {
        req.session.error = "One or more orders not found"
        return res.redirect(`/employee/inventory/orders?branch=${branchId}`)
      }
      
      const orderBranchId = orders[0].branch_id
      if (!branches.some(b => b.id === orderBranchId)) {
        req.session.error = "You don't have permission to update one or more of these orders"
        return res.redirect(`/employee/inventory/orders?branch=${branchId}`)
      }
    }


    for (const orderId of ids) {
      await db.query(
        `UPDATE orders SET status = ?, updated_by = ? WHERE id = ?`,
        [status, req.session.user.id, orderId]
      )
    }

    req.session.success = `${ids.length} order(s) status updated to ${status.toUpperCase()}`
    res.redirect(`/employee/inventory/orders?branch=${branchId}`)
  } catch (error) {
    console.error("Bulk update status error:", error)
    req.session.error = "Error updating order status"
    const branchId = parseInt(req.body.branch)
    res.redirect(`/employee/inventory/orders?branch=${branchId}`)
  }
})


router.get("/inventory/incoming-orders", async (req, res) => {
  try {
    const branches = await getUserBranches(req.session.user.id, req.session.user.role)
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

    res.render("employee/incoming-orders", {
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
    res.redirect("/employee/dashboard")
  }
})


router.post("/inventory/incoming-orders/assign", async (req, res) => {
  const { orderIds, branchId, discount, discountType, deliveryFee, status } = req.body

  try {

    const branches = await getUserBranches(req.session.user.id, req.session.user.role)
    if (!branches.some(b => b.id === parseInt(branchId))) {
      req.session.error = "You don't have access to this branch"
      return res.redirect("/employee/inventory/incoming-orders")
    }

    let ids = []
    try {
      ids = orderIds ? JSON.parse(orderIds) : []
    } catch (err) {
      ids = Array.isArray(orderIds) ? orderIds : [orderIds]
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      req.session.error = "No orders selected"
      return res.redirect("/employee/inventory/incoming-orders")
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
    res.redirect("/employee/inventory/incoming-orders")
  } catch (error) {
    console.error("Assign orders error:", error)
    req.session.error = "Error assigning orders"
    res.redirect("/employee/inventory/incoming-orders")
  }
})


router.post("/inventory/orders/add-customer", async (req, res) => {
  const bcrypt = require("bcryptjs")
  
  try {
    const { firstName, lastName, username, email, password, phone } = req.body


    if (!firstName || !lastName || !username || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "First name, last name, username, email, and password are required" 
      })
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: "Password must be at least 6 characters long" 
      })
    }


    const [existingEmail] = await db.query("SELECT id FROM users WHERE email = ?", [email])
    if (existingEmail.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Customer with this email already exists" 
      })
    }

    const [existingUsername] = await db.query("SELECT id FROM users WHERE username = ?", [username])
    if (existingUsername.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Username already exists. Please choose a different username." 
      })
    }

    const passwordHash = await bcrypt.hash(password, 10)


    const [result] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, phone, role, is_active, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, 'customer', TRUE, NOW())`,
      [username, email, passwordHash, firstName, lastName, phone || null]
    )

    res.json({ 
      success: true, 
      message: "Customer added successfully",
      customer: {
        id: result.insertId,
        first_name: firstName,
        last_name: lastName,
        username: username,
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

module.exports = router


