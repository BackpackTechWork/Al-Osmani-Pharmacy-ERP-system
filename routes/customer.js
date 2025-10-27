const express = require("express")
const router = express.Router()
const db = require("../config/database")


router.get("/home", async (req, res) => {
  try {

    const [featuredProducts] = await db.query(`
      SELECT 
        p.*,
        c.name as category_name,
        (
          COALESCE((
            SELECT SUM(r.quantity)
            FROM restock r
            WHERE r.product_id = p.id
          ), 0) -
          COALESCE((
            SELECT SUM(oi.quantity)
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.product_id = p.id
            AND o.status IN ('shipped', 'completed', 'ready')
          ), 0) -
          COALESCE((
            SELECT SUM(si.quantity)
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE si.product_id = p.id
            AND s.payment_status = 'paid'
          ), 0)
        ) AS total_stock,
        (
          COALESCE((
            SELECT SUM(oi.quantity)
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.product_id = p.id
            AND o.status IN ('shipped', 'completed', 'ready')
          ), 0) +
          COALESCE((
            SELECT SUM(si.quantity)
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE si.product_id = p.id
            AND s.payment_status = 'paid'
          ), 0)
        ) AS total_sold
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = TRUE
      ORDER BY total_sold DESC, p.created_at DESC
      LIMIT 9
    `)


    const productsWithStatus = featuredProducts.map(p => {
      const stock = Number(p.total_stock) || 0
      const floor = Number(p.floor_level) || 0
      const diff = Math.abs(stock - floor)
      
      let stock_status
      
      if (stock <= 0) {
        stock_status = {
          key: 'sold_out',
          label: 'Sold Out',
          color: '#6c757d',
          textColor: '#ffffff'
        }
      } else if (stock < floor || diff <= 20) {
        stock_status = {
          key: 'limited',
          label: 'Limited Stock',
          color: '#ffc107',
          textColor: '#000000'
        }
      } else {
        stock_status = {
          key: 'available',
          label: 'Available',
          color: '#28a745',
          textColor: '#ffffff'
        }
      }      
      
      return { ...p, stock_status }
    })


    const [categories] = await db.query(`
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.is_active = TRUE
      GROUP BY c.id
      ORDER BY c.name
    `)


    const [topCategories] = await db.query(`
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.is_active = TRUE
      GROUP BY c.id
      HAVING product_count > 0
      ORDER BY product_count DESC, c.name ASC
      LIMIT 4
    `)

    res.render("customer/landing", {
      title: "Al-Osmani Pharmacy - Welcome",
      featuredProducts: productsWithStatus,
      categories,
      topCategories,
      currentPath: '/customer/home'
    })
  } catch (error) {
    console.error("Error loading landing page:", error)
    res.status(500).render("error", {
      title: "Error",
      message: "Unable to load landing page. Please try again later.",
    })
  }
})


router.get("/shop", async (req, res) => {
  try {
    const { category, search, sort = 'name_asc' } = req.query
    

    let query = `
      SELECT 
        p.*,
        c.name as category_name,
        (
          COALESCE((
            SELECT SUM(r.quantity)
            FROM restock r
            WHERE r.product_id = p.id
          ), 0) -
          COALESCE((
            SELECT SUM(oi.quantity)
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.product_id = p.id
            AND o.status IN ('shipped', 'completed', 'ready')
          ), 0) -
          COALESCE((
            SELECT SUM(si.quantity)
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE si.product_id = p.id
            AND s.payment_status = 'paid'
          ), 0)
        ) AS total_stock
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = TRUE
    `
    const params = []


    if (category) {
      const categoryIds = category.split(',').filter(id => id.trim())
      if (categoryIds.length > 0) {
        query += ` AND p.category_id IN (${categoryIds.map(() => '?').join(',')})`
        params.push(...categoryIds)
      }
    }


    if (search) {
      query += ` AND (p.name LIKE ? OR p.description LIKE ? OR p.manufacturer LIKE ?)`
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }


    switch (sort) {
      case 'name_asc':
        query += ` ORDER BY p.name ASC`
        break
      case 'name_desc':
        query += ` ORDER BY p.name DESC`
        break
      case 'price_asc':
        query += ` ORDER BY p.unit_price ASC`
        break
      case 'price_desc':
        query += ` ORDER BY p.unit_price DESC`
        break
      case 'newest':
        query += ` ORDER BY p.created_at DESC`
        break
      default:
        query += ` ORDER BY p.name ASC`
    }

    const [products] = await db.query(query, params)


    const productsWithStatus = products.map(p => {
      const stock = Number(p.total_stock) || 0
      const floor = Number(p.floor_level) || 0
      const diff = Math.abs(stock - floor)
      
      let stock_status
      
      if (stock <= 0) {
        stock_status = {
          key: 'sold_out',
          label: 'Sold Out',
          color: '#6c757d',
          textColor: '#ffffff'
        }
      } else if (stock < floor || diff <= 20) {
        stock_status = {
          key: 'limited',
          label: 'Limited Stock',
          color: '#ffc107',
          textColor: '#000000'
        }
      } else {
        stock_status = {
          key: 'available',
          label: 'Available',
          color: '#28a745',
          textColor: '#ffffff'
        }
      }
      
      return { ...p, stock_status }
    })


    const [categories] = await db.query(`
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.is_active = TRUE
      GROUP BY c.id
      ORDER BY c.name
    `)


    if (req.headers['x-requested-with'] === 'XMLHttpRequest') {

      return res.render("customer/_products-partial", {
        products: productsWithStatus,
        currentCategory: category || '',
        searchQuery: search || '',
        currentSort: sort,
        categories: categories,
        layout: false
      })
    } else {

      res.render("customer/shop", {
        title: "Shop - Al-Osmani Pharmacy",
        products: productsWithStatus,
        categories,
        currentCategory: category || '',
        searchQuery: search || '',
        currentSort: sort,
        currentPath: '/customer/shop'
      })
    }
  } catch (error) {
    console.error("Error loading shop page:", error)
    
    if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(500).send('Error loading products')
    } else {
      res.status(500).render("error", {
        title: "Error",
        message: "Unable to load products. Please try again later.",
      })
    }
  }
})


router.get("/product/:id", async (req, res) => {
  try {
    const [products] = await db.query(`
      SELECT 
        p.*,
        c.name as category_name,
        (
          COALESCE((
            SELECT SUM(r.quantity)
            FROM restock r
            WHERE r.product_id = p.id
          ), 0) -
          COALESCE((
            SELECT SUM(oi.quantity)
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.product_id = p.id
            AND o.status IN ('shipped', 'completed', 'ready')
          ), 0) -
          COALESCE((
            SELECT SUM(si.quantity)
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE si.product_id = p.id
            AND s.payment_status = 'paid'
          ), 0)
        ) AS total_stock
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ? AND p.is_active = TRUE
    `, [req.params.id])

    if (products.length === 0) {
      return res.status(404).render("error", {
        title: "Product Not Found",
        message: "The product you are looking for does not exist or is no longer available.",
      })
    }


    const product = products[0]
    const stock = Number(product.total_stock) || 0
    const floor = Number(product.floor_level) || 0
    const diff = Math.abs(stock - floor)
    
    let stock_status = {
      key: 'available',
      label: 'Available',
      color: '#28a745',
      textColor: '#ffffff'
    }
    
    if (stock <= 0) {
      stock_status = {
        key: 'sold_out',
        label: 'Sold Out',
        color: '#6c757d',
        textColor: '#ffffff'
      }
    } else if (stock < floor || diff <= 20) {
      stock_status = {
        key: 'limited',
        label: 'Limited Stock',
        color: '#ffc107',
        textColor: '#000000'
      }
    }
    
    product.stock_status = stock_status


    const [relatedProducts] = await db.query(`
      SELECT 
        p.*,
        c.name as category_name,
        (
          COALESCE((
            SELECT SUM(r.quantity)
            FROM restock r
            WHERE r.product_id = p.id
          ), 0) -
          COALESCE((
            SELECT SUM(oi.quantity)
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.product_id = p.id
            AND o.status IN ('shipped', 'completed', 'ready')
          ), 0) -
          COALESCE((
            SELECT SUM(si.quantity)
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE si.product_id = p.id
            AND s.payment_status = 'paid'
          ), 0)
        ) AS total_stock
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.category_id = ? AND p.id != ? AND p.is_active = TRUE
      ORDER BY RAND()
      LIMIT 4
    `, [product.category_id, req.params.id])


    const relatedProductsWithStatus = relatedProducts.map(p => {
      const stock = Number(p.total_stock) || 0
      const floor = Number(p.floor_level) || 0
      const diff = Math.abs(stock - floor)
      
      let stock_status = {
        key: 'available',
        label: 'Available',
        color: '#28a745',
        textColor: '#ffffff'
      }
      
      if (stock <= 0) {
        stock_status = {
          key: 'sold_out',
          label: 'Sold Out',
          color: '#6c757d',
          textColor: '#ffffff'
        }
      } else if (stock < floor || diff <= 20) {
        stock_status = {
          key: 'limited',
          label: 'Limited Stock',
          color: '#ffc107',
          textColor: '#000000'
        }
      }
      
      return { ...p, stock_status }
    })

    res.render("customer/product-detail", {
      title: `${product.name} - Al-Osmani Pharmacy`,
      product,
      relatedProducts: relatedProductsWithStatus,
      currentPath: '/customer/product'
    })
  } catch (error) {
    console.error("Error loading product detail:", error)
    res.status(500).render("error", {
      title: "Error",
      message: "Unable to load product details. Please try again later.",
    })
  }
})


router.post("/cart/add", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.status(401).json({ success: false, message: "Please login to add items to cart" })
    }

    const { productId, quantity } = req.body
    const customerId = req.session.user.id


    const [products] = await db.query(
      "SELECT id, name, unit_price FROM products WHERE id = ? AND is_active = TRUE",
      [productId]
    )

    if (products.length === 0) {
      return res.status(404).json({ success: false, message: "Product not found" })
    }


    const [existing] = await db.query(
      "SELECT id, quantity FROM cart WHERE customer_id = ? AND product_id = ?",
      [customerId, productId]
    )

    if (existing.length > 0) {

      const newQuantity = existing[0].quantity + parseInt(quantity)
      await db.query(
        "UPDATE cart SET quantity = ?, updated_at = NOW() WHERE id = ?",
        [newQuantity, existing[0].id]
      )
    } else {

      await db.query(
        "INSERT INTO cart (customer_id, product_id, quantity) VALUES (?, ?, ?)",
        [customerId, productId, quantity]
      )
    }


    const [[{ count }]] = await db.query(
      "SELECT COUNT(*) as count FROM cart WHERE customer_id = ?",
      [customerId]
    )

    res.json({ success: true, message: "Added to cart", cartCount: count })
  } catch (error) {
    console.error("Add to cart error:", error)
    res.status(500).json({ success: false, message: "Error adding to cart" })
  }
})


router.get("/cart", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.redirect("/auth/login?redirect=/customer/cart")
    }

    const customerId = req.session.user.id


    const [cartItems] = await db.query(`
      SELECT 
        c.*,
        p.name, p.sku, p.unit_price, p.image_url, p.floor_level,
        (
          COALESCE((
            SELECT SUM(r.quantity)
            FROM restock r
            WHERE r.product_id = p.id
          ), 0) -
          COALESCE((
            SELECT SUM(oi.quantity)
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.product_id = p.id
            AND o.status IN ('shipped', 'completed', 'ready')
          ), 0) -
          COALESCE((
            SELECT SUM(si.quantity)
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE si.product_id = p.id
            AND s.payment_status = 'paid'
          ), 0)
        ) AS total_stock
      FROM cart c
      JOIN products p ON c.product_id = p.id
      WHERE c.customer_id = ? AND p.is_active = TRUE
      ORDER BY c.created_at DESC
    `, [customerId])


    let subtotal = 0
    const itemsWithStatus = cartItems.map(item => {
      const stock = Number(item.total_stock) || 0
      const floor = Number(item.floor_level) || 0
      const diff = Math.abs(stock - floor)
      
      let stock_status
      if (stock <= 0) {
        stock_status = { key: 'sold_out', label: 'Sold Out', color: '#6c757d', textColor: '#ffffff' }
      } else if (stock < floor || diff <= 20) {
        stock_status = { key: 'limited', label: 'Limited Stock', color: '#ffc107', textColor: '#000000' }
      } else {
        stock_status = { key: 'available', label: 'Available', color: '#28a745', textColor: '#ffffff' }
      }

      const itemTotal = item.unit_price * item.quantity
      subtotal += itemTotal

      return { ...item, stock_status, item_total: itemTotal }
    })

    res.render("customer/cart", {
      title: "Shopping Cart - Al-Osmani Pharmacy",
      cartItems: itemsWithStatus,
      subtotal,
      user: req.session.user,
      currentPath: '/customer/cart'
    })
  } catch (error) {
    console.error("View cart error:", error)
    res.status(500).render("error", {
      title: "Error",
      message: "Unable to load cart. Please try again later."
    })
  }
})


router.post("/cart/update", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.status(401).json({ success: false, message: "Unauthorized" })
    }

    const { cartId, quantity } = req.body
    const customerId = req.session.user.id

    if (parseInt(quantity) <= 0) {

      await db.query(
        "DELETE FROM cart WHERE id = ? AND customer_id = ?",
        [cartId, customerId]
      )
    } else {

      await db.query(
        "UPDATE cart SET quantity = ?, updated_at = NOW() WHERE id = ? AND customer_id = ?",
        [quantity, cartId, customerId]
      )
    }

    res.json({ success: true, message: "Cart updated" })
  } catch (error) {
    console.error("Update cart error:", error)
    res.status(500).json({ success: false, message: "Error updating cart" })
  }
})


router.post("/cart/remove", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.status(401).json({ success: false, message: "Unauthorized" })
    }

    const { cartId } = req.body
    const customerId = req.session.user.id

    await db.query(
      "DELETE FROM cart WHERE id = ? AND customer_id = ?",
      [cartId, customerId]
    )

    res.json({ success: true, message: "Item removed from cart" })
  } catch (error) {
    console.error("Remove from cart error:", error)
    res.status(500).json({ success: false, message: "Error removing item" })
  }
})


router.get("/cart/count", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.json({ count: 0 })
    }

    const [[{ count }]] = await db.query(
      "SELECT COUNT(*) as count FROM cart WHERE customer_id = ?",
      [req.session.user.id]
    )

    res.json({ count })
  } catch (error) {
    console.error("Get cart count error:", error)
    res.json({ count: 0 })
  }
})


router.get("/checkout", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.redirect("/auth/login?redirect=/customer/checkout")
    }

    const customerId = req.session.user.id
    const { buyNow, productId, quantity, selected } = req.query
    let cartItems = []


    if (req.session.orderAgainItems && req.session.orderAgainItems.length > 0) {

      const items = req.session.orderAgainItems
      const productIds = items.map(item => item.productId)
      
      const [products] = await db.query(`
        SELECT 
          p.id as product_id,
          p.name, p.sku, p.unit_price, p.image_url, p.floor_level,
          (
            COALESCE((
              SELECT SUM(r.quantity)
              FROM restock r
              WHERE r.product_id = p.id
            ), 0) -
            COALESCE((
              SELECT SUM(oi.quantity)
              FROM order_items oi
              JOIN orders o ON oi.order_id = o.id
              WHERE oi.product_id = p.id
              AND o.status IN ('shipped', 'completed', 'ready')
            ), 0) -
            COALESCE((
              SELECT SUM(si.quantity)
              FROM sale_items si
              JOIN sales s ON si.sale_id = s.id
              WHERE si.product_id = p.id
              AND s.payment_status = 'paid'
            ), 0)
          ) AS total_stock
        FROM products p
        WHERE p.id IN (${productIds.map(() => '?').join(',')}) AND p.is_active = TRUE
      `, productIds)


      cartItems = products.map(product => {
        const orderItem = items.find(item => item.productId === product.product_id)
        return {
          ...product,
          quantity: orderItem ? orderItem.quantity : 1
        }
      })

      if (cartItems.length === 0) {
        delete req.session.orderAgainItems
        req.session.error = "Products from the order are no longer available"
        return res.redirect("/customer/shop")
      }
    }

    else if (buyNow === 'true' && productId && quantity) {

      const [products] = await db.query(`
        SELECT 
          p.id as product_id,
          p.name, p.sku, p.unit_price, p.image_url, p.floor_level,
          ? as quantity,
          (
            COALESCE((
              SELECT SUM(r.quantity)
              FROM restock r
              WHERE r.product_id = p.id
            ), 0) -
            COALESCE((
              SELECT SUM(oi.quantity)
              FROM order_items oi
              JOIN orders o ON oi.order_id = o.id
              WHERE oi.product_id = p.id
              AND o.status IN ('shipped', 'completed', 'ready')
            ), 0) -
            COALESCE((
              SELECT SUM(si.quantity)
              FROM sale_items si
              JOIN sales s ON si.sale_id = s.id
              WHERE si.product_id = p.id
              AND s.payment_status = 'paid'
            ), 0)
          ) AS total_stock
        FROM products p
        WHERE p.id = ? AND p.is_active = TRUE
      `, [parseInt(quantity), productId])

      if (products.length === 0) {
        return res.redirect("/customer/shop")
      }

      cartItems = products

      req.session.buyNowCheckout = { productId, quantity: parseInt(quantity) }
    } else {

      let query = `
        SELECT 
          c.*,
          p.name, p.sku, p.unit_price, p.image_url, p.floor_level,
          (
            COALESCE((
              SELECT SUM(r.quantity)
              FROM restock r
              WHERE r.product_id = p.id
            ), 0) -
            COALESCE((
              SELECT SUM(oi.quantity)
              FROM order_items oi
              JOIN orders o ON oi.order_id = o.id
              WHERE oi.product_id = p.id
              AND o.status IN ('shipped', 'completed', 'ready')
            ), 0) -
            COALESCE((
              SELECT SUM(si.quantity)
              FROM sale_items si
              JOIN sales s ON si.sale_id = s.id
              WHERE si.product_id = p.id
              AND s.payment_status = 'paid'
            ), 0)
          ) AS total_stock
        FROM cart c
        JOIN products p ON c.product_id = p.id
        WHERE c.customer_id = ? AND p.is_active = TRUE`
      
      const params = [customerId]
      

      if (selected) {
        const selectedIds = selected.split(',').filter(id => id.trim())
        if (selectedIds.length > 0) {
          query += ` AND c.id IN (${selectedIds.map(() => '?').join(',')})`
          params.push(...selectedIds)

          req.session.selectedCartItems = selectedIds
        }
      } else {

        delete req.session.selectedCartItems
      }
      
      query += ` ORDER BY c.created_at DESC`
      
      const [items] = await db.query(query, params)

      if (items.length === 0) {
        req.session.error = "Your cart is empty or no items selected"
        return res.redirect("/customer/cart")
      }

      cartItems = items

      delete req.session.buyNowCheckout
    }


    let subtotal = 0
    const items = cartItems.map(item => {
      const stock = Number(item.total_stock) || 0
      const itemTotal = item.unit_price * item.quantity
      subtotal += itemTotal
      return { ...item, item_total: itemTotal, total_stock: stock }
    })


    const tax = subtotal * 0.08
    const total = subtotal + tax


    const [users] = await db.query(
      "SELECT * FROM users WHERE id = ?",
      [customerId]
    )

    res.render("customer/checkout", {
      title: "Checkout - Al-Osmani Pharmacy",
      cartItems: items,
      subtotal,
      tax,
      total,
      user: users[0],
      currentPath: '/customer/checkout'
    })
  } catch (error) {
    console.error("Checkout page error:", error)
    res.status(500).render("error", {
      title: "Error",
      message: "Unable to load checkout page. Please try again later."
    })
  }
})


router.post("/order/submit", async (req, res) => {
  const connection = await db.getConnection()
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.status(401).json({ success: false, message: "Unauthorized" })
    }

    const { 
      orderType, deliveryAddress, deliveryCity, deliveryState, deliveryZip, notes 
    } = req.body
    const customerId = req.session.user.id

    await connection.beginTransaction()

    let orderItems = []


    if (req.session.orderAgainItems && req.session.orderAgainItems.length > 0) {
      const items = req.session.orderAgainItems
      const productIds = items.map(item => item.productId)
      

      const [products] = await connection.query(`
        SELECT 
          p.id as product_id,
          p.unit_price,
          (
            COALESCE((
              SELECT SUM(r.quantity)
              FROM restock r
              WHERE r.product_id = p.id
            ), 0) -
            COALESCE((
              SELECT SUM(oi.quantity)
              FROM order_items oi
              JOIN orders o ON oi.order_id = o.id
              WHERE oi.product_id = p.id
              AND o.status IN ('shipped', 'completed', 'ready')
            ), 0) -
            COALESCE((
              SELECT SUM(si.quantity)
              FROM sale_items si
              JOIN sales s ON si.sale_id = s.id
              WHERE si.product_id = p.id
              AND s.payment_status = 'paid'
            ), 0)
          ) AS total_stock
        FROM products p
        WHERE p.id IN (${productIds.map(() => '?').join(',')}) AND p.is_active = TRUE
      `, productIds)

      if (products.length === 0) {
        await connection.rollback()
        return res.status(400).json({ success: false, message: "Products not found" })
      }


      orderItems = products.map(product => {
        const orderItem = items.find(item => item.productId === product.product_id)
        return {
          ...product,
          quantity: orderItem ? orderItem.quantity : 1
        }
      })
    }

    else if (req.session.buyNowCheckout) {
      const { productId, quantity } = req.session.buyNowCheckout
      

      const [products] = await connection.query(`
        SELECT 
          p.id as product_id,
          p.unit_price,
          ? as quantity,
          (
            COALESCE((
              SELECT SUM(r.quantity)
              FROM restock r
              WHERE r.product_id = p.id
            ), 0) -
            COALESCE((
              SELECT SUM(oi.quantity)
              FROM order_items oi
              JOIN orders o ON oi.order_id = o.id
              WHERE oi.product_id = p.id
              AND o.status IN ('shipped', 'completed', 'ready')
            ), 0) -
            COALESCE((
              SELECT SUM(si.quantity)
              FROM sale_items si
              JOIN sales s ON si.sale_id = s.id
              WHERE si.product_id = p.id
              AND s.payment_status = 'paid'
            ), 0)
          ) AS total_stock
        FROM products p
        WHERE p.id = ? AND p.is_active = TRUE
      `, [quantity, productId])

      if (products.length === 0) {
        await connection.rollback()
        return res.status(400).json({ success: false, message: "Product not found" })
      }

      orderItems = products
    } else {

      let query = `
        SELECT 
          c.*,
          p.unit_price,
          (
            COALESCE((
              SELECT SUM(r.quantity)
              FROM restock r
              WHERE r.product_id = p.id
            ), 0) -
            COALESCE((
              SELECT SUM(oi.quantity)
              FROM order_items oi
              JOIN orders o ON oi.order_id = o.id
              WHERE oi.product_id = p.id
              AND o.status IN ('shipped', 'completed', 'ready')
            ), 0) -
            COALESCE((
              SELECT SUM(si.quantity)
              FROM sale_items si
              JOIN sales s ON si.sale_id = s.id
              WHERE si.product_id = p.id
              AND s.payment_status = 'paid'
            ), 0)
          ) AS total_stock
        FROM cart c
        JOIN products p ON c.product_id = p.id
        WHERE c.customer_id = ? AND p.is_active = TRUE`
      
      const params = [customerId]
      

      if (req.session.selectedCartItems && req.session.selectedCartItems.length > 0) {
        const selectedIds = req.session.selectedCartItems
        query += ` AND c.id IN (${selectedIds.map(() => '?').join(',')})`
        params.push(...selectedIds)
      }
      
      const [cartItems] = await connection.query(query, params)

      if (cartItems.length === 0) {
        await connection.rollback()
        return res.status(400).json({ success: false, message: "Cart is empty or no items selected" })
      }

      orderItems = cartItems
    }


    const violations = []
    for (const item of orderItems) {
      const stock = Number(item.total_stock) || 0
      if (item.quantity > stock) {
        violations.push({ productId: item.product_id, requested: item.quantity, available: stock })
      }
    }

    if (violations.length > 0) {
      await connection.rollback()
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient stock for ${violations.length} item(s). Please check availability.`,
        violations 
      })
    }


    let subtotal = 0
    orderItems.forEach(item => {
      subtotal += item.unit_price * item.quantity
    })

    const tax = subtotal * 0.08 
    const discount = 0 
    const deliveryFee = 0 
    const total = subtotal + tax + deliveryFee - discount


    const [result] = await connection.query(
      `INSERT INTO orders (customer_id, branch_id, order_type, status, subtotal, tax, discount, 
       discount_type, delivery_fee, total, delivery_address, delivery_city, delivery_state, 
       delivery_zip, notes, created_by)
       VALUES (?, NULL, ?, 'requested', ?, ?, ?, 'fixed', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerId, orderType, subtotal, tax, discount, deliveryFee, total,
        orderType === 'delivery' ? deliveryAddress : null,
        orderType === 'delivery' ? deliveryCity : null,
        orderType === 'delivery' ? deliveryState : null,
        orderType === 'delivery' ? deliveryZip : null,
        notes || null,
        customerId
      ]
    )

    const orderId = result.insertId


    for (const item of orderItems) {
      const itemSubtotal = item.unit_price * item.quantity
      await connection.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)",
        [orderId, item.product_id, item.quantity, item.unit_price, itemSubtotal]
      )
    }


    if (!req.session.buyNowCheckout) {
      if (req.session.selectedCartItems && req.session.selectedCartItems.length > 0) {

        const selectedIds = req.session.selectedCartItems
        await connection.query(
          `DELETE FROM cart WHERE customer_id = ? AND id IN (${selectedIds.map(() => '?').join(',')})`,
          [customerId, ...selectedIds]
        )
      } else {

        await connection.query("DELETE FROM cart WHERE customer_id = ?", [customerId])
      }
    }


    delete req.session.buyNowCheckout
    delete req.session.selectedCartItems
    delete req.session.orderAgainItems

    await connection.commit()

    res.json({ 
      success: true, 
      message: "Order placed successfully", 
      orderId 
    })
  } catch (error) {
    await connection.rollback()
    console.error("Submit order error:", error)
    res.status(500).json({ success: false, message: "Error placing order" })
  } finally {
    connection.release()
  }
})


router.get("/order/confirmation/:id", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.redirect("/auth/login")
    }

    const customerId = req.session.user.id
    const orderId = req.params.id


    const [orders] = await db.query(
      `SELECT o.*, b.name as branch_name
       FROM orders o
       LEFT JOIN branches b ON o.branch_id = b.id
       WHERE o.id = ? AND o.customer_id = ?`,
      [orderId, customerId]
    )

    if (orders.length === 0) {
      return res.status(404).render("error", {
        title: "Order Not Found",
        message: "Order not found or you don't have permission to view it."
      })
    }


    const [items] = await db.query(
      `SELECT oi.*, p.name as product_name, p.sku
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [orderId]
    )

    res.render("customer/order-confirmation", {
      title: "Order Confirmation - Al-Osmani Pharmacy",
      order: orders[0],
      items,
      user: req.session.user,
      currentPath: '/customer/order/confirmation'
    })
  } catch (error) {
    console.error("Order confirmation error:", error)
    res.status(500).render("error", {
      title: "Error",
      message: "Unable to load order confirmation. Please try again later."
    })
  }
})


router.get("/orders", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.redirect("/auth/login?redirect=/customer/orders")
    }

    const customerId = req.session.user.id
    const { page = 1, search = '', orderType = '', status = '' } = req.query
    const limit = 10
    const offset = (parseInt(page) - 1) * limit


    let whereConditions = ['o.customer_id = ?']
    let queryParams = [customerId]


    if (search) {
      whereConditions.push(`(
        CAST(o.id AS CHAR) LIKE ? OR
        EXISTS (
          SELECT 1 FROM order_items oi2
          JOIN products p2 ON oi2.product_id = p2.id
          WHERE oi2.order_id = o.id AND p2.name LIKE ?
        )
      )`)
      queryParams.push(`%${search}%`, `%${search}%`)
    }


    if (orderType) {
      whereConditions.push('o.order_type = ?')
      queryParams.push(orderType)
    }


    if (status) {
      whereConditions.push('o.status = ?')
      queryParams.push(status)
    }

    const whereClause = whereConditions.join(' AND ')


    const [[{ total }]] = await db.query(
      `SELECT COUNT(DISTINCT o.id) as total
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE ${whereClause}`,
      queryParams
    )


    const [orders] = await db.query(
      `SELECT o.*, 
        b.name as branch_name,
        COUNT(oi.id) as item_count
       FROM orders o
       LEFT JOIN branches b ON o.branch_id = b.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE ${whereClause}
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    )

    const totalPages = Math.ceil(total / limit)


    if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.json({
        success: true,
        orders,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          total,
          limit,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      })
    }


    res.render("customer/orders", {
      title: "My Orders - Al-Osmani Pharmacy",
      orders,
      user: req.session.user,
      currentPath: '/customer/orders',
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        total,
        limit
      },
      filters: {
        search,
        orderType,
        status
      }
    })
  } catch (error) {
    console.error("Order history error:", error)
    
    if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(500).json({ success: false, message: 'Error loading orders' })
    }
    
    res.status(500).render("error", {
      title: "Error",
      message: "Unable to load order history. Please try again later."
    })
  }
})


router.get("/order/:id", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.redirect("/auth/login")
    }

    const customerId = req.session.user.id
    const orderId = req.params.id


    const [orders] = await db.query(
      `SELECT o.*, b.name as branch_name, b.address, b.city, b.state, b.zip_code
       FROM orders o
       LEFT JOIN branches b ON o.branch_id = b.id
       WHERE o.id = ? AND o.customer_id = ?`,
      [orderId, customerId]
    )

    if (orders.length === 0) {
      return res.status(404).render("error", {
        title: "Order Not Found",
        message: "Order not found or you don't have permission to view it."
      })
    }


    const [items] = await db.query(
      `SELECT oi.*, p.name as product_name, p.sku, p.image_url
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [orderId]
    )

    res.render("customer/order-detail", {
      title: `Order #${orderId} - Al-Osmani Pharmacy`,
      order: orders[0],
      items,
      user: req.session.user,
      currentPath: '/customer/order'
    })
  } catch (error) {
    console.error("Order detail error:", error)
    res.status(500).render("error", {
      title: "Error",
      message: "Unable to load order details. Please try again later."
    })
  }
})


router.post("/order/:id/again", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== 'customer') {
      return res.status(401).json({ success: false, message: "Please login to reorder" })
    }

    const customerId = req.session.user.id
    const orderId = req.params.id


    const [orders] = await db.query(
      `SELECT o.* FROM orders o
       WHERE o.id = ? AND o.customer_id = ? AND o.status = 'completed'`,
      [orderId, customerId]
    )

    if (orders.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found, doesn't belong to you, or is not completed yet" 
      })
    }


    const [orderItems] = await db.query(`
      SELECT 
        oi.product_id,
        oi.quantity as original_quantity,
        p.name,
        p.unit_price as current_price,
        p.is_active,
        oi.unit_price as original_price,
        (
          COALESCE((
            SELECT SUM(r.quantity)
            FROM restock r
            WHERE r.product_id = p.id
          ), 0) -
          COALESCE((
            SELECT SUM(oi2.quantity)
            FROM order_items oi2
            JOIN orders o2 ON oi2.order_id = o2.id
            WHERE oi2.product_id = p.id
            AND o2.status IN ('shipped', 'completed', 'ready')
          ), 0) -
          COALESCE((
            SELECT SUM(si.quantity)
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE si.product_id = p.id
            AND s.payment_status = 'paid'
          ), 0)
        ) AS current_stock
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [orderId])

    if (orderItems.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "No items found in this order" 
      })
    }


    const unavailableItems = []
    const outOfStockItems = []
    const priceChangedItems = []
    const availableItems = []

    orderItems.forEach(item => {
      if (!item.is_active) {
        unavailableItems.push(item.name)
      } else if (item.current_stock < item.original_quantity) {
        outOfStockItems.push({
          name: item.name,
          requested: item.original_quantity,
          available: item.current_stock
        })
      } else {

        if (parseFloat(item.current_price) !== parseFloat(item.original_price)) {
          priceChangedItems.push({
            name: item.name,
            oldPrice: parseFloat(item.original_price).toFixed(2),
            newPrice: parseFloat(item.current_price).toFixed(2)
          })
        }
        availableItems.push({
          productId: item.product_id,
          quantity: item.original_quantity
        })
      }
    })


    let warnings = []
    if (unavailableItems.length > 0) {
      warnings.push(`${unavailableItems.length} item(s) no longer available: ${unavailableItems.join(', ')}`)
    }
    if (outOfStockItems.length > 0) {
      const stockWarnings = outOfStockItems.map(i => 
        `${i.name} (requested: ${i.requested}, available: ${i.available})`
      )
      warnings.push(`${outOfStockItems.length} item(s) have insufficient stock: ${stockWarnings.join(', ')}`)
    }
    if (priceChangedItems.length > 0) {
      const priceWarnings = priceChangedItems.map(i => 
        `${i.name} (was $${i.oldPrice}, now $${i.newPrice})`
      )
      warnings.push(`${priceChangedItems.length} item(s) have price changes: ${priceWarnings.join(', ')}`)
    }

    if (availableItems.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "None of the items from this order are currently available for purchase",
        warnings
      })
    }


    req.session.orderAgainItems = availableItems
    
    res.json({ 
      success: true, 
      message: availableItems.length === orderItems.length 
        ? "All items are available. Redirecting to checkout..." 
        : "Some items are unavailable. Proceeding with available items...",
      warnings: warnings.length > 0 ? warnings : null,
      availableCount: availableItems.length,
      totalCount: orderItems.length
    })
  } catch (error) {
    console.error("Order again error:", error)
    res.status(500).json({ success: false, message: "Error processing reorder" })
  }
})

module.exports = router


