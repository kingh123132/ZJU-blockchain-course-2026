const { spawnSync } = require("node:child_process");
const path = require("node:path");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const folder of ["contracts", "frontend"]) {
  const r = spawnSync(npm, ["ci", "--no-audit", "--no-fund"], {
    cwd: path.join(__dirname, "..", folder),
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
    env: {
      ...process.env,
      npm_config_cache: path.join(__dirname, "../.work/npm-cache"),
    },
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
