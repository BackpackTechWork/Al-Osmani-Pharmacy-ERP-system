const express = require("express")
const router = express.Router()
const { requireRole, getUserBranches } = require("../middleware/auth")
const db = require("../config/database")


router.use(requireRole("employee", "admin"))


router.get("/", async (req, res) => {
  try {
    const branches = await getUserBranches(req.session.user.id, req.session.user.role)
    const selectedBranch = req.query.branch || (branches.length > 0 ? branches[0].id : null)

    if (!selectedBranch) {
      return res.render("pos/index", {
        title: "Point of Sale",
        branches,
        selectedBranch: null,
        products: [],
        categories: [],
      })
    }


    const [categories] = await db.query("SELECT * FROM categories ORDER BY name")


    const baseQuery = `
      SELECT p.id, p.name, p.sku, p.unit_price, p.image_url, p.floor_level, p.category_id,
             c.name as category_name, i.id as inventory_id,
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
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE i.branch_id = ? AND p.is_active = TRUE
    `

    const [productsRaw] = await db.query(baseQuery, [selectedBranch])
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

    res.render("pos/index", {
      title: "Point of Sale",
      branches,
      selectedBranch: Number.parseInt(selectedBranch),
      products,
      categories,
    })
  } catch (error) {
    console.error("POS error:", error)
    req.session.error = "Error loading POS"
    res.redirect("/employee/dashboard")
  }
})


router.post("/sale", async (req, res) => {
  const { branchId, items, subtotal, tax, discount, discountType, total, paymentMethod, customerId, notes } = req.body

  const connection = await db.getConnection()

  try {
    await connection.beginTransaction()


    const [saleResult] = await connection.query(
      "INSERT INTO sales (branch_id, employee_id, customer_id, subtotal, tax, discount, discount_type, total, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [branchId, req.session.user.id, customerId || null, subtotal, tax, discount, discountType || 'fixed', total, paymentMethod, notes || null],
    )

    const saleId = saleResult.insertId


    const saleItems = JSON.parse(items)


    if (!Array.isArray(saleItems) || saleItems.length === 0) {
      throw new Error('No sale items provided')
    }


    const requestedByProduct = new Map()
    for (const item of saleItems) {
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
      return res.status(400).json({
        success: false,
        message: `Insufficient stock for ${violations.length} item(s). Please refresh and try again.`,
        violations
      })
    }

    for (const item of saleItems) {

      await connection.query(
        "INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)",
        [saleId, item.productId, item.quantity, item.unitPrice, item.subtotal],
      )
    }

    await connection.commit()

    res.json({
      success: true,
      saleId,
      message: "Sale completed successfully",
    })
  } catch (error) {
    await connection.rollback()
    console.error("Sale processing error:", error)
    res.status(500).json({
      success: false,
      message: "Error processing sale",
    })
  } finally {
    connection.release()
  }
})


router.get("/receipt-data/:id", async (req, res) => {
  try {
    const [sales] = await db.query(
      `
      SELECT 
        s.*, 
        b.name AS branch_name, 
        b.address, 
        b.city, 
        b.state, 
        b.zip_code, 
        u.first_name AS employee_first_name, 
        u.last_name AS employee_last_name, 
        c.first_name AS customer_first_name, 
        c.last_name AS customer_last_name
      FROM sales s
      JOIN branches b ON s.branch_id = b.id
      JOIN users u ON s.employee_id = u.id
      LEFT JOIN users c ON s.customer_id = c.id
      WHERE s.id = ?
      `,
      [req.params.id]
    );

    if (sales.length === 0) {
      return res.status(404).json({ error: "Sale not found" });
    }

    const [items] = await db.query(
      `
      SELECT 
        si.*, 
        p.name AS product_name, 
        p.sku
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
      `,
      [req.params.id]
    );

    res.json({
      sale: sales[0],
      items
    });

  } catch (error) {
    console.error("Receipt data error:", error);
    res.status(500).json({ error: "Error loading receipt data" });
  }
});


router.get("/receipt/:id", async (req, res) => {
  try {
    const [sales] = await db.query(
      `
      SELECT 
        s.*, 
        b.name AS branch_name, 
        b.address, 
        b.city, 
        b.state, 
        b.zip_code, 
        u.first_name AS employee_first_name, 
        u.last_name AS employee_last_name, 
        c.first_name AS customer_first_name, 
        c.last_name AS customer_last_name
      FROM sales s
      JOIN branches b ON s.branch_id = b.id
      JOIN users u ON s.employee_id = u.id
      LEFT JOIN users c ON s.customer_id = c.id
      WHERE s.id = ?
      `,
      [req.params.id]
    );

    if (sales.length === 0) {
      req.session.error = "Sale not found";
      return res.redirect("/pos");
    }

    const [items] = await db.query(
      `
      SELECT 
        si.*, 
        p.name AS product_name, 
        p.sku
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = ?
      `,
      [req.params.id]
    );

    res.render("pos/receipt", {
      title: "Sale Receipt",
      sale: sales[0],
      items,
      backUrl: "/pos",
      backLabel: "Back to POS"
    });

  } catch (error) {
    console.error("Receipt error:", error);
    req.session.error = "Error loading receipt";
    res.redirect("/pos");
  }
});



module.exports = router
