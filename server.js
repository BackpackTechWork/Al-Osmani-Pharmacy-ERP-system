require("dotenv").config()
const express = require("express")
const session = require("express-session")
const path = require("path")
const methodOverride = require("method-override")

const app = express()
const PORT = process.env.PORT || 3000


app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(methodOverride("_method"))
app.use(express.static(path.join(__dirname, "public")))
app.use("/fontawesome", express.static(path.join(__dirname, "node_modules/@fortawesome/fontawesome-free")))


app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret kyi",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "something",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
)


app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))


app.use((req, res, next) => {
  res.locals.user = req.session.user || null
  res.locals.success = req.session.success || null
  res.locals.error = req.session.error || null
  delete req.session.success
  delete req.session.error
  next()
})


const authRoutes = require("./routes/auth")
const adminRoutes = require("./routes/admin")
const employeeRoutes = require("./routes/employee")
const customerRoutes = require("./routes/customer")
const posRoutes = require("./routes/pos")

app.use("/auth", authRoutes)
app.use("/admin", adminRoutes)
app.use("/employee", employeeRoutes)
app.use("/customer", customerRoutes)
app.use("/pos", posRoutes)


app.get("/", (req, res) => {
  if (req.session.user) {
    switch (req.session.user.role) {
      case "admin":
        return res.redirect("/admin/dashboard")
      case "employee":
        return res.redirect("/employee/dashboard")
      case "customer":
        return res.redirect("/customer/shop")
      default:
        return res.redirect("/auth/login")
    }
  }
  res.redirect("/customer/home")
})


app.use((req, res) => {
  res.status(404).render("error", {
    title: "404 - Page Not Found",
    message: "The page you are looking for does not exist.",
  })
})

app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).render("error", {
    title: "500 - Server Error",
    message: "Something went wrong on our end.",
  })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pharmacy Inventory System running at:`)
  console.log(`Local:http://localhost:${PORT}`)
  console.log(`Network: http://192.168.0.4:${PORT}`)
})



