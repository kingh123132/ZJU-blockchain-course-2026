import {
  Contract,
  JsonRpcProvider,
  BrowserProvider,
  parseEther,
  formatEther,
  Signer,
} from "ethers";
import config from "./generated/deployment.json";
export { config, parseEther, formatEther };
export const rpc = new JsonRpcProvider(config.rpcUrl, undefined, {
  cacheTimeout: -1,
});
rpc.pollingInterval = 100;
export const tokenABI = [
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function faucet()",
];
export const dex = (address: string, s?: Signer) =>
  new Contract(address, config.abis.MiniDEX, s || rpc);
export const token = (address: string, s?: Signer) =>
  new Contract(address, tokenABI, s || rpc);
export const short = (s: string) =>
  s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "暂无";
export const fmt = (n: bigint | string | number, d = 4) =>
  Number(typeof n === "bigint" ? formatEther(n) : n).toLocaleString("en-US", {
    maximumFractionDigits: d,
  });
export async function deadline() {
  return (await rpc.getBlock("latest"))!.timestamp + 1200;
}
export async function approve(
  address: string,
  spender: string,
  amount: bigint,
  s: Signer,
) {
  const t = token(address, s);
  if ((await t.allowance(await s.getAddress(), spender)) < amount)
    await (await t.approve(spender, amount)).wait();
}
export async function ensureBalance(
  address: string,
  amount: bigint,
  signer: Signer,
) {
  if ((await token(address).balanceOf(await signer.getAddress())) < amount)
    throw Error("代币余额不足，请领取测试币或减少输入数量。");
}
export async function depositETH(amount: bigint, signer: Signer) {
  if ((await rpc.getBalance(await signer.getAddress())) < amount)
    throw Error("账户以太币余额不足，请减少包装数量。");
  return new Contract(
    config.tokens[2].address,
    config.abis.WrappedETH,
    signer,
  ).deposit({ value: amount });
}
export type Pool = {
  key: string;
  exchange: number;
  id: number;
  address: string;
  tokenA: string;
  tokenB: string;
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  feesA: bigint;
  feesB: bigint;
  createdTimestamp: bigint;
};
export type Position = {
  key: string;
  exchange: number;
  id: number;
  poolId: bigint;
  shares: bigint;
  depositedA: bigint;
  depositedB: bigint;
  createdAt: bigint;
  provider: string;
  owner: string;
  valueA: bigint;
  valueB: bigint;
};
export async function pools() {
  const all: Pool[] = [];
  for (let e = 0; e < config.exchanges.length; e++) {
    const d = dex(config.exchanges[e].address),
      count = Number(await d.poolCount());
    for (let id = 1; id <= count; id++) {
      const p = await d.pools(id);
      all.push({
        key: `${e}-${id}`,
        exchange: e,
        id,
        address: config.exchanges[e].address,
        tokenA: p.tokenA,
        tokenB: p.tokenB,
        reserveA: p.reserveA,
        reserveB: p.reserveB,
        totalShares: p.totalShares,
        feesA: p.feesA,
        feesB: p.feesB,
        createdTimestamp: p.createdTimestamp,
      });
    }
  }
  return all;
}
export async function positions() {
  const all: Position[] = [];
  for (let e = 0; e < config.exchanges.length; e++) {
    const d = dex(config.exchanges[e].address),
      count = Number(await d.nextPositionId());
    await Promise.all(
      Array.from({ length: count - 1 }, async (_, i) => {
        const id = i + 1;
        try {
          const owner = await d.ownerOf(id),
            p = await d.positions(id),
            v = await d.positionValue(id);
          all.push({
            key: `${e}-${id}`,
            exchange: e,
            id,
            poolId: p.poolId,
            shares: p.shares,
            depositedA: p.depositedA,
            depositedB: p.depositedB,
            createdAt: p.createdAt,
            provider: p.provider,
            owner,
            valueA: v[0],
            valueB: v[1],
          });
        } catch {
          /* 已销毁的凭证没有持有人。 */
        }
      }),
    );
  }
  return all.sort((a, b) => a.id - b.id);
}
export type Opportunity = {
  buy: Pool;
  sell: Pool;
  input: string;
  middle: string;
  amount: bigint;
  received: bigint;
  output: bigint;
  profit: bigint;
};
export async function scan(all: Pool[], input: string, amount: bigint) {
  const list: Opportunity[] = [];
  for (const buy of all)
    for (const sell of all) {
      if (buy.key === sell.key || !buy.reserveA || !sell.reserveA) continue;
      const pair = [buy.tokenA.toLowerCase(), buy.tokenB.toLowerCase()]
        .sort()
        .join();
      if (
        pair !==
          [sell.tokenA.toLowerCase(), sell.tokenB.toLowerCase()]
            .sort()
            .join() ||
        ![buy.tokenA.toLowerCase(), buy.tokenB.toLowerCase()].includes(
          input.toLowerCase(),
        )
      )
        continue;
      const middle =
        buy.tokenA.toLowerCase() === input.toLowerCase()
          ? buy.tokenB
          : buy.tokenA;
      const received: bigint = await dex(buy.address).quote(
          buy.id,
          input,
          amount,
        ),
        output: bigint = await dex(sell.address).quote(
          sell.id,
          middle,
          received,
        );
      list.push({
        buy,
        sell,
        input,
        middle,
        amount,
        received,
        output,
        profit: output - amount,
      });
    }
  return list.sort((a, b) => (a.profit > b.profit ? -1 : 1));
}
export const arb = (s?: Signer) =>
  new Contract(config.arbitrage, config.abis.AtomicArbitrage, s || rpc);
export async function revertReceipt(error: unknown) {
  const e = error as any;
  if (e.receipt) return e.receipt;
  const hash =
    e.data?.txHash || e.error?.data?.txHash || e.info?.error?.data?.txHash;
  if (hash) return await rpc.getTransactionReceipt(hash);
  return null;
}
export async function wallet() {
  const eth = (window as unknown as { ethereum?: object }).ethereum;
  if (!eth) throw Error("未检测到钱包扩展，可以使用本地演示账户。");
  const p = new BrowserProvider(
    eth as ConstructorParameters<typeof BrowserProvider>[0],
  );
  await p.send("eth_requestAccounts", []);
  if ((await p.getNetwork()).chainId !== 31337n)
    throw Error(
      "请将钱包切换到本地网络 31337，节点地址为 http://127.0.0.1:8545。",
    );
  return p.getSigner();
}
export async function simulate(progress: (s: string) => void) {
  const operations: {
    user: number;
    address: string;
    kind: string;
    hash: string;
    block: number;
    status: number;
    exchange: number;
  }[] = [];
  const started = Date.now();
  let seed = 2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 1; i <= 20; i++) {
    const s = await rpc.getSigner(i),
      address = await s.getAddress();
    progress(`用户 ${i}/20：领取与授权`);
    for (const t of config.tokens.slice(0, 2)) {
      const c = token(t.address, s);
      if ((await c.balanceOf(address)) < parseEther("1000"))
        await (await c.faucet()).wait();
    }
    const exchange = Math.floor(random() * 2),
      d = dex(config.exchanges[exchange].address, s),
      p = await d.pools(1),
      a = parseEther(String(10 + Math.floor(random() * 50))),
      input = config.tokens[Math.floor(random() * 2)].address;
    await approve(input, d.target as string, a, s);
    const swap = await d.swap(1, input, a, 0, await deadline()),
      sr = await swap.wait();
    operations.push({
      user: i,
      address,
      kind: "swap",
      hash: swap.hash,
      block: sr.blockNumber,
      status: sr.status,
      exchange,
    });
    progress(`用户 ${i}/20：兑换完成，添加流动性`);
    const v = parseEther("20");
    await approve(p.tokenA, d.target as string, v, s);
    await approve(p.tokenB, d.target as string, v, s);
    const add = await d.addLiquidity(1, v, v, 0, 0, await deadline()),
      ar = await add.wait();
    const event = ar.logs
      .map((l: { topics: string[]; data: string }) => {
        try {
          return d.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((x: { name: string } | null) => x?.name === "LiquidityAdded");
    operations.push({
      user: i,
      address,
      kind: "add",
      hash: add.hash,
      block: ar.blockNumber,
      status: ar.status,
      exchange,
    });
    progress(`用户 ${i}/20：销毁 NFT，撤回流动性`);
    const remove = await d.removeLiquidity(
        event.args.nftId,
        0,
        0,
        await deadline(),
      ),
      rr = await remove.wait();
    operations.push({
      user: i,
      address,
      kind: "remove",
      hash: remove.hash,
      block: rr.blockNumber,
      status: rr.status,
      exchange,
    });
  }
  return {
    seed: 2026,
    durationSeconds: (Date.now() - started) / 1000,
    counts: {
      users: 20,
      swap: 20,
      add: 20,
      remove: 20,
      failed: operations.filter((x) => x.status !== 1).length,
    },
    operations,
  };
}
