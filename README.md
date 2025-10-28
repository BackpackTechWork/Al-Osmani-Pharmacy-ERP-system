<div align="center">

# Al-Osmani ERP System

### A comprehensive multi-branch pharmacy management and e-commerce platform

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![EJS](https://img.shields.io/badge/EJS-B4CA65?style=for-the-badge&logo=ejs&logoColor=black)

</div>

---

## Overview

A full-featured pharmacy ERP system designed for multi-branch operations with integrated e-commerce capabilities. Built with modern web technologies, this system provides comprehensive inventory tracking, point-of-sale functionality, customer ordering platform, and role-based access control suitable for pharmacies of any size.

---

## Features

### Core Functionality

- **Multi-Branch Management**  
  Centralized control across multiple pharmacy locations with branch-specific inventory and operations
  
- **Role-Based Access Control**  
  Secure access for Admin, Employee, and Customer roles with granular permissions
  
- **Inventory Management**  
  Real-time stock tracking with expiry date monitoring and low stock alerts
  
- **POS System**  
  Fast and reliable point-of-sale transactions with receipt printing

### E-Commerce Platform

- **Customer Portal**  
  Full-featured online store with product browsing, search, and filtering
  
- **Shopping Cart**  
  Intuitive cart management with real-time stock validation
  
- **Order Management**  
  Complete order lifecycle from placement to fulfillment with status tracking
  
- **Pickup and Delivery**  
  Flexible order fulfillment options with branch selection

### Advanced Features

- **Product Management**  
  Comprehensive catalog with category organization and image uploads
  
- **Restock Management**  
  Automated restock requests with approval workflows and bulk restocking
  
- **Sales Reporting**  
  Detailed analytics and sales tracking with receipt generation
  
- **User Management**  
  Complete user lifecycle management with profile and authentication

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Backend** | Node.js, Express.js |
| **Database** | MySQL 2 |
| **Template Engine** | EJS |
| **Authentication** | bcryptjs, express-session |
| **Image Processing** | Multer, Sharp |
| **Charting** | Chart.js |
| **UI Icons** | Font Awesome 6 |
| **Method Override** | method-override |

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v14 or higher)
- **MySQL** (v8.0 or higher)
- **npm** or **yarn**

---

## Installation

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd al-osmani-erp-system
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment

Create a `.env` file in the root directory with the following configuration:

```env
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=pharmacy_db
SESSION_SECRET=your_secret_key_here
PORT=3000
NODE_ENV=development
```

### Step 4: Database Setup

The application includes an automatic database initialization feature. On first run, it will:

1. Create the database if it doesn't exist
2. Create all necessary tables
3. Prompt you to seed initial data (optional)

Simply start the server and follow the prompts.

### Step 5: Start the Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

### Step 6: Access the Application

Open your browser and navigate to:

```
http://localhost:3000
```

---

## Default Credentials

After running the seed script, use these credentials to log in:

| Field | Value |
|-------|-------|
| **Username** | `admin` |
| **Password** | `admin123` |

> **Security Notice**: Change the default password immediately after your first login!

---

## User Roles

### Admin

Full system privileges including:

- Complete access to all branches and branch management
- User management (create, update, delete employees and customers)
- Product and category management
- System-wide inventory control
- Restock request approvals and bulk restocking
- Complete order management and fulfillment
- Sales tracking and reporting
- POS access for all branches

### Employee

Branch-specific access including:

- Access to assigned branches only
- POS transaction processing
- Branch-specific inventory management
- View and fulfill customer orders
- Stock management and monitoring
- Sales reporting for assigned branches
- Limited product information access

### Customer

Self-service portal including:

- Browse and search products by category
- View detailed product information and pricing
- Add products to shopping cart
- Place orders with pickup or delivery options
- Select preferred branch for pickup
- Track order status and history
- Manage account profile and settings

---

## Project Structure

```
al-osmani-erp-system/
│
├── config/
│   └── database.js                    # Database connection and initialization
│
├── middleware/
│   └── auth.js                        # Authentication & authorization middleware
│
├── routes/
│   ├── auth.js                        # Login, logout, registration
│   ├── admin.js                       # Admin dashboard & management
│   ├── employee.js                    # Employee operations
│   ├── customer.js                    # Customer portal and e-commerce
│   └── pos.js                         # Point of sale system
│
├── views/
│   ├── admin/                         # Admin panel views (25 templates)
│   │   ├── dashboard.ejs
│   │   ├── branches.ejs
│   │   ├── users.ejs
│   │   ├── products.ejs
│   │   ├── categories.ejs
│   │   ├── inventory.ejs
│   │   ├── orders.ejs
│   │   ├── restock.ejs
│   │   ├── sales.ejs
│   │   └── ...
│   │
│   ├── employee/                      # Employee dashboard views
│   │   ├── dashboard.ejs
│   │   ├── inventory.ejs
│   │   ├── orders.ejs
│   │   └── ...
│   │
│   ├── customer/                      # Customer-facing views
│   │   ├── landing.ejs
│   │   ├── shop.ejs
│   │   ├── cart.ejs
│   │   ├── checkout.ejs
│   │   ├── orders.ejs
│   │   └── ...
│   │
│   ├── pos/                           # POS system views
│   │   ├── index.ejs
│   │   └── receipt.ejs
│   │
│   ├── auth/                          # Authentication views
│   │   ├── login.ejs
│   │   ├── register.ejs
│   │   └── profile.ejs
│   │
│   ├── components/                    # Reusable components
│   │   ├── navbar.ejs
│   │   ├── sidebar.ejs
│   │   └── customer-navbar.ejs
│   │
│   ├── layout.ejs                     # Main layout wrapper
│   └── error.ejs                      # Error page template
│
├── public/
│   ├── css/
│   │   ├── style.css                  # Main stylesheet
│   │   └── fonts/                     # Inter font family
│   │
│   ├── js/
│   │   └── chart.js                   # Chart.js library
│   │
│   ├── Product Images/
│   │   └── Seed/                      # Default product images
│   │
│   ├── Al-osmani logo.png             # Company logo
│   └── favicon.ico                    # Site favicon
│
├── utils/
│   ├── helpers.js                     # Utility functions
│   └── seeder.js                      # Database seeding utility
│
├── server.js                          # Application entry point
├── package.json                       # Dependencies & scripts
└── .env                               # Environment configuration (create this)
```
---

## Color Scheme

The system uses a professional green-themed palette inspired by pharmacy branding:

| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Primary Green** | `#55A44E` | Buttons, headers, primary actions |
| **Light Green** | `#7CCB70` | Hover states, accents |
| **Background** | `#F3F7F4` | Page backgrounds, cards |
| **Text** | `#1C1C1C` | Primary text content |

### CSS Variables

```css
/* Primary Colors */
:root {
  --primary: #55A44E;
  --primary-light: #7CCB70;
  --background: #F3F7F4;
  --text: #1C1C1C;
}
```

---

## Development

### Development Mode

Run with auto-reload for development:

```bash
npm run dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start development server with nodemon |

### Environment Variables

```env
# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=pharmacy_db

# Server Configuration
PORT=3000
NODE_ENV=development

# Session Configuration
SESSION_SECRET=your_secret_key_here
```

---

## Application Flow

### Admin Workflow

1. Log in with admin credentials
2. Access admin dashboard with system overview
3. Manage branches, users, products, and categories
4. Monitor inventory across all branches
5. Review and approve restock requests
6. Process and fulfill customer orders
7. Generate sales reports and analytics
8. Access POS system for any branch

### Employee Workflow

1. Log in with employee credentials
2. View assigned branch dashboard
3. Process customer sales through POS
4. Monitor and manage branch inventory
5. Create restock requests when needed
6. View and fulfill customer orders
7. Track branch-specific sales

### Customer Workflow

1. Browse the online store or register/login
2. Search and filter products by category
3. View detailed product information
4. Add items to shopping cart
5. Select pickup branch or delivery option
6. Place order and receive confirmation
7. Track order status
8. View order history in profile

---

## Key Features Detail

### Inventory Management

- Real-time stock tracking across all branches
- Expiry date monitoring and alerts
- Low stock notifications
- Bulk inventory updates
- Stock movement history
- Branch-specific inventory control

### Order Management

- Customer order placement with cart functionality
- Order status tracking (Pending, Processing, Completed, Cancelled)
- Branch selection for pickup orders
- Delivery option support
- Order fulfillment workflow
- Order history and receipts

### Restock System

- Employee-initiated restock requests
- Admin approval workflow
- Bulk restock operations
- Restock history tracking
- Automatic inventory updates upon approval

### Reporting

- Sales analytics with Chart.js visualization
- Revenue tracking by branch
- Product performance metrics
- Inventory movement reports
- Printable receipts and invoices

---

## Security Features

- Password hashing with bcryptjs
- Session-based authentication
- Role-based access control
- SQL injection prevention through parameterized queries
- Session expiration (24-hour default)
- Secure file upload handling

---

## Author

**Backpack Tech Works**

---

## License

This project is unlicensed and available for use.

---

<div align="center">

**Built for modern pharmacy management**

</div>
