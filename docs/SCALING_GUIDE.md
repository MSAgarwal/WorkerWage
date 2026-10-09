# WorkerWage v5.0.0 — Scalability & Production Operations Guide

This guide details how to scale the **WorkerWage** Attendance & Payroll Management System to support hundreds or thousands of workers while continuing to run smoothly on your local PC or laptop as a dedicated server.

---

## 1. Architectural Scaling Overview (v5.0.0 Enhancements)

In version **v5.0.0**, the application has been optimized from database engine up to the HTTP transport layer to eliminate bottlenecks and handle high concurrent load:

| Layer | Optimization in v5.0.0 | Performance Benefit |
| :--- | :--- | :--- |
| **Database Engine** | SQLite WAL mode + Memory Page Cache (`-64000` = 64 MB), OS Memory Mapping (`mmap_size = 256 MB`), in-RAM sorting (`temp_store = MEMORY`). | Up to 10,000+ read operations/second without locking writes. Zero disk thrashing. |
| **Query Strategy** | Replaced sequential N+1 worker attendance and payment loops with **constant O(1) batch query hash maps**. | Payroll report generation runs in 3 database queries instead of $(2N + 1)$ queries. |
| **Traffic Defense** | In-memory sliding window rate limiter (`middleware/rate-limit.middleware.js`). | Shields against DoS, runaway polling loops, and brute-force PIN attacks. |
| **Data Safety** | Background automated backup scheduler (`services/backup-scheduler.service.js`). | Flushes WAL and takes atomic `VACUUM INTO` snapshots every 24 hours, retaining 30 days automatically. |
| **Multi-Unit Schema** | Added `department` and `branch` support with covering indexes (`idx_employees_status_name`, `idx_attendance_date_emp`). | Instant filtered queries even as worker rows grow past tens of thousands. |
| **Portability** | Production `Dockerfile` and `docker-compose.yml` with healthchecks. | One-command deployment on any operating system (Windows, Linux, macOS). |

---

## 2. Running on Your Local PC as a 24/7 Production Server

You do **not** need an expensive cloud server. Modern laptops and desktop PCs possess vastly more CPU power and RAM than standard cloud virtual machines.

### A. Prevent Windows from Going to Sleep
To keep the server responsive around the clock:
1. Open **Settings > System > Power & sleep**.
2. Under **Sleep**, set *"When plugged in, PC goes to sleep after"* to **Never**.
3. If using a laptop, open **Control Panel > Hardware and Sound > Power Options > System Settings** and set *"When I close the lid"* to **Do nothing**.

### B. Reserve a Static IP on Your Local Network (Wi-Fi or LAN)
Ensure the server's local IP address (e.g. `192.168.1.100`) doesn't change when your router reboots:
1. Open your router's admin portal (usually `http://192.168.1.1` or `http://192.168.0.1`).
2. Navigate to **DHCP Reservation** or **Static IP Binding**.
3. Assign a fixed IP to your server PC's MAC address.
4. Now, phones and client devices can bookmark the exact same URL permanently.

### C. Allow Port 5000 in Windows Firewall
To allow other devices on your Wi-Fi to reach the server:
1. Run PowerShell as Administrator.
2. Execute:
   ```powershell
   New-NetFirewallRule -DisplayName "WorkerWage Server Port 5000" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow
   ```

---

## 3. Production Process Management with PM2

Running `node server.js` directly in a terminal will shut down if the terminal is closed. **PM2** keeps the server running in the background and automatically restarts it if an error occurs.

### A. Starting with PM2
WorkerWage includes preconfigured PM2 scripts in `package.json`:
```bash
# Start background server
npm run pm2:start

# View real-time logs
npm run pm2:logs

# Restart server
npm run pm2:restart

# Stop server
npm run pm2:stop
```

### B. Starting Automatically When Windows Boots
To start the server automatically whenever your PC turns on:
```bash
npm install -g pm2-windows-service
pm2-service-install
```
*(Select YES for all defaults; PM2 will now run as a native Windows Background Service.)*

---

## 4. Multi-Device LAN & Cloud Tunnel Connectivity

WorkerWage v5 allows employees and managers to interact simultaneously from different devices:

### A. Local Network Access (Phones, Tablets & Office PCs)
1. Ensure devices are connected to the same Wi-Fi or router.
2. Start the server — the terminal will display:
   ```
   💻 LAPTOP ACCESS : http://localhost:5000
   📱 MOBILE ACCESS : http://192.168.1.100:5000
   ```
3. Scan the terminal QR code using phone cameras to open the mobile passbook or admin dashboard instantly.

### B. Secure Internet Access via Cloudflare Tunnel (Zero Port-Forwarding)
To access the server securely from outside your office or home without exposing your home IP or opening router ports:
1. Start the bundled tunnel:
   ```bash
   .\tools\cloudflared.exe tunnel --url http://localhost:5000
   ```
2. Cloudflare will assign a secure HTTPS address (e.g. `https://random-subdomain.trycloudflare.com`).
3. Workers can log in from anywhere in the world to view their passbooks. All traffic is encrypted with SSL.

---

## 5. Scaling Multi-Branch and Department Operations

WorkerWage v5 includes schema columns for multi-unit segregation:
- `department`: Categorizes workers (e.g., `Packaging`, `Assembly`, `Logistics`, `Management`).
- `branch`: Separates physical locations (e.g., `Main Plant`, `Unit 2`, `Warehouse East`).

### Covering Indexes
The database is equipped with composite covering indexes:
- `idx_employees_status_name` on `(status, name)`
- `idx_attendance_date_emp` on `(date, employee_id)`

These indexes allow the database to answer queries directly from the B-tree index in RAM without scanning row tables, guaranteeing sub-millisecond response times even with 100,000+ attendance records.

---

## 6. Container Deployment with Docker

If you prefer deploying in an isolated container or moving the app to another computer or Linux machine:

```bash
# Build and launch WorkerWage in the background
docker-compose up -d

# View container logs
docker-compose logs -f

# Check health status
docker inspect --format='{{json .State.Health}}' workerwage-v5

# Stop container
docker-compose down
```

The database (`attendance.db`) and all automated snapshots (`backups/`) are persisted on the host machine through volume mounts, ensuring zero data loss upon container rebuilds.

---

---

## 7. High-Volume Workforce Bulk Operations (CSV Import & Export)

When scaling your workforce from 10 to 500+ workers, adding them individually is tedious. WorkerWage v5 supports full bulk lifecycle management:

- **Export All Workers**:
  - Web UI: Click **"📥 Export CSV"** on the Workers tab.
  - API: `GET /api/employees/export-csv` generates a standardized CSV with all worker codes, wages, overtime rates, departments, and roles.
- **Atomic Bulk Import**:
  - API: `POST /api/employees/bulk-import` accepts an array of worker records.
  - All inserts and updates run inside an atomic database transaction (`withTransaction`) — guaranteeing zero partial imports or corrupted state if a row contains an error.

---

## 8. Benchmarking Your Local PC Hardware

To test how fast your specific laptop or PC executes high-volume workloads:

```bash
# Run the local concurrency benchmark suite
node scripts/benchmark.js
```

The benchmark spins up an ephemeral database, populates **300 active workers**, writes **9,000 attendance records** (30 full working days), and benchmarks:
1. Worker seed throughput (typically **>75,000 workers/sec**)
2. Attendance insertion throughput (typically **>100,000 records/sec**)
3. Full factory sheet retrieval (typically **<3 ms**)
4. 30-day payroll aggregation across 9,000 rows (typically **<80 ms**)
5. RAM footprint (typically **<65 MB RSS**)

---

## 9. Migration Path to PostgreSQL (Enterprise 50,000+ Workers)

If your organization scales beyond 10,000 daily workers or requires multi-server active-active load balancing:
1. **Service Layer Architecture**: The codebase adheres to strict controller-service-repository separation (`services/attendance.service.js`, `services/payroll.service.js`, `services/employee.service.js`).
2. **Replacing SQLite Client**: Swap `node:sqlite` in `db.js` with `pg` (node-postgres) connection pooling.
3. **Prepared Statements**: All queries in the services layer already use parameter binding (`?` in SQLite, `$1, $2` in Postgres), eliminating SQL injection risks and enabling painless SQL dialect translation.

---

## 10. Automated Backups & Single-Command Disaster Recovery

- **Automated Snapshots**: Located in the `./backups/` directory, generated automatically every 24 hours.
- **Manual Snapshot**: Run `npm run backup` (or `node scripts/backup.js`) at any time to generate an on-demand snapshot.
- **Single-Command Restoration**:
  ```bash
  # Automatically restore the latest snapshot with safety backup:
  npm run restore
  
  # Or specify a specific backup file:
  node scripts/restore.js backups/attendance_backup_2026-10-10.db
  ```
  The restore utility automatically creates a pre-restore backup of the active database, clears auxiliary WAL files, and runs `PRAGMA integrity_check` before confirming readiness.
