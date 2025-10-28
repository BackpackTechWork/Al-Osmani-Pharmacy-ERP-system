<div align="center">

# Pharmacy ERP System

### A comprehensive multi-branch pharmacy ERP system

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![EJS](https://img.shields.io/badge/EJS-B4CA65?style=for-the-badge&logo=ejs&logoColor=black)

</div>

---

## Overview

A full-featured pharmacy management system designed for multi-branch operations. Built with modern web technologies, this system provides comprehensive inventory tracking, point-of-sale functionality, and role-based access control for pharmacies of any size.

---

## Features

<table>
<tr>
<td width="50%">

### Core Functionality
- **Multi-Branch Management**  
  Centralized control across multiple pharmacy locations
  
- **Role-Based Access Control**  
  Secure access for Admin, Employee, and Customer roles
  
- **Inventory Management**  
  Real-time stock tracking with expiry date monitoring
  
- **POS System**  
  Fast and reliable point-of-sale transactions

</td>
<td width="50%">

### Advanced Features
- **Customer Ordering**  
  Online ordering with pickup and delivery options
  
- **Product Management**  
  Comprehensive catalog with category organization
  
- **Restock Management**  
  Automated requests with approval workflows
  
- **Sales Reporting**  
  Detailed analytics and inventory movement tracking

</td>
</tr>
</table>

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Backend** | Node.js, Express.js |
| **Database** | MySQL |
| **Template Engine** | EJS |
| **Authentication** | bcryptjs, express-session |
| **UI Icons** | Font Awesome 6 |

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
cd pharmacy-inventory
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment

Create a `.env` file from the example:

```bash
cp .env.example .env
```
```bash
Update the `.env` file with your configuration:

```env
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=pharmacy_db
SESSION_SECRET=your_secret_key
PORT=3000
```

### Step 4: Database Setup

Connect to MySQL and run the migration scripts in order:

```bash
# Create database and tables
mysql -u root -p < scripts/01_create_database.sql

# Seed initial data
mysql -u root -p < scripts/02_seed_data.sql
```

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

- Complete access to all branches
- Employee management and branch assignments
- System-wide reports and analytics
- Restock request approvals
- Configuration and settings management

### Employee

Branch-specific access including:

- Access to assigned branches only
- POS transaction processing
- Inventory management for assigned locations
- Restock request creation
- Branch-specific reporting

### Customer

Self-service portal including:

- Product browsing and search
- Order placement (pickup/delivery)
- Order history and tracking
- Account management
- Prescription uploads

---

## Project Structure

```
pharmacy-inventory/
│
├── config/
│   └── database.js              # Database connection configuration
│
├── middleware/
│   └── auth.js                  # Authentication & authorization middleware
│
├── routes/
│   ├── auth.js                  # Login, logout, registration
│   ├── admin.js                 # Admin dashboard & management
│   ├── employee.js              # Employee operations
│   ├── customer.js              # Customer portal
│   └── pos.js                   # Point of sale system
│
├── views/
│   ├── auth/                    # Authentication templates
│   ├── layout.ejs               # Main layout wrapper
│   └── error.ejs                # Error page template
│
├── public/
│   └── css/
│       └── style.css            # Main stylesheet
│
├── scripts/
│   ├── 01_create_database.sql   # Database schema
│   └── 02_seed_data.sql         # Initial data
│
├── server.js                    # Application entry point
├── package.json                 # Dependencies & scripts
└── .env.example                 # Environment template
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
| `npm test` | Run test suite |

### Environment Variables

```bash
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

## License

This project is unlicensed and available for use.

---

<div align="center">

**Built for modern pharmacy management**

</div>
