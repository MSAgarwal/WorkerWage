# ⏱️ Daily Wage Employee Attendance & Overtime Tracker

A full-stack, mobile-accessible employee attendance and payroll management system designed for **Employers / Admins**. 

Your **laptop serves as the central server and database engine**, allowing you to open and mark attendance directly from your **mobile phone** on-site or from your **laptop's browser**.

---

## 🌟 Key Features

- **📱 Mobile-First Access**:
  - Open the web application on any mobile phone (iPhone / Android) over your local Wi-Fi or Mobile Hotspot.
  - Scan the dynamic QR code displayed on the laptop or console to connect in seconds.
  - Can be added to your phone's Home Screen like a native app (PWA).

- **🔐 Employer / Admin Exclusive Access**:
  - Protected by an Admin PIN lock (Default PIN: `1234`).
  - Employees have **no access** — only you as the employer can view wages, record attendance, and manage payouts.

- **💰 Daily Wage & Overtime Calculations**:
  - **Daily Wage Base**: Full day (1.0x daily wage) and Half day (0.5x daily wage).
  - **Overtime Tracking**: Dedicated stepper to log OT hours (+0.5h, +1.0h, etc.).
  - **1.5x and 2.0x Multipliers**: Toggle between `1.5x` (time-and-a-half) and `2.0x` (double time) overtime rates with a single tap.
  - **Automatic Hourly Conversion**: Hourly rate = `Daily Wage ÷ Standard Working Hours` (e.g. `₹800 ÷ 8 = ₹100/hr`).
  - **Overtime Formula**: `OT Pay = OT Hours × Hourly Rate × Overtime Multiplier`.

- **⚡ Fast On-Site Attendance**:
  - "⚡ Mark All Present" button records the entire active crew in one tap.
  - Easily adjust individual workers who left early (Half Day) or worked late (Overtime).
  - Live earning calculation updates dynamically per worker as you type.

- **💵 Advances & Draw Tracking**:
  - Record cash advances or weekly wage draws given to workers.
  - Automatically deducted from total gross earnings to calculate exact **Net Balance Due**.

- **📊 Comprehensive Payroll Reports & Export**:
  - View gross earnings, total OT hours (split by 1.5x vs 2.0x), advances, and net liability.
  - Filter by This Month, This Week, Last Month, or Custom Date Range.
  - **Export to CSV / Excel** and clean printable summary.

- **💾 Local SQLite Database on Laptop**:
  - All data is securely stored locally in `attendance.db` on your laptop.
  - No internet connection required when using local Wi-Fi or phone hotspot.
  - One-click database backup download from Settings.

---

## 🚀 Quick Start (Running on Your Laptop)

### Option 1: Double-Click Launcher (Windows)
Double-click the **`Start-Server.bat`** file in this folder. It will:
1. Start the Node.js server.
2. Automatically open your browser to `http://localhost:5000`.
3. Display the mobile connection address and QR code in the console.

### Option 2: Command Line
Open PowerShell or Command Prompt in this directory:
```bash
npm start
```
or
```bash
node server.js
```

---

## 📱 How to Connect Your Mobile Phone

1. **Connect to the same network**:
   - Make sure your mobile phone and your laptop are connected to the same **Wi-Fi network**.
   - *No Wi-Fi at the work site?* Turn on your phone's **Personal Hotspot**, and connect your laptop to your phone's hotspot!
2. **Open the App on Mobile**:
   - In your laptop browser, click the **"📱 Connect Phone"** button in the top bar to view your QR code.
   - Point your phone's camera at the QR code and tap the link (e.g. `http://192.168.1.8:5000`).
3. **Unlock**:
   - Enter your Admin PIN (Default: `1234`).
4. **Tip for Quick Access**:
   - In Safari (iOS): Tap the Share button ➔ **"Add to Home Screen"**.
   - In Chrome (Android): Tap the three dots ➔ **"Add to Home screen"**.

---

## 🧮 Wage & Overtime Calculation Example

| Worker | Daily Wage | Std Hours | Hourly Rate | Status | OT Hours | OT Multiplier | Base Pay | OT Pay | Total Day Earning |
|---|---|---|---|---|---|---|---|---|---|
| **Ramesh Kumar** | ₹750 | 8 hrs | ₹93.75 | Present | 2.0 hrs | **1.5x** | ₹750.00 | ₹281.25 | **₹1,031.25** |
| **Rajesh Sharma** | ₹800 | 8 hrs | ₹100.00 | Present | 3.0 hrs | **2.0x** | ₹800.00 | ₹600.00 | **₹1,400.00** |
| **Amit Patel** | ₹500 | 8 hrs | ₹62.50 | Half Day | 0.0 hrs | 1.5x | ₹250.00 | ₹0.00 | **₹250.00** |

---

## 📁 Project Structure

```
Employee Attendance/
├── Start-Server.bat       # 1-click Windows launcher (starts server + opens browser)
├── server.js              # Express REST API, network IP discovery & QR generation
├── db.js                  # SQLite database engine, schema initialization & sample data
├── package.json           # Dependencies and startup scripts
├── attendance.db          # Local SQLite database file (created automatically)
└── public/                # Mobile-first responsive web client
    ├── index.html         # Single Page Application
    ├── css/
    │   └── style.css      # Responsive touch-optimized styling
    ├── js/
    │   ├── api.js         # Backend communication & formatting
    │   ├── attendance.js  # Daily attendance sheet, quick-mark & live OT
    │   ├── employees.js   # Workforce management & wage rate configuration
    │   ├── payroll.js     # Wage calculation, summaries & CSV export
    │   ├── payments.js    # Advances & wage draws tracker
    │   └── app.js         # Navigation, PIN lock & mobile QR modal
    └── manifest.json      # PWA metadata for mobile home screen
```

---

## 🔒 Security & Admin PIN

- The default Admin PIN is **`1234`**.
- You can change the PIN at any time by going to **Settings ➔ Admin Security PIN**.
- You can manually lock the app at any time by tapping the **Lock** button in the header.
