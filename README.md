<div align="center">

  <img src="assets/images/Nexora-Logo.png" alt="NEXORA POS Logo" width="220" />

  # NEXORA POS

  **A modern, offline-first Desktop Point of Sale (POS) system built with Electron and Node.js**

  [![Version](https://img.shields.io/badge/Version-1.0.1-success.svg)](#-whats-new-in-101)
  [![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D16.14.0-brightgreen.svg)](https://nodejs.org/)
  [![Electron Version](https://img.shields.io/badge/Electron-43.4-blue.svg)](https://www.electronjs.org/)
  [![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#building--packaging)
  [![License](https://img.shields.io/badge/License-AGPL%20v3.0-orange.svg)](https://www.gnu.org/licenses/agpl-3.0.html)

</div>

---

<div align="center">
  <img src="screenshots/nexora_pos.png" alt="NEXORA POS Main Dashboard" width="900" />
</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [What's New in 1.0.1](#-whats-new-in-101)
- [Key Features](#-key-features)
- [First-Run Setup](#-first-run-setup)
- [Prerequisites](#-prerequisites)
- [Quick Start & Installation](#-quick-start--installation)
- [Available Scripts](#-available-scripts)
- [Project Architecture](#-project-architecture)
- [Data Storage & Backups](#-data-storage--backups)
- [Screenshots](#-screenshots)
- [Troubleshooting & FAQs](#-troubleshooting--faqs)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

**NEXORA POS** is a desktop Point of Sale application designed for retail, canteens, and small-to-medium businesses. It provides an offline-first architecture powered by an embedded NeDB datastore and an internal Express API server running on port `8001`. 

Whether operating on a standalone checkout computer or configured across multiple terminals over a Local Area Network (LAN), NEXORA POS delivers fast, dependable sales operations without requiring an active internet connection.

---

## 🆕 What's New in 1.0.1

**Customers & credit**
- Customer credit accounts with an **unlimited** or **limited** credit option per customer; the limit is checked at the till.
- **Credit settlement** with printed payment receipts; any overpayment is kept as advance.
- **Customer advance**: extra paid at the till or at settlement is saved for the next bill, deducted automatically, and shown on the bill.
- **Customer Transactions** window with tabs for Transactions, Credit payments and Advance, each with date filter, search and Excel / PDF export.

**Payments**
- New **Bank Transfer** and **Credit** payment methods (Credit is for registered customers only).
- **Partial payment**: a registered customer can pay part by Cash / Card / Bank Transfer and put the rest on credit; the bill shows the split.
- Redesigned, compact **Payment** window that fits every screen size.
- The bill printed before payment shows any advance deducted.

**Products & profit**
- **Cost price** and **selling price** per product (positive numbers only).
- **Profit** section on the Transactions page with its own date filter.
- **Product History**: sales, stock adjustments and edits for each product.

**Transactions & reports**
- Transactions page lists **all** sales (paid and credit) by default, newest first.
- Filters for **Cashier**, **Status**, **Payment Method** (Cash, Card, Bank Transfer, Credit, Partial Payment) and **date range**.
- Invoice table shows the **customer** and the **remaining** amount on credit, and fits the screen without sideways scrolling.
- Styled **Excel (`.xlsx`)** and **PDF** exports on every list, with date filters defaulting to *All dates*.

**Setup & Settings**
- **First-run setup**: a Welcome screen creates the administrator account (no more default `admin` / `admin` login).
- **Reset Database**: clears all data (sales, customers, products, store settings and images) while keeping the user accounts, after an automatic backup.

**Other**
- Pop-up windows always fit the screen and scroll; consistent table toolbars and pagination.
- Show / hide buttons on password fields.
- M-Pesa and the Till filter have been removed.

---

## ✨ Key Features

- **🛒 Point of Sale & Billing**:
  - Fast barcode scanning and manual search by product name or SKU.
  - Category-based product catalog grid for quick touch/mouse selection.
  - Multi-order tabs (open / held orders) for handling simultaneous customer queues.
  - Customer assignment, customizable tax calculation, discounts, and real-time total updates.
  - Returns / refunds and exchanges against earlier invoices.

- **💳 Multiple Payment Methods**:
  - **Cash**: Automated change calculation, with the option to keep extra as customer advance.
  - **Card** and **Bank Transfer**: Record the payment with a reference.
  - **Credit**: Put the bill on a registered customer's account (within their credit limit).
  - **Partial payment**: Pay part now and the rest on credit (registered customers).

- **👤 Customers, Credit & Advance**:
  - Customer register with unlimited or limited credit.
  - Full transaction history per customer, credit balance and settlement.
  - Advance balance that is used automatically on the next bill.

- **📦 Inventory & Stock Management**:
  - Comprehensive stock tracking with real-time stock deductions upon sale.
  - Low-stock visual alerts to prevent out-of-stock scenarios.
  - Cost and selling prices, product image uploads and category organization.
  - Product history of sales, stock adjustments and edits.
  - Built-in barcode generation (`JsBarcode`) and printable label exports.

- **💸 Expenses**:
  - Expenses page in the main navigation, with its own expense types (e.g. Rent, Electricity, Salaries).
  - Each expense records the date, amount, expense type, payment method (Cash, Card or Bank Transfer) and an optional description.
  - Filter by date, type and payment method, with totals per payment method and Excel / PDF export.

- **👥 User Roles & Permissions**:
  - Multi-staff user accounts.
  - Granular permissions: control access to Products, Categories, Transactions, Profit, Expenses, Users, and Settings.
  - Bootstrap Administrator protection to prevent accidental lockouts.

- **🧾 Receipt & Document Printing**:
  - Thermal receipt printing via standard system print dialog or `print-js`.
  - Customizable receipt headers, footers, store contact details, tax ID, and store logos.
  - PDF export for customer invoices and barcode labels.

- **📊 Sales Analytics & Reporting**:
  - Filter transactions by cashier, payment status, payment method, or date range.
  - Sales, transactions, items sold and products totals, plus a profit report.
  - One-click export of lists and reports to Excel (`.xlsx`) and PDF.

- **🌐 Multi-Till Network Support**:
  - Run the central database server on a main host PC (`PORT 8001`).
  - Connect auxiliary cashier tills over the local network to share products, customers, and live inventory.

- **💾 Data Reliability & Backup**:
  - Embedded NoSQL datastores (NeDB) requiring no complex database installations.
  - One-click database backup to timestamped folders.
  - Full restore capability and custom data storage path selector.
  - Reset Database to start fresh while keeping user accounts (backed up automatically first).

---

## 🔐 First-Run Setup

There is no built-in default login. The first time NEXORA POS starts on a machine (when no user accounts exist yet), it shows a **Welcome** screen to create the administrator account:

| Field | Rules |
| :--- | :--- |
| **Full name** | Required |
| **Username** | 3-30 characters: letters, numbers, dot, dash or underscore |
| **Password** | At least 6 characters, entered twice to confirm |

The administrator gets **full access** to all modules and is logged in straight away. Next:
1. Add your store details (name, address, currency, tax, receipt footer and logo) in **Settings**.
2. Add other staff accounts and their permissions in **Users**.

> [!NOTE]
> The setup screen only appears while there are no user accounts, so it can't be used to take over an existing installation. **Reset Database** keeps user accounts, so it does not bring the setup screen back.

---

## ⚙️ Prerequisites

Before installing and running the application, make sure you have:

- **Node.js**: `v16.14.0` or higher (tested with Node.js 18, 20, 22, and 24).
  - Check version: `node -v`
- **npm** (included with Node.js) or **yarn**:
  - Check npm version: `npm -v`
- **Git**: Installed and available in your command line.

---

## 🚀 Quick Start & Installation

### 1. Clone the Repository

```bash
git clone https://github.com/MohamedMusthaque/Nexora.git
cd Nexora
```

### 2. Install Dependencies

Using **npm** (Standard - recommended):
```bash
npm install
```

*Or using **yarn** (if you have Yarn installed):*
```bash
yarn
```

### 3. Run in Development Mode

Using **npm**:
```bash
npm run electron
```

*Or using **yarn**:*
```bash
yarn electron
```

This starts the Express API server on `http://localhost:8001` and opens the desktop Electron window with live hot-reloading enabled via `nodemon`.

### 4. First Launch

On a new machine the app opens the **Welcome** screen. Create the administrator account there (see [First-Run Setup](#-first-run-setup)), then add your store details in **Settings**.

---

## 📜 Available Scripts

| Command (npm) | Command (yarn) | Description |
| :--- | :--- | :--- |
| `npm run electron` | `yarn electron` | Starts the app in development mode with nodemon hot-reloading |
| `npm run package-win` | `yarn package-win` | Builds a production package for Windows |
| `npm run package-win:nsis`| `yarn package-win:nsis`| Builds a Windows NSIS installer (`.exe`) |
| `npm run package-win:zip` | `yarn package-win:zip` | Packages a portable Windows `.zip` archive |
| `npm run dist:mac` | `yarn dist:mac` | Packages a universal distribution for macOS |
| `npm run dist:linux` | `yarn dist:linux` | Packages an installer/executable for Linux |
| `npm run electron-build` | `yarn electron-build`| Runs electron-builder with default configuration |

### Building & Packaging

The version number comes from `package.json` (currently **1.0.1**). To build the Windows installer and portable zip:

```bash
npx electron-builder --win --publish never
```

Output (in `dist/`):

| File | Purpose |
| :--- | :--- |
| `Nexora Setup <version>.exe` | One-click installer (installs for the current user) |
| `Nexora-<version>-win.zip` | Portable version: unzip and run `Nexora.exe` |
| `latest.yml`, `*.blockmap` | Used by the auto-updater |

Notes:
- The packaging settings are in the `build` section of `package.json`. They take priority over `electron-builder.yml`.
- Local data folders (`server/`, `UsersmusthAppDataRoaming/`), screenshots and editor settings are excluded, so no databases or user accounts are packed into the installer.
- When uploading a release to GitHub by hand, name the installer `Nexora-Setup-<version>.exe` (with dashes) to match `latest.yml`, so auto-updates can find it.

---

## 📂 Project Architecture

```
Nexora/
├── api/                    # Express REST API endpoints (backend)
│   ├── categories.js       # Category management API
│   ├── customers.js        # Customer registry API
│   ├── expenses.js         # Expenses & expense types API
│   ├── inventory.js        # Product catalog & stock API
│   ├── settings.js         # App store info & receipt preferences API
│   ├── transactions.js     # Sales, orders & reporting API
│   └── users.js            # User accounts, login, permissions & first-run setup API
├── assets/                 # Frontend assets
│   ├── css/                # Bootstrap & custom styling
│   ├── images/             # Logos, icons, and badges
│   ├── js/                 # pos.js (core POS controller) & plugins
│   └── plugins/            # DataTables, DateRangePicker, Chosen, etc.
├── lib/
│   └── dataConfig.js       # Data location and pending database-reset helpers
├── screenshots/            # UI preview captures
├── index.html              # Main application window layout
├── server.js               # Express server entry point (PORT 8001)
├── start.js                # Electron main process: window, backup / restore / reset
└── package.json            # Dependencies, build configs, and scripts
```

---

## 💾 Data Storage & Backups

By default, NEXORA stores databases and media uploads locally under:
- **Default Path**: `<UserHome>/Nexora/POS/` (or `%APPDATA%/POS` on Windows)
  - `server/databases/*.db`: Lightweight NeDB files (`inventory.db`, `users.db`, `customers.db`, `categories.db`, `transactions.db`, `settings.db`, `returns.db`, `credit_payments.db`, `customer_advances.db`, `product_history.db`, `expenses.db`, `expense_types.db`).
  - `uploads/`: Uploaded product pictures and company receipt logos.
- **Application Logs**: Saved under `<userData>/nexora.log`.

### Backup and Restore
You can access the built-in backup tools directly from the app interface:
- **Backup**: Exports an exact snapshot of your databases and uploaded media into a timestamped directory (e.g. `Nexora-Backup-YYYY-MM-DD/`).
- **Restore**: Restores a previously created backup folder with database validation.
- **Change Storage Location**: Move your datastore root directory to another disk drive or a shared network folder.

### Reset Database
**Settings > Reset Database** wipes the shop's data so you can start fresh, for example after training or testing:

| Cleared | Kept |
| :--- | :--- |
| Sales & transactions (invoices, returns, credit payments, customer advances) | **User accounts** (usernames, passwords and permissions) |
| Customers | |
| Expenses and expense types | |
| Products, categories, stock and product history | |
| Store settings (store name, receipt details, tax, logo) | |
| Uploaded images | |

How it works:
1. Type `RESET` to confirm.
2. A full backup is saved first to `<DataLocation>/Nexora-Backups/Nexora-Backup-Before-Reset-<date>/`.
3. The app restarts and clears the data during start-up, before the databases are opened.

> [!TIP]
> A reset can be undone with **Restore Data**: choose the `Nexora-Backup-Before-Reset-...` folder.

---

## 🖼️ Screenshots

<div align="center">

| Point of Sale (POS) | Products & Inventory |
| :---: | :---: |
| <img src="screenshots/nexora_pos.png" width="420" alt="POS Screen"/> | <img src="screenshots/nexora_products.png" width="420" alt="Products Inventory"/> |

| Payment Processing | User Permissions |
| :---: | :---: |
| <img src="screenshots/nexora_payment.png" width="420" alt="Payment Processing"/> | <img src="screenshots/nexora_permissions.png" width="420" alt="User Permissions"/> |

| Sales Analytics & Graphs | Receipts & Print Preview |
| :---: | :---: |
| <img src="screenshots/graph.png" width="420" alt="Sales Graph"/> | <img src="screenshots/nexora_print.png" width="420" alt="Print Preview"/> |

</div>

---

## ❓ Troubleshooting & FAQs

### 1. `yarn : The term 'yarn' is not recognized...`
If you do not have Yarn installed, **you do not need it**. Simply use standard `npm` commands:
```bash
npm install
npm run electron
```
*(If you specifically want Yarn, install it globally using `npm install -g yarn`)*.

### 2. `Lock file can not be created! Error code: 32`
Electron enforces a single-instance lock to prevent multiple instances from opening simultaneously and colliding on port `8001`.
- **Cause**: An instance of NEXORA is already running in the background or did not exit completely.
- **Solution**:
  - Close any currently open NEXORA POS windows.
  - On Windows, check Task Manager and end any remaining `electron.exe` or `node.exe` processes related to NEXORA.
  - Re-run `npm run electron`.

### 3. `Error: listen EADDRINUSE: address already in use :::8001`
- The background Express server utilizes port `8001`.
- Ensure no other process is bound to port `8001`. You can free the port in PowerShell:
  ```powershell
  Get-Process -Id (Get-NetTCPConnection -LocalPort 8001).OwningProcess | Stop-Process -Force
  ```

### 4. The Welcome (setup) screen appears on a machine that already had data
The setup screen only shows when the app finds **no user accounts** in its data folder.
- **Cause**: The data folder is empty or has changed, for example after a new Windows user profile, a deleted `POS` folder, or a data location that points to another drive that isn't connected.
- **Solution**: Reconnect the drive or folder and restart the app. To bring back a backup instead, complete the setup, then use **Settings > Restore Data** and pick the backup folder.

### 5. Build fails with `Device or resource busy` / `EBUSY`
A file in the build output folder is locked, often by OneDrive sync or antivirus when the project is inside a OneDrive folder.
- Build into a fresh folder:
  ```bash
  npx electron-builder --win --publish never --config.directories.output=dist-1.0.1
  ```
- Or pause OneDrive sync, restart the PC, and delete the old `dist/` folder.

---

## 🤝 Contributing

Contributions are welcomed! Follow these steps to contribute:

1. **Fork** the repository on GitHub.
2. **Create a branch** for your feature or bug fix:
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Commit** your changes with clear messages:
   ```bash
   git commit -m "Add: Amazing new checkout feature"
   ```
4. **Push** to your fork:
   ```bash
   git push origin feature/amazing-feature
   ```
5. **Open a Pull Request (PR)** against the main repository.

---

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See the [AGPL v3.0 License](https://www.gnu.org/licenses/agpl-3.0.html) for full details.

---

<div align="center">
  Developed with ❤️ by <b>Mohamed Musthaque</b>
</div>
