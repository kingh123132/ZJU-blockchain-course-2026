const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");
async function main() {
  const { ethers } = hre;
  const [owner] = await ethers.getSigners();
  const a = await ethers.deployContract("TestToken", ["Campus Token A", "CTA"]);
  const b = await ethers.deployContract("TestToken", ["Campus Token B", "CTB"]);
  const weth = await ethers.deployContract("WrappedETH");
  const east = await ethers.deployContract("MiniDEX", ["East Exchange LP"]);
  const west = await ethers.deployContract("MiniDEX", ["West Exchange LP"]);
  const arb = await ethers.deployContract("AtomicArbitrage");
  for (const c of [a, b, weth, east, west, arb]) await c.waitForDeployment();
  for (const t of [a, b]) await (await t.faucet()).wait();
  await (await weth.deposit({ value: ethers.parseEther("100") })).wait();
  const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
  for (const dex of [east, west]) {
    for (const t of [a, b, weth])
      await (await t.approve(dex.target, ethers.MaxUint256)).wait();
    await (await dex.createPool(a.target, b.target)).wait();
    const p = await dex.pools(1);
    const amountA = ethers.parseEther("10000");
    const amountB = ethers.parseEther(dex === east ? "10000" : "14000");
    const amounts =
      p.tokenA.toLowerCase() === a.target.toLowerCase()
        ? [amountA, amountB]
        : [amountB, amountA];
    await (await dex.addLiquidity(1, ...amounts, 0, 0, deadline)).wait();
  }
  await (await east.createPool(a.target, weth.target)).wait();
  const p = await east.pools(2);
  const amounts =
    p.tokenA.toLowerCase() === a.target.toLowerCase()
      ? [ethers.parseEther("10000"), ethers.parseEther("50")]
      : [ethers.parseEther("50"), ethers.parseEther("10000")];
  await (await east.addLiquidity(2, ...amounts, 0, 0, deadline)).wait();
  const config = {
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    tokens: [
      { symbol: "CTA", address: a.target },
      { symbol: "CTB", address: b.target },
      { symbol: "WETH", address: weth.target },
    ],
    exchanges: [
      { name: "东池 East", address: east.target },
      { name: "西池 West", address: west.target },
    ],
    arbitrage: arb.target,
    abis: {},
  };
  for (const name of ["MiniDEX", "TestToken", "WrappedETH", "AtomicArbitrage"])
    config.abis[name] = (await hre.artifacts.readArtifact(name)).abi;
  fs.mkdirSync(path.join(__dirname, "../../frontend/src/generated"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(__dirname, "../../frontend/src/generated/deployment.json"),
    JSON.stringify(config, null, 2),
  );
  fs.mkdirSync(path.join(__dirname, "../../docs/results"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "../../docs/results/deployment.json"),
    JSON.stringify(
      {
        chainId: 31337,
        deployer: owner.address,
        tokens: config.tokens,
        exchanges: config.exchanges,
        arbitrage: arb.target,
      },
      null,
      2,
    ),
  );
  console.log("Local deployment ready", config.exchanges);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
