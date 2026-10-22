const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path"),
  net = require("node:net"),
  fs = require("node:fs");
const root = path.join(__dirname, ".."),
  owned = [];
const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
const run = (entry, args, cwd) => {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  owned.push(child);
  return child;
};
const hardhat = path.join(
  root,
  "contracts/node_modules/hardhat/internal/cli/cli.js",
);
async function main() {
  for (const folder of ["contracts", "frontend"])
    if (!fs.existsSync(path.join(root, folder, "node_modules")))
      throw Error("请先运行 npm run setup 安装依赖");
  if (!(await portOpen(8545))) {
    run(
      hardhat,
      ["node", "--hostname", "127.0.0.1"],
      path.join(root, "contracts"),
    );
    for (let i = 0; !(await portOpen(8545)); i++) {
      if (i > 60) throw Error("区块链启动超时");
      await new Promise((r) => setTimeout(r, 500));
    }
    const deploy = spawnSync(
      process.execPath,
      [hardhat, "run", "scripts/deploy.cjs", "--network", "localhost"],
      {
        cwd: path.join(root, "contracts"),
        stdio: "inherit",
        windowsHide: true,
      },
    );
    if (deploy.status !== 0) throw Error("合约部署失败");
  } else {
    const { ethers } = require(
      path.join(root, "contracts/node_modules/ethers"),
    );
    const config = require(
      path.join(root, "frontend/src/generated/deployment.json"),
    );
    const rpc = new ethers.JsonRpcProvider(config.rpcUrl);
    if ((await rpc.getCode(config.arbitrage)) === "0x")
      throw Error(
        "8545 端口已被使用，但未找到本项目合约。请检查节点，或在 contracts 中运行 npm run deploy。",
      );
    console.log("复用 127.0.0.1:8545 上已部署的本地合约。");
  }
  if (await portOpen(3000)) {
    console.log("前端已运行：http://127.0.0.1:3000");
    return;
  }
  run(
    path.join(root, "frontend/node_modules/vite/bin/vite.js"),
    ["--host", "127.0.0.1"],
    path.join(root, "frontend"),
  );
  console.log("打开 http://127.0.0.1:3000；按 Ctrl+C 停止本次启动的进程。");
}
function cleanup(code = 0) {
  for (const p of owned) p.kill();
  process.exit(code);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
main().catch((e) => {
  console.error(e.message);
  cleanup(1);
});
