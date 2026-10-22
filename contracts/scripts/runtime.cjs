const { ethers } = require("ethers");
const fs = require("node:fs");
const path = require("node:path");
const config = require("../../frontend/src/generated/deployment.json");
const provider = new ethers.JsonRpcProvider(config.rpcUrl);
provider.pollingInterval = 50;
const E = ethers.parseEther,
  F = ethers.formatEther;
function contract(name, address, signer = provider) {
  return new ethers.Contract(address, config.abis[name], signer);
}
async function deadline() {
  return (await provider.getBlock("latest")).timestamp + 3600;
}
async function save(name, data) {
  fs.mkdirSync(path.join(__dirname, "../../docs/results"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "../../docs/results", name),
    JSON.stringify(
      data,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
  fs.mkdirSync(path.join(__dirname, "../../frontend/public/results"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(__dirname, "../../docs/results", name),
    path.join(__dirname, "../../frontend/public/results", name),
  );
}
async function snapshot(dex) {
  const p = await dex.pools(1);
  const aFirst =
    p.tokenA.toLowerCase() === config.tokens[0].address.toLowerCase();
  return {
    reserveCTA: F(aFirst ? p.reserveA : p.reserveB),
    reserveCTB: F(aFirst ? p.reserveB : p.reserveA),
    priceCTBperCTA:
      Number(F(aFirst ? p.reserveB : p.reserveA)) /
      Number(F(aFirst ? p.reserveA : p.reserveB)),
  };
}
module.exports = {
  ethers,
  config,
  provider,
  E,
  F,
  contract,
  deadline,
  save,
  snapshot,
};
