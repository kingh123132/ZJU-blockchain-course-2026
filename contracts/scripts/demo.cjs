const {
  config,
  provider,
  E,
  F,
  contract,
  deadline,
  save,
  snapshot,
  ethers,
} = require("./runtime.cjs");
async function main() {
  const s = await provider.getSigner(21),
    address = await s.getAddress(),
    b = contract("TestToken", config.tokens[1].address, s),
    a = contract("TestToken", config.tokens[0].address, s),
    dex = config.exchanges.map((d) => contract("MiniDEX", d.address, s)),
    arb = contract("AtomicArbitrage", config.arbitrage, s);
  await (await b.faucet()).wait();
  await (await b.approve(arb.target, ethers.MaxUint256)).wait();
  const before = await Promise.all(dex.map(snapshot)),
    input = E("100");
  const options = [];
  for (const [buy, sell] of [
    [0, 1],
    [1, 0],
  ]) {
    const middle = await dex[buy].quote(1, b.target, input),
      out = await dex[sell].quote(1, a.target, middle);
    options.push({ buy, sell, middle, out });
  }
  const best = options.sort((x, y) => (x.out > y.out ? -1 : 1))[0];
  if (best.out <= input) throw Error("No profitable opportunity");
  const balanceBefore = await b.balanceOf(address),
    tx = await arb.execute(
      dex[best.buy].target,
      1,
      dex[best.sell].target,
      1,
      b.target,
      input,
      1,
      await deadline(),
    ),
    r = await tx.wait(),
    balanceAfter = await b.balanceOf(address),
    after = await Promise.all(dex.map(snapshot));
  const success = {
    address,
    hash: tx.hash,
    block: r.blockNumber,
    status: r.status,
    inputCTB: F(input),
    intermediateCTA: F(best.middle),
    outputCTB: F(best.out),
    profitCTB: F(balanceAfter - balanceBefore),
    buy: best.buy,
    sell: best.sell,
    balanceBeforeCTB: F(balanceBefore),
    balanceAfterCTB: F(balanceAfter),
    before,
    after,
    gasUsed: r.gasUsed.toString(),
  };
  const beforeFailure = await Promise.all(dex.map(snapshot)),
    beforeBalance = await b.balanceOf(address);
  let failure;
  try {
    const tx = await arb.execute(
      dex[best.buy].target,
      1,
      dex[best.sell].target,
      1,
      b.target,
      input,
      E("1000"),
      await deadline(),
      { gasLimit: 1500000 },
    );
    await tx.wait();
    throw Error("Expected revert");
  } catch (e) {
    const hash =
      e.receipt?.hash ||
      e.transactionHash ||
      e.data?.txHash ||
      e.error?.data?.txHash ||
      e.info?.error?.data?.txHash;
    const receipt =
      e.receipt || (hash ? await provider.getTransactionReceipt(hash) : null);
    if (!receipt || receipt.status !== 0) throw e;
    const afterFailure = await Promise.all(dex.map(snapshot));
    failure = {
      expectedRevert: true,
      reason: "兑换输出不足以覆盖本金和最低利润",
      receiptHash: receipt.hash,
      block: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      before: beforeFailure,
      after: afterFailure,
      poolsUnchanged:
        JSON.stringify(beforeFailure) === JSON.stringify(afterFailure),
      balanceUnchanged: beforeBalance === (await b.balanceOf(address)),
    };
    if (!failure.poolsUnchanged || !failure.balanceUnchanged)
      throw Error("Rollback failed");
  }
  await save("arbitrage.json", { success, failure });
  console.log(
    JSON.stringify({
      profitCTB: success.profitCTB,
      hash: success.hash,
      rollback: failure.poolsUnchanged,
    }),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
