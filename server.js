const path = require("node:path");
const { spawn } = require("node:child_process");

const backendDirectory = path.join(__dirname, "backend");
const backendProcess = spawn(process.execPath, ["server.js"], {
  cwd: backendDirectory,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!backendProcess.killed) {
      backendProcess.kill(signal);
    }
  });
}

backendProcess.on("error", (error) => {
  console.error(`Failed to start backend server: ${error.message}`);
  process.exitCode = 1;
});

backendProcess.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
