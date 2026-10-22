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
  it("各地址独立领取，重复领取受时间限制", async () => {
    expect(await a.balanceOf(other.address)).eq(E("100000"));
    await expect(a.faucet()).revertedWith("Wait 60 seconds");
  });
  it("代币地址排序，并拒绝重复或无效池", async () => {
    await expect(d1.createPool(b.target, a.target)).revertedWith("Pair exists");
    await expect(d1.createPool(a.target, a.target)).revertedWith(
      "Invalid pair",
    );
    await expect(d1.createPool(a.target, other.address)).revertedWith(
      "Not contracts",
    );
  });
  it("报价包含手续费，储备正确且乘积不减少", async () => {
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
  it("铸造元数据，按份额撤回并销毁凭证，不能重复领取", async () => {
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
  it("凭证转让后，撤回权限随持有人转移", async () => {
    await d1.transferFrom(owner.address, other.address, 1);
    await expect(d1.removeLiquidity(1, 0, 0, deadline)).revertedWith(
      "Not position owner",
    );
    await d1.connect(other).removeLiquidity(1, 0, 0, deadline);
  });
  it("撤回金额包含池内手续费增长", async () => {
    const old = await d1.pools(1);
    await d1.connect(other).swap(1, old.tokenA, E("1000"), 0, deadline);
    const p = await d1.pools(1);
    expect(p.reserveA * p.reserveB).gt(old.reserveA * old.reserveB);
    const pos = await d1.positions(1);
    const [v0, v1] = await d1.positionValue(1);
    expect(v0).eq((p.reserveA * pos.shares) / p.totalShares);
    expect(v1).eq((p.reserveB * pos.shares) / p.totalShares);
  });
  it("拒绝零数量、过期交易和超出滑点的操作", async () => {
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
  it("一笔交易完成两次兑换，仅将利润支付给调用者", async () => {
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
  it("套利失败时，两池储备、余额及授权一起恢复", async () => {
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
  it("包装以太币可以存入、兑换和取回", async () => {
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
  it("按现有比例添加流动性，未用的输入留在账户", async () => {
    const beforeA = await a.balanceOf(other.address),
      beforeB = await b.balanceOf(other.address);
    await d1
      .connect(other)
      .addLiquidity(1, E("100"), E("500"), E("100"), E("100"), deadline);
    expect(beforeA - (await a.balanceOf(other.address))).eq(E("100"));
    expect(beforeB - (await b.balanceOf(other.address))).eq(E("100"));
    expect((await d1.positions(2)).shares).eq(E("100"));
  });
  it("首笔最小份额保持锁定，全部可领凭证撤回后仍能继续提供流动性", async () => {
    await d1.removeLiquidity(1, 0, 0, deadline);
    const p = await d1.pools(1);
    expect(p.totalShares).eq(1000n);
    expect(p.reserveA).gt(0);
    expect(p.reserveB).gt(0);
    await d1.connect(other).addLiquidity(1, E("10"), E("10"), 0, 0, deadline);
    expect(await d1.ownerOf(2)).eq(other.address);
  });
  it("多个池共用代币时，各池储备独立记账", async () => {
    const c = await ethers.deployContract("TestToken", ["C", "C"]);
    await c.faucet();
    await c.approve(d1.target, ethers.MaxUint256);
    await d1.createPool(a.target, c.target);
    await d1.addLiquidity(2, E("200"), E("200"), 0, 0, deadline);
    const before = await d1.pools(2);
    await d1.swap(1, a.target, E("10"), 0, deadline);
    expect(await d1.pools(2)).deep.eq(before);
    const first = await d1.pools(1),
      second = await d1.pools(2);
    expect(await a.balanceOf(d1.target)).eq(
      (first.tokenA === a.target ? first.reserveA : first.reserveB) +
        (second.tokenA === a.target ? second.reserveA : second.reserveB),
    );
  });
  it("空池不能交易，无效代币和零投入会被拒绝", async () => {
    const c = await ethers.deployContract("TestToken", ["C", "C"]);
    await d1.createPool(a.target, c.target);
    await expect(d1.quote(2, a.target, E("1"))).revertedWith("Empty pool");
    await expect(d1.quote(1, c.target, E("1"))).revertedWith("Invalid token");
    await expect(d1.addLiquidity(1, 0, 0, 0, 0, deadline)).revertedWith(
      "Zero amount",
    );
  });
  it("套利拒绝同池、不同币对、错误输入币和零利润门槛", async () => {
    const c = await ethers.deployContract("TestToken", ["C", "C"]);
    await d2.createPool(a.target, c.target);
    await expect(
      arb.execute(d1.target, 1, d1.target, 1, b.target, E("1"), 1, deadline),
    ).revertedWith("Same pool");
    await expect(
      arb.execute(d1.target, 1, d2.target, 2, b.target, E("1"), 1, deadline),
    ).revertedWith("Different pair");
    await expect(
      arb.execute(d1.target, 1, d2.target, 1, c.target, E("1"), 1, deadline),
    ).revertedWith("Invalid token");
    await expect(
      arb.execute(d1.target, 1, d2.target, 1, b.target, E("1"), 0, deadline),
    ).revertedWith("Invalid request");
  });
  it("报价变化后仍执行最低输出检查，失败时储备不变", async () => {
    const q = await d1.quote(1, a.target, E("100"));
    await d1.connect(other).swap(1, a.target, E("2000"), 0, deadline);
    const before = await d1.pools(1);
    await expect(d1.swap(1, a.target, E("100"), q, deadline)).revertedWith(
      "Swap slippage",
    );
    expect(await d1.pools(1)).deep.eq(before);
  });
  it("拒绝转账扣费代币，失败时不保留扣款或流动性份额", async () => {
    const source =
      "pragma solidity ^0.8.28; contract FeeToken {mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance; constructor(){balanceOf[msg.sender]=100000 ether;} function approve(address s,uint v) external returns(bool){allowance[msg.sender][s]=v;return true;} function transfer(address to,uint v) external returns(bool){balanceOf[msg.sender]-=v;balanceOf[to]+=v-v/100;return true;} function transferFrom(address from,address to,uint v) external returns(bool){allowance[from][msg.sender]-=v;balanceOf[from]-=v;balanceOf[to]+=v-v/100;return true;}}";
    const output = JSON.parse(
      require("solc").compile(
        JSON.stringify({
          language: "Solidity",
          sources: { "FeeToken.sol": { content: source } },
          settings: {
            outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
          },
        }),
      ),
    ).contracts["FeeToken.sol"].FeeToken;
    const t = await new ethers.ContractFactory(
      output.abi,
      output.evm.bytecode.object,
      owner,
    ).deploy();
    await t.approve(d1.target, ethers.MaxUint256);
    await d1.createPool(a.target, t.target);
    const before = await t.balanceOf(owner.address);
    await expect(
      d1.addLiquidity(2, E("100"), E("100"), 0, 0, deadline),
    ).revertedWith("Unsupported token");
    expect(await t.balanceOf(owner.address)).eq(before);
    expect((await d1.pools(2)).totalShares).eq(0);
  });
});
