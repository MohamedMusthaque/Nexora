<div align="center">

  <img src="assets/images/Nexora-Logo.png" alt="NEXORA POS Logo" width="220" />

  # NEXORA POS

  **A modern, offline-first Desktop Point of Sale (POS) system built with Electron and Node.js**

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
- [Key Features](#-key-features)
- [Default Login Credentials](#-default-login-credentials)
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

## ✨ Key Features

- **🛒 Point of Sale & Billing**:
  - Fast barcode scanning and manual search by product name or SKU.
  - Category-based product catalog grid for quick touch/mouse selection.
  - Multi-order tabs (open / held orders) for handling simultaneous customer queues.
  - Customer assignment, customizable tax calculation, discounts, and real-time total updates.

- **💳 Multiple Payment Methods**:
  - **Cash**: Automated change calculation.
  - **Card**: Integrated digital card processing (Stripe compatible).
  - **M-Pesa**: Direct mobile money payment support.

- **📦 Inventory & Stock Management**:
  - Comprehensive stock tracking with real-time stock deductions upon sale.
  - Low-stock visual alerts to prevent out-of-stock scenarios.
  - Product image uploads and category organization.
  - Built-in barcode generation (`JsBarcode`) and printable label exports.

- **👥 User Roles & Permissions**:
  - Multi-staff user accounts.
  - Granular permissions: control access to Products, Categories, Transactions, Users, and Settings.
  - Bootstrap Administrator protection to prevent accidental lockouts.

- **🧾 Receipt & Document Printing**:
  - Thermal receipt printing via standard system print dialog or `print-js`.
  - Customizable receipt headers, footers, store contact details, tax ID, and store logos.
  - PDF export for customer invoices and barcode labels.

- **📊 Sales Analytics & Reporting**:
  - Filter transactions by till, cashier, date range, or payment status.
  - Interactive sales performance graphs and charts.
  - One-click export of sales records to Excel (`.xlsx`).

- **🌐 Multi-Till Network Support**:
  - Run the central database server on a main host PC (`PORT 8001`).
  - Connect auxiliary cashier tills over the local network to share products, customers, and live inventory.

- **💾 Data Reliability & Backup**:
  - Embedded NoSQL datastores (NeDB) requiring no complex database installations.
  - One-click database backup to timestamped folders.
  - Full restore capability and custom data storage path selector.

---

## 🔐 Default Login Credentials

Upon fresh installation or first launch, an initial Administrator account is automatically initialized:

| Role | Username | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin` | `admin` | Full Access (All modules) |

> [!IMPORTANT]
> Change the default administrator password in **Settings > Users** immediately after your first login for production deployments.

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

---

## 📂 Project Architecture

```
Nexora/
├── api/                    # Express REST API endpoints (backend)
│   ├── categories.js       # Category management API
│   ├── customers.js        # Customer registry API
│   ├── inventory.js        # Product catalog & stock API
│   ├── settings.js         # App store info & receipt preferences API
│   ├── transactions.js     # Sales, orders & reporting API
│   └── users.js            # User authentication & permissions API
├── assets/                 # Frontend assets
│   ├── css/                # Bootstrap & custom styling
│   ├── images/             # Logos, icons, and badges
│   ├── js/                 # pos.js (core POS controller) & plugins
│   └── plugins/            # DataTables, DateRangePicker, Chosen, etc.
├── lib/
│   └── dataConfig.js       # Data location, backup, and restore helpers
├── screenshots/            # UI preview captures
├── index.html              # Main application window layout
├── server.js               # Express server entry point (PORT 8001)
├── start.js                # Electron main process & window lifecycle
└── package.json            # Dependencies, build configs, and scripts
```

---

## 💾 Data Storage & Backups

By default, NEXORA stores databases and media uploads locally under:
- **Default Path**: `<UserHome>/Nexora/POS/` (or `%APPDATA%/POS` on Windows)
  - `server/databases/*.db`: Lightweight NeDB files (`inventory.db`, `users.db`, `customers.db`, `categories.db`, `transactions.db`, `settings.db`).
  - `uploads/`: Uploaded product pictures and company receipt logos.
- **Application Logs**: Saved under `<userData>/nexora.log`.

### Backup and Restore
You can access the built-in backup tools directly from the app interface:
- **Backup**: Exports an exact snapshot of your databases and uploaded media into a timestamped directory (e.g. `Nexora-Backup-YYYY-MM-DD/`).
- **Restore**: Restores a previously created backup folder with database validation.
- **Change Storage Location**: Move your datastore root directory to another disk drive or a shared network folder.

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
