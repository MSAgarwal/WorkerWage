/**
 * Autonomous Test Runner for WorkerWage
 * Automatically manages server lifecycle during test execution:
 * 1. Checks if server is already running on port 5000.
 * 2. If not running, launches server in background and waits for /api/health.
 * 3. Runs unit & integration test suites.
 * 4. Gracefully shuts down spawned server.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

function checkServerReady(port = 5000) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(port = 5000, maxRetries = 20, delayMs = 300) {
  for (let i = 0; i < maxRetries; i++) {
    const ready = await checkServerReady(port);
    if (ready) return true;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

async function main() {
  const isAlreadyRunning = await checkServerReady(5000);
  let serverProcess = null;

  if (isAlreadyRunning) {
    console.log('📡 Connected to already running WorkerWage server on port 5000.');
  } else {
    console.log('🚀 Spawning WorkerWage server for test suite...');
    serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '5000' }
    });

    serverProcess.stdout.on('data', () => {});
    serverProcess.stderr.on('data', (d) => {
      const err = d.toString();
      if (!err.includes('ExperimentalWarning: SQLite')) {
        process.stderr.write(d);
      }
    });

    const ready = await waitForServer(5000);
    if (!ready) {
      console.error('❌ Failed to start WorkerWage server on port 5000 within timeout.');
      if (serverProcess) serverProcess.kill();
      process.exit(1);
    }
    console.log('✅ WorkerWage server is healthy and ready on port 5000.');
  }

  // Run native Node.js test runner
  console.log('🧪 Executing automated test suite...\n');
  const testProcess = spawn(process.execPath, ['--test', 'tests/**/*.test.js'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });

  testProcess.on('exit', (code) => {
    if (serverProcess) {
      console.log('\n🛑 Shutting down spawned test server...');
      serverProcess.kill();
    }
    process.exit(code || 0);
  });
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
