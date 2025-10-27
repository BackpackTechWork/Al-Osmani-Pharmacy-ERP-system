
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    req.session.error = "Please log in to access this page"
    return res.redirect("/auth/login")
  }
  next()
}


const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.session.user) {
      req.session.error = "Please log in to access this page"
      return res.redirect("/auth/login")
    }

    if (!roles.includes(req.session.user.role)) {
      req.session.error = "You do not have permission to access this page"
      return res.redirect("/")
    }

    next()
  }
}


const requireBranchAccess = async (req, res, next) => {
  const db = require("../config/database")
  const branchId = req.params.branchId || req.body.branch_id || req.query.branch_id

  if (!branchId) {
    return next()
  }


  if (req.session.user.role === "admin") {
    return next()
  }


  if (req.session.user.role === "employee") {
    try {
      const [access] = await db.query("SELECT * FROM employee_branch_access WHERE employee_id = ? AND branch_id = ?", [
        req.session.user.id,
        branchId,
      ])

      if (access.length === 0) {
        req.session.error = "You do not have access to this branch"
        return res.redirect("/employee/dashboard")
      }
    } catch (error) {
      console.error("Branch access check error:", error)
      return res.status(500).send("Server error")
    }
  }

  next()
}

const getUserBranches = async (userId, role) => {
  const db = require("../config/database")

  if (role === "admin") {

    const [branches] = await db.query("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")
    return branches
  } else if (role === "employee") {

    const [branches] = await db.query(
      `SELECT b.* FROM branches b
       INNER JOIN employee_branch_access eba ON b.id = eba.branch_id
       WHERE eba.employee_id = ? AND b.is_active = TRUE
       ORDER BY b.name`,
      [userId],
    )
    return branches
  }

  return []
}

module.exports = {
  requireAuth,
  requireRole,
  requireBranchAccess,
  getUserBranches,
}


