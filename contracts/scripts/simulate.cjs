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
  const start = Date.now(),
    startBlock = await provider.getBlockNumber(),
    users = [],
    operations = [];
  let seed = 2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 1; i <= 20; i++) {
    const s = await provider.getSigner(i),
      address = await s.getAddress();
    const tokens = config.tokens
      .slice(0, 2)
      .map((t) => contract("TestToken", t.address, s));
    for (const t of tokens) {
      if ((await t.balanceOf(address)) < E("10000"))
        await (await t.faucet()).wait();
      for (const d of config.exchanges)
        await (await t.approve(d.address, ethers.MaxUint256)).wait();
    }
    users.push({
      index: i,
      address,
      eth: F(await provider.getBalance(address)),
    });
  }
  const before = await Promise.all(
    config.exchanges.map((d) => snapshot(contract("MiniDEX", d.address))),
  );
  for (let round = 0; round < 4; round++)
    for (let i = 1; i <= 20; i++) {
      const s = await provider.getSigner(i),
        exchange = Math.floor(random() * 2),
        d = contract("MiniDEX", config.exchanges[exchange].address, s),
        p = await d.pools(1),
        dl = await deadline();
      let tx, kind;
      if (round === 0 || round === 3) {
        const token = config.tokens[Math.floor(random() * 2)].address;
        tx = await d.swap(
          1,
          token,
          E(String(10 + Math.floor(random() * 100))),
          0,
          dl,
        );
        kind = "swap";
      } else if (round === 1) {
        const amount = E(String(20 + Math.floor(random() * 80)));
        tx = await d.addLiquidity(1, amount, amount, 0, 0, dl);
        kind = "add";
      } else {
        const owned = await d.nextPositionId();
        let id;
        for (let n = 2n; n < owned; n++) {
          try {
            if (
              (await d.ownerOf(n)).toLowerCase() ===
              (await s.getAddress()).toLowerCase()
            ) {
              id = n;
              break;
            }
          } catch {}
        }
        if (!id) {
          const other = 1 - exchange;
          const od = contract("MiniDEX", config.exchanges[other].address, s);
          const max = await od.nextPositionId();
          for (let n = 2n; n < max; n++) {
            try {
              if (
                (await od.ownerOf(n)).toLowerCase() ===
                (await s.getAddress()).toLowerCase()
              ) {
                id = n;
                break;
              }
            } catch {}
          }
          if (!id) throw Error("Missing position");
          tx = await od.removeLiquidity(id, 0, 0, dl);
          kind = "remove";
          const r = await tx.wait();
          operations.push({
            round,
            user: i,
            address: await s.getAddress(),
            exchange: other,
            kind,
            hash: tx.hash,
            block: r.blockNumber,
            status: r.status,
          });
          continue;
        }
        tx = await d.removeLiquidity(id, 0, 0, dl);
        kind = "remove";
      }
      const receipt = await tx.wait();
      operations.push({
        round,
        user: i,
        address: await s.getAddress(),
        exchange,
        kind,
        hash: tx.hash,
        block: receipt.blockNumber,
        status: receipt.status,
      });
      await new Promise((r) => setTimeout(r, 250));
    }
  const after = await Promise.all(
    config.exchanges.map((d) => snapshot(contract("MiniDEX", d.address))),
  );
  const report = {
    seed: 2026,
    users,
    rounds: 4,
    startBlock,
    endBlock: await provider.getBlockNumber(),
    durationSeconds: (Date.now() - start) / 1000,
    counts: {
      users: 20,
      swap: operations.filter((x) => x.kind === "swap").length,
      add: operations.filter((x) => x.kind === "add").length,
      remove: operations.filter((x) => x.kind === "remove").length,
      failed: operations.filter((x) => x.status !== 1).length,
    },
    before,
    after,
    operations,
  };
  await save("simulation.json", report);
  console.log(JSON.stringify(report.counts), report.durationSeconds + "s");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
