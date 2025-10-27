# Pharmacy Inventory Management System

A comprehensive multi-branch pharmacy inventory and POS system built with Node.js, Express, EJS, and MySQL.

## Features

- **Multi-Branch Management**: Manage multiple pharmacy locations
- **Role-Based Access Control**: Admin, Employee, and Customer roles
- **Inventory Management**: Track stock levels, expiry dates, and restock requests
- **POS System**: Point of sale for in-store transactions
- **Customer Ordering**: Online ordering for pickup and delivery
- **Product Management**: Comprehensive product catalog with categories
- **Restock Management**: Automated restock requests and approvals
- **Sales Reporting**: Track sales and inventory movements

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MySQL
- **Template Engine**: EJS
- **Authentication**: bcryptjs, express-session
- **Icons**: Font Awesome 6

## Installation

1. Clone the repository
2. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

3. Create a `.env` file based on `.env.example`:
   \`\`\`bash
   cp .env.example .env
   \`\`\`

4. Update the `.env` file with your database credentials

5. Create the database and run migrations:
   \`\`\`bash
   # Connect to MySQL and run the SQL scripts in order:
   mysql -u root -p < scripts/01_create_database.sql
   mysql -u root -p < scripts/02_seed_data.sql
   \`\`\`

6. Start the server:
   \`\`\`bash
   npm run dev
   \`\`\`

7. Access the application at `http://localhost:3000`

## Default Credentials

After running the seed script, you can log in with:
- **Username**: admin
- **Password**: admin123

**Important**: Change the default password immediately after first login!

## User Roles

### Admin
- Full system access
- Manage all branches
- Manage employees and their branch access
- View all reports and analytics
- Approve restock requests

### Employee
- Access to assigned branches only
- Process POS transactions
- Manage inventory for assigned branches
- Create restock requests
- View branch-specific reports

### Customer
- Browse products
- Place orders for pickup or delivery
- View order history
- Manage account information

## Project Structure

\`\`\`
pharmacy-inventory/
├── config/
│   └── database.js          # Database configuration
├── middleware/
│   └── auth.js              # Authentication middleware
├── routes/
│   ├── auth.js              # Authentication routes
│   ├── admin.js             # Admin routes
│   ├── employee.js          # Employee routes
│   ├── customer.js          # Customer routes
│   └── pos.js               # POS routes
├── views/
│   ├── auth/                # Authentication views
│   ├── layout.ejs           # Main layout template
│   └── error.ejs            # Error page
├── public/
│   └── css/
│       └── style.css        # Main stylesheet
├── scripts/
│   ├── 01_create_database.sql
│   └── 02_seed_data.sql
├── server.js                # Main application file
├── package.json
└── .env.example
\`\`\`

## Color Scheme

The system uses a green-themed color palette:
- Primary Green: #55A44E
- Light Green: #7CCB70
- Background: #F3F7F4
- Text: #1C1C1C

## Development

Run in development mode with auto-reload:
\`\`\`bash
npm run dev
\`\`\`

## License

ISC


