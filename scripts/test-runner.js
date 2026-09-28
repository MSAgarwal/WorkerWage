/**
 * Isolated Automated Test Runner for WorkerWage
 * Enforces 100% test isolation:
 * 1. Uses a dedicated, isolated test port (5099) so it never touches a live production server.
 * 2. Uses an ephemeral test database (test_attendance.db) so it never touches production data.
 * 3. Injects isolated test credentials (TEST_ADMIN_PIN & TEST_JWT_SECRET).
 * 4. Automatically tears down the test server and cleans up the test database files on exit.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const TEST_PORT = parseInt(process.env.TEST_PORT, 10) || 5099;
const TEST_DB = path.join(__dirname, '..', 'test_attendance.db');
const TEST_ADMIN_PIN = 'test-pin-9876';
const TEST_JWT_SECRET = 'test-jwt-secret-isolated-automated-runner-987654321';

function cleanupTestDb() {
  const files = [
    TEST_DB,
    `${TEST_DB}-shm`,
    `${TEST_DB}-wal`
  ];
  for (const f of files) {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch (e) {
        // ignore busy/locked cleanup on windows
      }
    }
  }
}

function checkServerReady(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(port, maxRetries = 50, delayMs = 250) {
  for (let i = 0; i < maxRetries; i++) {
    const ready = await checkServerReady(port);
    if (ready) return true;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

async function main() {
  cleanupTestDb();

  console.log(`🚀 Launching isolated test server on port ${TEST_PORT} with database ${path.basename(TEST_DB)}...`);

  const serverEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(TEST_PORT),
    DB_PATH: TEST_DB,
    DEFAULT_ADMIN_PIN: TEST_ADMIN_PIN,
    JWT_SECRET: TEST_JWT_SECRET
  };

  let serverOutput = '';
  let serverExitedPrematurely = false;

  const serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: serverEnv
  });

  serverProcess.stdout.on('data', (d) => {
    serverOutput += d.toString();
  });
  serverProcess.stderr.on('data', (d) => {
    serverOutput += d.toString();
    const err = d.toString();
    if (!err.includes('ExperimentalWarning: SQLite')) {
      process.stderr.write(d);
    }
  });

  serverProcess.on('exit', (code) => {
    serverExitedPrematurely = true;
    if (code !== 0 && code !== null) {
      console.error(`\n❌ Server process exited prematurely with code ${code}:\n${serverOutput}`);
    }
  });

  const ready = await waitForServer(TEST_PORT);
  if (!ready || serverExitedPrematurely) {
    console.error(`❌ Failed to start isolated test server on port ${TEST_PORT} within timeout.`);
    if (serverOutput) {
      console.error(`Server Output:\n${serverOutput}`);
    }
    if (serverProcess) serverProcess.kill();
    cleanupTestDb();
    process.exit(1);
  }

  console.log(`✅ Isolated test server ready on port ${TEST_PORT}.\n`);
  console.log('🧪 Executing automated test suite...\n');

  const testProcess = spawn(process.execPath, ['--test', '--test-reporter=spec', 'tests/**/*.test.js'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: serverEnv
  });

  testProcess.on('exit', (code) => {
    console.log('\n🛑 Shutting down isolated test server and cleaning up test database...');
    serverProcess.kill();
    setTimeout(() => {
      cleanupTestDb();
      process.exit(code || 0);
    }, 500);
  });
}

main().catch(err => {
  console.error('Test runner fatal error:', err);
  cleanupTestDb();
  process.exit(1);
});
