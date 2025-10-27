const express = require("express")
const router = express.Router()
const bcrypt = require("bcryptjs")
const db = require("../config/database")


router.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/")
  }
  res.render("auth/login", { title: "Login" })
})


router.post("/login", async (req, res) => {
  const { username, password } = req.body

  try {
    const [users] = await db.query("SELECT * FROM users WHERE username = ? AND is_active = TRUE", [username])

    if (users.length === 0) {
      req.session.error = "Invalid username or password"
      return res.redirect("/auth/login")
    }

    const user = users[0]
    const validPassword = await bcrypt.compare(password, user.password_hash)

    if (!validPassword) {
      req.session.error = "Invalid username or password"
      return res.redirect("/auth/login")
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      branchId: user.branch_id,
    }

    req.session.success = `Welcome back, ${user.first_name}!`
    res.redirect("/")
  } catch (error) {
    console.error("Login error:", error)
    req.session.error = "An error occurred during login"
    res.redirect("/auth/login")
  }
})


router.get("/register", (req, res) => {
  if (req.session.user) {
    return res.redirect("/")
  }
  res.render("auth/register", { title: "Register" })
})


router.post("/register", async (req, res) => {
  const { username, email, password, firstName, lastName, phone } = req.body

  try {

    const [existing] = await db.query("SELECT * FROM users WHERE username = ? OR email = ?", [username, email])

    if (existing.length > 0) {
      req.session.error = "Username or email already exists"
      return res.redirect("/auth/register")
    }


    const passwordHash = await bcrypt.hash(password, 10)


    await db.query(
      "INSERT INTO users (username, email, password_hash, first_name, last_name, phone, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [username, email, passwordHash, firstName, lastName, phone, "customer"],
    )

    req.session.success = "Registration successful! Please log in."
    res.redirect("/auth/login")
  } catch (error) {
    console.error("Registration error:", error)
    req.session.error = "An error occurred during registration"
    res.redirect("/auth/register")
  }
})


router.get("/logout", (req, res) => {
  req.session.destroy()
  res.redirect("/customer/home")
})


router.get("/profile", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/auth/login")
  }

  try {
    const [users] = await db.query(
      `SELECT u.*, b.name as branch_name 
       FROM users u 
       LEFT JOIN branches b ON u.branch_id = b.id 
       WHERE u.id = ?`,
      [req.session.user.id],
    )

    if (users.length === 0) {
      req.session.error = "User not found"
      return res.redirect("/auth/login")
    }

    res.render("auth/profile", {
      title: "My Profile",
      user: users[0],
    })
  } catch (error) {
    console.error("Profile error:", error)
    req.session.error = "An error occurred loading your profile"
    res.redirect("/")
  }
})


router.post("/profile/update", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/auth/login")
  }

  const { firstName, lastName, email, phone } = req.body

  try {

    const [existingUsers] = await db.query(
      "SELECT id, email FROM users WHERE email = ? AND id != ?",
      [email, req.session.user.id]
    )

    if (existingUsers.length > 0) {
      req.session.error = "This email is already registered to another account. Please use a different email address."
      return res.redirect("/auth/profile")
    }

    await db.query("UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ? WHERE id = ?", [
      firstName,
      lastName,
      email,
      phone,
      req.session.user.id,
    ])


    req.session.user.firstName = firstName
    req.session.user.lastName = lastName
    req.session.user.email = email

    req.session.success = "Profile updated successfully"
    res.redirect("/auth/profile")
  } catch (error) {
    console.error("Profile update error:", error)
    req.session.error = "An error occurred updating your profile"
    res.redirect("/auth/profile")
  }
})


router.post("/profile/change-password", async (req, res) => {
  if (!req.session.user) {
    return res.redirect("/auth/login")
  }

  const { currentPassword, newPassword, confirmPassword } = req.body

  if (newPassword !== confirmPassword) {
    req.session.error = "New passwords do not match"
    return res.redirect("/auth/profile")
  }

  try {
    const [users] = await db.query("SELECT password_hash FROM users WHERE id = ?", [req.session.user.id])

    if (users.length === 0) {
      req.session.error = "User not found"
      return res.redirect("/auth/login")
    }

    const validPassword = await bcrypt.compare(currentPassword, users[0].password_hash)

    if (!validPassword) {
      req.session.error = "Current password is incorrect"
      return res.redirect("/auth/profile")
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10)
    await db.query("UPDATE users SET password_hash = ? WHERE id = ?", [newPasswordHash, req.session.user.id])

    req.session.success = "Password changed successfully"
    res.redirect("/auth/profile")
  } catch (error) {
    console.error("Password change error:", error)
    req.session.error = "An error occurred changing your password"
    res.redirect("/auth/profile")
  }
})

module.exports = router


