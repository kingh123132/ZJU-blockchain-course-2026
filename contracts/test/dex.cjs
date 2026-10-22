const { expect } = require("chai");
const { ethers } = require("hardhat");
const E = ethers.parseEther;
describe("Tidal DEX", function () {
  let a, b, d1, d2, arb, owner, other, deadline;
  beforeEach(async () => {
    [owner, other] = await ethers.getSigners();
    deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    a = await ethers.deployContract("TestToken", ["A", "A"]);
    b = await ethers.deployContract("TestToken", ["B", "B"]);
    d1 = await ethers.deployContract("MiniDEX", ["East"]);
    d2 = await ethers.deployContract("MiniDEX", ["West"]);
    arb = await ethers.deployContract("AtomicArbitrage");
    for (const u of [owner, other])
      for (const t of [a, b]) {
        await t.connect(u).faucet();
        for (const d of [d1, d2, arb])
          await t.connect(u).approve(d.target, ethers.MaxUint256);
      }
    for (const d of [d1, d2]) {
      await d.createPool(a.target, b.target);
      const p = await d.pools(1);
      const bs = d === d1 ? "10000" : "14000";
      const v =
        p.tokenA === a.target ? [E("10000"), E(bs)] : [E(bs), E("10000")];
      await d.addLiquidity(1, ...v, 0, 0, deadline);
    }
  });
  it("separate faucet per user, with rate limit", async () => {
    expect(await a.balanceOf(other.address)).eq(E("100000"));
    await expect(a.faucet()).revertedWith("Wait 60 seconds");
  });
  it("normalizes pairs and rejects invalid or duplicate pools", async () => {
    await expect(d1.createPool(b.target, a.target)).revertedWith("Pair exists");
    await expect(d1.createPool(a.target, a.target)).revertedWith(
      "Invalid pair",
    );
    await expect(d1.createPool(a.target, other.address)).revertedWith(
      "Not contracts",
    );
  });
  it("fee-inclusive quote, reserve accounting and non-decreasing k", async () => {
    const p = await d1.pools(1),
      q = await d1.quote(1, p.tokenA, E("100"));
    const expected =
      (E("100") * 9970n * p.reserveB) /
      (p.reserveA * 10000n + E("100") * 9970n);
    expect(q).eq(expected);
    await d1.swap(1, p.tokenA, E("100"), q, deadline);
    const after = await d1.pools(1);
    expect(after.reserveA * after.reserveB).gte(p.reserveA * p.reserveB);
    expect(after.feesA).eq(E("0.3"));
    expect(
      await new ethers.Contract(p.tokenA, a.interface, owner).balanceOf(
        d1.target,
      ),
    ).eq(after.reserveA);
  });
  it("mints metadata, returns proportional amounts, burns NFT and prevents double withdrawal", async () => {
    await d1
      .connect(other)
      .addLiquidity(1, E("100"), E("100"), E("100"), E("100"), deadline);
    expect(await d1.ownerOf(2)).eq(other.address);
    const pos = await d1.positions(2);
    expect(pos.provider).eq(other.address);
    expect(await d1.tokenURI(2)).contains("data:application/json;base64,");
    const values = await d1.positionValue(2);
    await expect(d1.removeLiquidity(2, 0, 0, deadline)).revertedWith(
      "Not position owner",
    );
    await d1.connect(other).removeLiquidity(2, ...values, deadline);
    await expect(d1.ownerOf(2)).reverted;
    await expect(d1.connect(other).removeLiquidity(2, 0, 0, deadline)).reverted;
  });
  it("withdrawal rights follow NFT transfer", async () => {
    await d1.transferFrom(owner.address, other.address, 1);
    await expect(d1.removeLiquidity(1, 0, 0, deadline)).revertedWith(
      "Not position owner",
    );
    await d1.connect(other).removeLiquidity(1, 0, 0, deadline);
  });
  it("LP redemption includes fee growth", async () => {
    const old = await d1.pools(1);
    await d1.connect(other).swap(1, old.tokenA, E("1000"), 0, deadline);
    const p = await d1.pools(1);
    expect(p.reserveA * p.reserveB).gt(old.reserveA * old.reserveB);
    const pos = await d1.positions(1);
    const [v0, v1] = await d1.positionValue(1);
    expect(v0).eq((p.reserveA * pos.shares) / p.totalShares);
    expect(v1).eq((p.reserveB * pos.shares) / p.totalShares);
  });
  it("rejects zero, expired and slipped operations", async () => {
    await expect(d1.swap(1, a.target, 0, 0, deadline)).revertedWith(
      "Invalid swap",
    );
    await expect(d1.swap(1, a.target, E("1"), E("100"), deadline)).revertedWith(
      "Swap slippage",
    );
    await expect(d1.addLiquidity(1, 1, 1, 0, 0, 1)).revertedWith("Expired");
    await expect(d1.removeLiquidity(1, E("999999"), 0, deadline)).revertedWith(
      "Withdrawal slippage",
    );
  });
  it("one transaction executes both legs and pays only the caller", async () => {
    const start = await b.balanceOf(other.address);
    await expect(
      arb
        .connect(other)
        .execute(d1.target, 1, d2.target, 1, b.target, E("100"), 1, deadline),
    ).emit(arb, "Arbitrage");
    expect(await b.balanceOf(other.address)).gt(start);
    expect(await a.balanceOf(arb.target)).eq(0);
    expect(await b.balanceOf(arb.target)).eq(0);
  });
  it("failed arbitrage rolls back both pools, balances and allowances", async () => {
    const p1 = await d1.pools(1),
      p2 = await d2.pools(1),
      balance = await b.balanceOf(other.address),
      allowance = await b.allowance(other.address, arb.target);
    await expect(
      arb
        .connect(other)
        .execute(
          d1.target,
          1,
          d2.target,
          1,
          b.target,
          E("100"),
          E("1000"),
          deadline,
        ),
    ).revertedWith("Swap slippage");
    expect(await d1.pools(1)).deep.eq(p1);
    expect(await d2.pools(1)).deep.eq(p2);
    expect(await b.balanceOf(other.address)).eq(balance);
    expect(await b.allowance(other.address, arb.target)).eq(allowance);
  });
  it("supports wrapped ETH deposit, exchange and withdrawal", async () => {
    const w = await ethers.deployContract("WrappedETH");
    await w.deposit({ value: E("1") });
    expect(await w.balanceOf(owner.address)).eq(E("1"));
    await w.withdraw(E("0.25"));
    expect(await ethers.provider.getBalance(w.target)).eq(E("0.75"));
    await d1.createPool(a.target, w.target);
    await w.approve(d1.target, ethers.MaxUint256);
    const p = await d1.pools(2);
    const v =
      p.tokenA === a.target ? [E("100"), E("0.5")] : [E("0.5"), E("100")];
    await d1.addLiquidity(2, ...v, 0, 0, deadline);
    expect(await d1.quote(2, w.target, E("0.01"))).gt(0);
  });
});
