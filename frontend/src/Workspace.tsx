import { useEffect, useState, useCallback } from "react";
import type { Signer } from "ethers";
import { Contract } from "ethers";
import {
  config,
  rpc,
  dex,
  token,
  short,
  fmt,
  parseEther,
  formatEther,
  deadline,
  approve,
  pools,
  positions,
  scan,
  arb,
  wallet,
  simulate,
  revertReceipt,
} from "./chain";
import type { Pool, Position, Opportunity } from "./chain";
import "./App.css";

type Log = {
  label: string;
  hash: string;
  block: number;
  gas: string;
  status: string;
};
const pages = ["兑换", "流动性", "创建交易池", "套利", "模拟与记录"];
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const errorText = (e: unknown) => {
  const x = e as { reason?: string; shortMessage?: string; message?: string };
  return x.reason || x.shortMessage || x.message || String(e);
};
function Workspace() {
  const [page, setPage] = useState("兑换"),
    [signer, setSigner] = useState<Signer>(),
    [address, setAddress] = useState(""),
    [account, setAccount] = useState("1"),
    [all, setAll] = useState<Pool[]>([]),
    [nfts, setNfts] = useState<Position[]>([]),
    [selected, setSelected] = useState("0-1"),
    [balances, setBalances] = useState<Record<string, bigint>>({}),
    [symbols, setSymbols] = useState<Record<string, string>>({}),
    [eth, setEth] = useState(0n),
    [block, setBlock] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [logs, setLogs] = useState<Log[]>([]);
  const [input, setInput] = useState(config.tokens[1].address),
    [amount, setAmount] = useState("100"),
    [quote, setQuote] = useState(0n),
    [maxA, setMaxA] = useState("100"),
    [maxB, setMaxB] = useState("100"),
    [createEx, setCreateEx] = useState("0"),
    [createA, setCreateA] = useState(config.tokens[0].address),
    [createB, setCreateB] = useState(config.tokens[1].address),
    [wrap, setWrap] = useState("1");
  const [arbInput, setArbInput] = useState(config.tokens[1].address),
    [arbAmount, setArbAmount] = useState("100"),
    [minProfit, setMinProfit] = useState("0.001"),
    [opps, setOpps] = useState<Opportunity[]>([]),
    [watch, setWatch] = useState(false),
    [auto, setAuto] = useState(false),
    [arbResult, setArbResult] = useState<any>(),
    [failure, setFailure] = useState<any>(),
    [simResult, setSimResult] = useState<any>(),
    [simProgress, setSimProgress] = useState(""),
    [sourcePool, setSourcePool] = useState("all");
  const p = all.find((p) => p.key === selected),
    sym = (a: string) => symbols[a.toLowerCase()] || short(a);
  const refresh = useCallback(
    async (s?: Signer) => {
      try {
        const pp = await pools(),
          nn = await positions();
        setAll(pp);
        setNfts(nn);
        setBlock(await rpc.getBlockNumber());
        const aa = [
          ...new Set([
            ...config.tokens.map((t) => t.address),
            ...pp.flatMap((p) => [p.tokenA, p.tokenB]),
          ]),
        ];
        const sy: Record<string, string> = {};
        await Promise.all(
          aa.map(async (a) => {
            try {
              sy[a.toLowerCase()] = await token(a).symbol();
            } catch {
              sy[a.toLowerCase()] = short(a);
            }
          }),
        );
        setSymbols(sy);
        const active = s || signer;
        if (active) {
          const addr = await active.getAddress();
          setAddress(addr);
          setEth(await rpc.getBalance(addr));
          const bb: Record<string, bigint> = {};
          await Promise.all(
            aa.map(async (a) => {
              bb[a.toLowerCase()] = await token(a).balanceOf(addr);
            }),
          );
          setBalances(bb);
        }
      } catch (e) {
        setError("本地区块链尚未就绪：" + errorText(e));
      }
    },
    [signer],
  );
  useEffect(() => {
    rpc
      .getSigner(1)
      .then((s) => {
        setSigner(s);
        return refresh(s);
      })
      .catch((e) => setError(errorText(e)));
    fetch("/results/simulation.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => r && setSimResult({ ...r, saved: true }))
      .catch(() => {});
    fetch("/results/arbitrage.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (r) {
          setArbResult({ ...r.success, saved: true });
          setFailure(r.failure);
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!p) return;
    let live = true;
    try {
      dex(p.address)
        .quote(p.id, input, parseEther(amount || "0"))
        .then((q) => live && setQuote(q))
        .catch(() => live && setQuote(0n));
    } catch {
      setQuote(0n);
    }
    return () => {
      live = false;
    };
  }, [selected, input, amount, all]);
  const addLog = (label: string, tx: any, r: any, status = "已确认") =>
    setLogs((old) =>
      [
        {
          label,
          hash: tx.hash || r?.hash || "",
          block: r?.blockNumber || 0,
          gas: r?.gasUsed?.toString() || "—",
          status,
        },
        ...old,
      ].slice(0, 100),
    );
  const act = async (label: string, job: () => Promise<any>) => {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      if (!signer) throw Error("请先选择本地账户或连接钱包");
      const tx = await job();
      if (tx?.wait) {
        const r = await tx.wait();
        addLog(label, tx, r);
      }
      await refresh();
      setNotice(label + "完成");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  };
  const changeAccount = async (value: string) => {
    setAccount(value);
    setError("");
    try {
      const s = await rpc.getSigner(Number(value));
      setSigner(s);
      await refresh(s);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const find = async () => {
    const list = await scan(await pools(), arbInput, parseEther(arbAmount));
    setOpps(list);
    return list;
  };
  const executeArb = async (forced = false) => {
    const list = await find(),
      o = list[0];
    if (!o) throw Error("没有同币对的可用路径");
    if (!forced && o.profit <= 0n)
      throw Error("当前报价无利润，请先在一个交易所兑换以形成价差");
    await approve(o.input, config.arbitrage, o.amount, signer!);
    const before = await pools(),
      beforeBalance = await token(o.input).balanceOf(address);
    try {
      const tx = await arb(signer).execute(
        o.buy.address,
        o.buy.id,
        o.sell.address,
        o.sell.id,
        o.input,
        o.amount,
        forced ? parseEther("1000000") : parseEther(minProfit),
        await deadline(),
        { gasLimit: 1500000 },
      );
      const r = await tx.wait();
      const balance = await token(o.input).balanceOf(address),
        after = await pools();
      const evt = r.logs
        .map((l: any) => {
          try {
            return arb().interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((x: any) => x?.name === "Arbitrage");
      setArbResult({
        hash: tx.hash,
        status: r.status,
        block: r.blockNumber,
        inputCTB: formatEther(o.amount),
        intermediateCTA: formatEther(evt.args.intermediateAmount),
        outputCTB: formatEther(evt.args.amountOut),
        profitCTB: formatEther(balance - beforeBalance),
        balanceBeforeCTB: formatEther(beforeBalance),
        balanceAfterCTB: formatEther(balance),
        buy: o.buy.exchange,
        sell: o.sell.exchange,
        before: before.filter((x) => x.id === 1).map(priceSnapshot),
        after: after.filter((x) => x.id === 1).map(priceSnapshot),
        inputSymbol: sym(o.input),
        middleSymbol: sym(o.middle),
      });
      addLog("原子套利", tx, r);
    } catch (e) {
      if (forced) {
        const after = await pools(),
          balance = await token(o.input).balanceOf(address);
        const unchanged = before.every(
          (x, i) =>
            x.reserveA === after[i].reserveA &&
            x.reserveB === after[i].reserveB,
        );
        const receipt = await revertReceipt(e);
        if (!receipt || receipt.status !== 0) throw e;
        setFailure({
          expectedRevert: true,
          poolsUnchanged: unchanged,
          balanceUnchanged: balance === beforeBalance,
          receiptHash: receipt.hash,
          reason: errorText(e),
        });
        addLog("套利回滚验证", { hash: receipt.hash }, receipt, "已回滚");
        setNotice("套利失败已回滚；两个交易所储备与账户代币余额均保持一致");
      } else throw e;
    }
  };
  function priceSnapshot(x: Pool) {
    const first = equal(x.tokenA, config.tokens[0].address);
    return {
      reserveCTA: formatEther(first ? x.reserveA : x.reserveB),
      reserveCTB: formatEther(first ? x.reserveB : x.reserveA),
      priceCTBperCTA:
        Number(first ? x.reserveB : x.reserveA) /
        Number(first ? x.reserveA : x.reserveB),
    };
  }
  useEffect(() => {
    if (!watch || page !== "套利") return;
    const id = setInterval(() => {
      if (!busy) {
        void find()
          .then((list) => {
            if (auto && list[0] && list[0].profit >= parseEther(minProfit))
              void act("自动套利", () => executeArb());
          })
          .catch((e) => setError(errorText(e)));
      }
    }, 5000);
    return () => clearInterval(id);
  }, [watch, auto, page, busy, arbInput, arbAmount, minProfit, signer, all]);
  const mine = nfts.filter((n) => equal(n.owner, address)),
    out = p ? (equal(input, p.tokenA) ? p.tokenB : p.tokenA) : "";
  const choosePool = (key: string) => {
    setSelected(key);
    const pool = all.find((x) => x.key === key);
    if (pool && !equal(input, pool.tokenA) && !equal(input, pool.tokenB))
      setInput(pool.tokenA);
  };
  const poolSelect = (
    <label>
      交易池
      <select
        aria-label="交易池"
        value={selected}
        onChange={(e) => choosePool(e.target.value)}
      >
        {all.map((x) => (
          <option key={x.key} value={x.key}>
            {config.exchanges[x.exchange].name} · {sym(x.tokenA)}/
            {sym(x.tokenB)} · #{x.id}
          </option>
        ))}
      </select>
    </label>
  );
  const disabled = !!busy || !signer;
  return (
    <div className="app">
      <header className="topbar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("兑换");
          }}
        >
          Tidal
        </a>
        <nav aria-label="主导航">
          {pages.map((x) => (
            <button
              key={x}
              className={page === x ? "active" : ""}
              onClick={() => setPage(x)}
            >
              {x}
            </button>
          ))}
        </nav>
        <div className="wallet">
          <div className="network">
            <span className="dot" />
            Hardhat · 31337 <small>区块 #{block}</small>
          </div>
          <select
            aria-label="本地账户"
            disabled={!!busy}
            value={account}
            onChange={(e) => void changeAccount(e.target.value)}
          >
            {account === "external" && (
              <option value="external">外部钱包</option>
            )}
            {Array.from({ length: 25 }, (_, i) => (
              <option key={i} value={i}>
                本地账户 {String(i).padStart(2, "0")}
              </option>
            ))}
          </select>
          <button
            disabled={!!busy}
            onClick={() =>
              void act("连接钱包", async () => {
                const s = await wallet();
                setSigner(s);
                setAccount("external");
                await refresh(s);
              })
            }
          >
            连接钱包
          </button>
          <code title={address}>{short(address)}</code>
        </div>
      </header>
      <main>
        {" "}
        <div className="intro">
          <div>
            <span className="live-badge">
              <span className="dot" /> 链上实时状态
            </span>
            <h2>
              {page === "兑换"
                ? "兑换代币"
                : page === "流动性"
                  ? "我的流动性"
                  : page === "套利"
                    ? "原子套利"
                    : page === "创建交易池"
                      ? "创建交易池"
                      : "多账户模拟"}
            </h2>
            <p>
              {page === "套利"
                ? "比较两套交易所的双腿报价；利润不足时，整个交易回滚。"
                : "在本地网络兑换代币、提供流动性，查看每一次链上交互。"}
            </p>
          </div>
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => void refresh()}
          >
            ↻ 刷新链上状态
          </button>
        </div>
        <section className="metrics">
          <div>
            <small>交易所 / 交易池</small>
            <strong>
              {config.exchanges.length} <span>/ {all.length}</span>
            </strong>
          </div>
          <div>
            <small>我的 CTA / CTB</small>
            <strong>
              {fmt(balances[config.tokens[0].address.toLowerCase()] || 0n)}{" "}
              <span>
                / {fmt(balances[config.tokens[1].address.toLowerCase()] || 0n)}
              </span>
            </strong>
          </div>
          <div>
            <small>我的 ETH / NFT</small>
            <strong>
              {fmt(eth, 3)} <span>/ {mine.length} 个</span>
            </strong>
          </div>
          <div>
            <small>手续费分配</small>
            <strong>
              0.30% <span>全部留给 LP</span>
            </strong>
          </div>
        </section>
        {busy && (
          <div className="message pending" role="status">
            ◌ {busy} · {simProgress || "等待交易确认…"}
          </div>
        )}
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        {notice && !busy && (
          <div className="message success" role="status">
            ✓ {notice}
          </div>
        )}
        {page === "兑换" && (
          <div className="two-col">
            <section className="card trade-card">
              <div className="card-title">
                <h3>代币兑换</h3>
                <span>滑点上限 0.5%</span>
              </div>
              {poolSelect}
              <div className="token-box">
                <label>
                  支付{" "}
                  <small>余额 {fmt(balances[input.toLowerCase()] || 0n)}</small>
                </label>
                <div>
                  <input
                    aria-label="兑换数量"
                    type="number"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <select
                    aria-label="支付代币"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  >
                    {p &&
                      [p.tokenA, p.tokenB].map((t) => (
                        <option key={t} value={t}>
                          {sym(t)}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <button
                className="flip"
                aria-label="反转兑换方向"
                onClick={() => setInput(out)}
              >
                ↓
              </button>
              <div className="token-box output">
                <label>预计收到</label>
                <div>
                  <strong>{fmt(quote, 6)}</strong>
                  <span className="token-tag">{sym(out)}</span>
                </div>
              </div>
              <div className="detail-row">
                <span>最低收到</span>
                <b>
                  {fmt((quote * 995n) / 1000n, 6)} {sym(out)}
                </b>
              </div>
              <div className="detail-row">
                <span>输入手续费</span>
                <b>
                  {Number(amount || 0) * 0.003} {sym(input)}
                </b>
              </div>
              <button
                className="primary wide"
                disabled={disabled || !p || quote <= 0n}
                onClick={() =>
                  void act("兑换", async () => {
                    const a = parseEther(amount),
                      q = await dex(p!.address).quote(p!.id, input, a);
                    await approve(input, p!.address, a, signer!);
                    return dex(p!.address, signer).swap(
                      p!.id,
                      input,
                      a,
                      (q * 995n) / 1000n,
                      await deadline(),
                    );
                  })
                }
              >
                授权并兑换 →
              </button>
              <p className="fine">
                先授权实际输入数量，再提交兑换。最终成交以区块确认结果为准。
              </p>
            </section>
            <div className="stack">
              <section className="card">
                <div className="card-title">
                  <h3>测试资产</h3>
                  <span>当前账户独立领取</span>
                </div>
                <p className="muted">
                  CTA、CTB 每次各 100,000，领取间隔 60 秒。
                </p>
                <div className="button-row">
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void act("领取 CTA", () =>
                        token(config.tokens[0].address, signer).faucet(),
                      )
                    }
                  >
                    领取 CTA
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void act("领取 CTB", () =>
                        token(config.tokens[1].address, signer).faucet(),
                      )
                    }
                  >
                    领取 CTB
                  </button>
                  <button
                    disabled={disabled || account === "external"}
                    onClick={() =>
                      void act("领取测试 ETH", async () => {
                        const bank = await rpc.getSigner(24);
                        return bank.sendTransaction({
                          to: address,
                          value: parseEther("10"),
                        });
                      })
                    }
                  >
                    领取 10 ETH
                  </button>
                </div>
                <div className="divider" />
                <label>
                  ETH ↔ WETH 数量
                  <input
                    aria-label="ETH 包装数量"
                    value={wrap}
                    onChange={(e) => setWrap(e.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void act("包装 ETH", () =>
                        new Contract(
                          config.tokens[2].address,
                          config.abis.WrappedETH,
                          signer,
                        ).deposit({ value: parseEther(wrap) }),
                      )
                    }
                  >
                    包装 ETH
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void act("解包 WETH", () =>
                        new Contract(
                          config.tokens[2].address,
                          config.abis.WrappedETH,
                          signer,
                        ).withdraw(parseEther(wrap)),
                      )
                    }
                  >
                    解包 WETH
                  </button>
                  <span className="fine">
                    WETH 余额{" "}
                    {fmt(
                      balances[config.tokens[2].address.toLowerCase()] || 0n,
                    )}
                  </span>
                </div>
              </section>
              <PoolCard p={p} sym={sym} />
            </div>
          </div>
        )}
        {page === "流动性" && (
          <>
            <div className="two-col">
              <section className="card">
                <div className="card-title">
                  <h3>添加流动性</h3>
                  <span>铸造 ERC721</span>
                </div>
                {poolSelect}
                <div className="form-grid">
                  <label>
                    {p ? sym(p.tokenA) : "代币 A"} 上限
                    <input
                      aria-label="流动性 A"
                      value={maxA}
                      onChange={(e) => setMaxA(e.target.value)}
                    />
                  </label>
                  <label>
                    {p ? sym(p.tokenB) : "代币 B"} 上限
                    <input
                      aria-label="流动性 B"
                      value={maxB}
                      onChange={(e) => setMaxB(e.target.value)}
                    />
                  </label>
                </div>
                <p className="muted">
                  已有池按当前储备比例使用代币，多余的输入额度留在账户。初始池由首位提供者确定比例。
                </p>
                <button
                  className="primary wide"
                  disabled={disabled || !p}
                  onClick={() =>
                    void act("添加流动性并铸造 NFT", async () => {
                      const a = parseEther(maxA),
                        b = parseEther(maxB);
                      let va = a,
                        vb = b;
                      if (p!.reserveA && p!.reserveB) {
                        const opt = (a * p!.reserveB) / p!.reserveA;
                        if (opt <= b) vb = opt;
                        else va = (b * p!.reserveA) / p!.reserveB;
                      }
                      await approve(p!.tokenA, p!.address, a, signer!);
                      await approve(p!.tokenB, p!.address, b, signer!);
                      return dex(p!.address, signer).addLiquidity(
                        p!.id,
                        a,
                        b,
                        (va * 995n) / 1000n,
                        (vb * 995n) / 1000n,
                        await deadline(),
                      );
                    })
                  }
                >
                  授权并添加流动性
                </button>
              </section>
              <PoolCard p={p} sym={sym} />
            </div>
            <div className="section-head">
              <h3>
                我的 NFT 凭证 <span>{mine.length}</span>
              </h3>
              <span>销毁凭证后，领取当前份额对应的两种资产</span>
            </div>
            <div className="nft-grid">
              {mine.length === 0 ? (
                <div className="empty">
                  当前账户还没有流动性 NFT。添加流动性后将在这里显示。
                </div>
              ) : (
                mine.map((n) => {
                  const pp = all.find(
                    (x) =>
                      x.exchange === n.exchange && x.id === Number(n.poolId),
                  );
                  return (
                    <article className="nft" key={n.key}>
                      <div className="nft-art">
                        <span>TIDAL POSITION</span>
                        <strong>#{String(n.id).padStart(3, "0")}</strong>
                        <small>
                          {config.exchanges[n.exchange].name} · Pool{" "}
                          {String(n.poolId)}
                        </small>
                      </div>
                      <div className="nft-body">
                        <h3>
                          {pp
                            ? sym(pp.tokenA) + " / " + sym(pp.tokenB)
                            : "流动性凭证"}
                        </h3>
                        <div className="detail-row">
                          <span>当前可领（含手续费）</span>
                          <b>
                            {fmt(n.valueA)} / {fmt(n.valueB)}
                          </b>
                        </div>
                        <div className="detail-row">
                          <span>原始投入</span>
                          <b>
                            {fmt(n.depositedA)} / {fmt(n.depositedB)}
                          </b>
                        </div>
                        <div className="detail-row">
                          <span>份额 / 占池比例</span>
                          <b>
                            {fmt(n.shares)} /{" "}
                            {pp
                              ? fmt(
                                  (Number(n.shares) * 100) /
                                    Number(pp.totalShares),
                                  3,
                                )
                              : 0}
                            %
                          </b>
                        </div>
                        <div className="fine">
                          创建于{" "}
                          {new Date(
                            Number(n.createdAt) * 1000,
                          ).toLocaleString()}
                          <br />
                          最初提供者 {short(n.provider)}
                        </div>
                        <details>
                          <summary>查看链上元数据</summary>
                          <pre>
                            {JSON.stringify(
                              {
                                poolId: String(n.poolId),
                                shares: String(n.shares),
                                depositedA: String(n.depositedA),
                                depositedB: String(n.depositedB),
                                createdAt: String(n.createdAt),
                                owner: n.owner,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                        <button
                          className="wide"
                          disabled={disabled}
                          onClick={() =>
                            void act("销毁 NFT 并撤回流动性", async () =>
                              dex(
                                config.exchanges[n.exchange].address,
                                signer,
                              ).removeLiquidity(
                                n.id,
                                (n.valueA * 995n) / 1000n,
                                (n.valueB * 995n) / 1000n,
                                await deadline(),
                              ),
                            )
                          }
                        >
                          销毁 NFT 并撤回
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
            <section className="card sources">
              <div className="card-title">
                <h3>各池流动性来源</h3>
                <select
                  aria-label="来源池筛选"
                  value={sourcePool}
                  onChange={(e) => setSourcePool(e.target.value)}
                >
                  <option value="all">全部交易池</option>
                  {all.map((x) => (
                    <option key={x.key} value={x.key}>
                      {config.exchanges[x.exchange].name} #{x.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>凭证 / 池</th>
                      <th>初始提供者</th>
                      <th>当前持有人</th>
                      <th>份额</th>
                      <th>初始投入 A / B</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nfts
                      .filter(
                        (n) =>
                          sourcePool === "all" ||
                          sourcePool === `${n.exchange}-${n.poolId}`,
                      )
                      .map((n) => (
                        <tr key={n.key}>
                          <td>
                            #{n.id} · {config.exchanges[n.exchange].name} /{" "}
                            {String(n.poolId)}
                          </td>
                          <td title={n.provider}>{short(n.provider)}</td>
                          <td title={n.owner}>{short(n.owner)}</td>
                          <td>{fmt(n.shares)}</td>
                          <td>
                            {fmt(n.depositedA)} / {fmt(n.depositedB)}
                          </td>
                          <td>
                            {new Date(
                              Number(n.createdAt) * 1000,
                            ).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
        {page === "创建交易池" && (
          <div className="two-col">
            <section className="card">
              <div className="card-title">
                <h3>创建新的代币对</h3>
                <span>无需许可</span>
              </div>
              <label>
                交易所
                <select
                  aria-label="创建交易所"
                  value={createEx}
                  onChange={(e) => setCreateEx(e.target.value)}
                >
                  {config.exchanges.map((x, i) => (
                    <option key={x.address} value={i}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                ERC20 地址 A
                <input
                  aria-label="代币地址 A"
                  value={createA}
                  onChange={(e) => setCreateA(e.target.value)}
                />
              </label>
              <label>
                ERC20 地址 B
                <input
                  aria-label="代币地址 B"
                  value={createB}
                  onChange={(e) => setCreateB(e.target.value)}
                />
              </label>
              <div className="preset">
                快捷选择：
                {config.tokens.map((t) => (
                  <button key={t.address} onClick={() => setCreateB(t.address)}>
                    {t.symbol} → B
                  </button>
                ))}
              </div>
              <p className="muted">
                输入标准 ERC20
                合约地址。同一交易所中，每个代币对只创建一个池；两家交易所可以分别创建同一代币对。当前界面支持
                18 位小数代币。
              </p>
              <button
                className="primary wide"
                disabled={disabled}
                onClick={() =>
                  void act("创建交易池", async () => {
                    for (const t of [createA, createB])
                      if (Number(await token(t).decimals()) !== 18)
                        throw Error("当前界面仅支持 18 位小数 ERC20");
                    return dex(
                      config.exchanges[Number(createEx)].address,
                      signer,
                    ).createPool(createA, createB);
                  })
                }
              >
                创建交易池
              </button>
            </section>
            <section className="card">
              <h3>已部署的交易池</h3>
              {all.map((x) => (
                <div className="pool-line" key={x.key}>
                  <div>
                    <strong>
                      {sym(x.tokenA)} / {sym(x.tokenB)}
                    </strong>
                    <small>
                      {config.exchanges[x.exchange].name} · #{x.id}
                    </small>
                  </div>
                  <button
                    onClick={() => {
                      choosePool(x.key);
                      setPage("流动性");
                    }}
                  >
                    {x.totalShares ? "添加流动性" : "注入初始流动性"} ↗
                  </button>
                </div>
              ))}
              <div className="divider" />
              {config.tokens.map((t) => (
                <div className="contract-address" key={t.address}>
                  <b>{t.symbol}</b>
                  <code>{t.address}</code>
                </div>
              ))}
            </section>
          </div>
        )}
        {page === "套利" && (
          <>
            <div className="two-col">
              <section className="card">
                <div className="card-title">
                  <h3>双腿原子套利</h3>
                  <span>单笔链上交易</span>
                </div>
                <div className="form-grid">
                  <label>
                    本金代币
                    <select
                      aria-label="套利本金代币"
                      value={arbInput}
                      onChange={(e) => setArbInput(e.target.value)}
                    >
                      {config.tokens.slice(0, 2).map((t) => (
                        <option key={t.address} value={t.address}>
                          {t.symbol}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    本金数量
                    <input
                      aria-label="套利本金数量"
                      value={arbAmount}
                      onChange={(e) => setArbAmount(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  最低利润（本金代币）
                  <input
                    aria-label="最低套利利润"
                    value={minProfit}
                    onChange={(e) => setMinProfit(e.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button
                    disabled={disabled}
                    onClick={() => void act("扫描套利报价", find)}
                  >
                    扫描价差
                  </button>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={watch}
                      onChange={(e) => setWatch(e.target.checked)}
                    />
                    每 5 秒扫描
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={auto}
                      onChange={(e) => {
                        setAuto(e.target.checked);
                        if (e.target.checked) setWatch(true);
                      }}
                    />
                    有利润时自动执行
                  </label>
                </div>
                <button
                  className="primary wide"
                  disabled={disabled}
                  onClick={() => void act("执行原子套利", () => executeArb())}
                >
                  执行最优路径 →
                </button>
                <button
                  className="wide danger"
                  disabled={disabled}
                  onClick={() =>
                    void act("验证套利失败回滚", () => executeArb(true))
                  }
                >
                  验证失败回滚（设置过高利润门槛）
                </button>
                <p className="fine">
                  报价已扣除两次 0.3% 兑换手续费；利润以本金代币计，未折算 ETH
                  gas 成本。测试回滚仍消耗 gas。
                </p>
              </section>
              <section className="card">
                <div className="card-title">
                  <h3>当前路径报价</h3>
                  <span>{opps.length} 条</span>
                </div>
                {!opps.length ? (
                  <div className="empty">扫描后查看各路径的净代币收益</div>
                ) : (
                  opps.map((o, i) => (
                    <div key={i} className="route">
                      <div className="detail-row">
                        <b>
                          {config.exchanges[o.buy.exchange].name} →{" "}
                          {config.exchanges[o.sell.exchange].name}
                        </b>
                        <strong
                          className={o.profit > 0n ? "positive" : "negative"}
                        >
                          {o.profit > 0n ? "+" : ""}
                          {fmt(o.profit, 6)} {sym(o.input)}
                        </strong>
                      </div>
                      <p>
                        {fmt(o.amount)} {sym(o.input)} → {fmt(o.received, 6)}{" "}
                        {sym(o.middle)} → {fmt(o.output, 6)} {sym(o.input)}
                      </p>
                      <small>
                        Pool #{o.buy.id} → #{o.sell.id}
                      </small>
                    </div>
                  ))
                )}
                {failure && (
                  <div className="rollback">
                    <h4>
                      ↶ 回滚验证：
                      {failure.poolsUnchanged && failure.balanceUnchanged
                        ? "通过"
                        : "检查失败"}
                    </h4>
                    <p>
                      两个池储备未变：{String(failure.poolsUnchanged)}
                      <br />
                      本金代币余额未变：{String(failure.balanceUnchanged)}
                    </p>
                    {failure.receiptHash && <code>{failure.receiptHash}</code>}
                  </div>
                )}
              </section>
            </div>
            {arbResult && (
              <section className="card result">
                <div className="card-title">
                  <h3>
                    {arbResult.saved ? "已保存的套利验证记录" : "本次套利结果"}
                  </h3>
                  <span>
                    区块 #{arbResult.block} · status {arbResult.status}
                  </span>
                </div>
                <div className="result-summary">
                  <div>
                    <small>输入本金</small>
                    <strong>
                      {fmt(arbResult.inputCTB)} {arbResult.inputSymbol || "CTB"}
                    </strong>
                  </div>
                  <div>
                    <small>中间获得</small>
                    <strong>
                      {fmt(arbResult.intermediateCTA)}{" "}
                      {arbResult.middleSymbol || "CTA"}
                    </strong>
                  </div>
                  <div>
                    <small>回收本金与收益</small>
                    <strong>
                      {fmt(arbResult.outputCTB)}{" "}
                      {arbResult.inputSymbol || "CTB"}
                    </strong>
                  </div>
                  <div>
                    <small>净代币利润</small>
                    <strong className="positive">
                      +{fmt(arbResult.profitCTB, 6)}
                    </strong>
                  </div>
                </div>
                <div className="fine">
                  账户余额 {fmt(arbResult.balanceBeforeCTB)} →{" "}
                  {fmt(arbResult.balanceAfterCTB)} ·{" "}
                  {config.exchanges[arbResult.buy]?.name} →{" "}
                  {config.exchanges[arbResult.sell]?.name}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>交易所</th>
                        <th>CTA 储备 前 → 后</th>
                        <th>CTB 储备 前 → 后</th>
                        <th>CTB / CTA 价格 前 → 后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arbResult.before?.map((b: any, i: number) => (
                        <tr key={i}>
                          <td>{config.exchanges[i]?.name}</td>
                          <td>
                            {fmt(b.reserveCTA)} →{" "}
                            {fmt(arbResult.after[i].reserveCTA)}
                          </td>
                          <td>
                            {fmt(b.reserveCTB)} →{" "}
                            {fmt(arbResult.after[i].reserveCTB)}
                          </td>
                          <td>
                            {fmt(b.priceCTBperCTA, 6)} →{" "}
                            {fmt(arbResult.after[i].priceCTBperCTA, 6)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <code className="hash">{arbResult.hash}</code>
              </section>
            )}
          </>
        )}
        {page === "模拟与记录" && (
          <>
            <section className="card">
              <div className="card-title">
                <h3>20 个账户 · 随机跨池操作</h3>
                <span>固定种子 2026 · 可复现</span>
              </div>
              <p className="muted">
                本地账户 01–20
                分别领取代币，随机选择交易所和兑换方向，依次完成兑换、添加流动性、销毁
                NFT 撤回。所有操作逐笔确认。
              </p>
              <button
                className="primary"
                disabled={disabled || account === "external"}
                onClick={() =>
                  void act("运行 20 用户模拟", async () => {
                    try {
                      const result = await simulate(setSimProgress);
                      setSimResult(result);
                      setNotice("20 个账户完成 60 次真实链上操作");
                    } finally {
                      setSimProgress("");
                    }
                  })
                }
              >
                开始 20 用户模拟
              </button>
              {simResult && (
                <>
                  <div className="result-summary">
                    <div>
                      <small>用户地址</small>
                      <strong>{simResult.counts.users}</strong>
                    </div>
                    <div>
                      <small>兑换 / 添加 / 撤回</small>
                      <strong>
                        {simResult.counts.swap} / {simResult.counts.add} /{" "}
                        {simResult.counts.remove}
                      </strong>
                    </div>
                    <div>
                      <small>失败操作</small>
                      <strong>{simResult.counts.failed}</strong>
                    </div>
                    <div>
                      <small>运行时间</small>
                      <strong>{fmt(simResult.durationSeconds, 1)} 秒</strong>
                    </div>
                  </div>
                  <p className="fine">
                    {simResult.saved
                      ? "显示仓库保存的四轮运行报告，40 次兑换、20 次添加、20 次撤回。"
                      : "显示本次浏览器模拟结果。"}
                  </p>
                  <button
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(
                        new Blob([JSON.stringify(simResult, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      a.download = "simulation.json";
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    导出完整模拟报告
                  </button>
                  <details>
                    <summary>
                      查看全部 {simResult.operations.length} 条确认记录
                    </summary>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>账户</th>
                            <th>地址</th>
                            <th>操作</th>
                            <th>交易所</th>
                            <th>区块</th>
                            <th>交易哈希</th>
                          </tr>
                        </thead>
                        <tbody>
                          {simResult.operations.map((o: any, i: number) => (
                            <tr key={i}>
                              <td>{o.user}</td>
                              <td>{short(o.address)}</td>
                              <td>{o.kind}</td>
                              <td>{o.exchange === 0 ? "East" : "West"}</td>
                              <td>{o.block}</td>
                              <td>
                                <code title={o.hash}>{short(o.hash)}</code>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </section>
            <section className="card">
              <h3>交易所与合约地址</h3>
              {config.exchanges.map((x) => (
                <div className="contract-address" key={x.address}>
                  <b>{x.name}</b>
                  <code>{x.address}</code>
                </div>
              ))}
              <div className="contract-address">
                <b>AtomicArbitrage</b>
                <code>{config.arbitrage}</code>
              </div>
            </section>
          </>
        )}
        <section className="card activity">
          <div className="card-title">
            <h3>本次会话的链上交互</h3>
            <span>授权与交易由当前账户签名</span>
          </div>
          {logs.length === 0 ? (
            <p className="muted">
              完成一次操作后，这里会显示交易哈希、确认区块和 gas 用量。
            </p>
          ) : (
            logs.map((l, i) => (
              <div className="activity-row" key={i}>
                <span
                  className={l.status === "已回滚" ? "negative" : "positive"}
                >
                  ● {l.status}
                </span>
                <b>{l.label}</b>
                <code title={l.hash}>{l.hash}</code>
                <small>
                  #{l.block} · gas {l.gas}
                </small>
              </div>
            ))
          )}
        </section>
        <footer>
          <span>
            tidal. <i /> 杨金潼 · 3230105308 · 作业 2
          </span>
          <span>本地演示账户由 Hardhat 节点解锁，仅用于课程测试。</span>
        </footer>
      </main>
    </div>
  );
}
function PoolCard({ p, sym }: { p?: Pool; sym: (a: string) => string }) {
  return (
    <section className="card">
      <div className="card-title">
        <h3>池储备与手续费</h3>
        <span>链上读取</span>
      </div>
      {p ? (
        <>
          <div className="reserve">
            <div>
              <small>{sym(p.tokenA)}</small>
              <strong>{fmt(p.reserveA)}</strong>
            </div>
            <span>⇄</span>
            <div>
              <small>{sym(p.tokenB)}</small>
              <strong>{fmt(p.reserveB)}</strong>
            </div>
          </div>
          <div className="detail-row">
            <span>现货价格</span>
            <b>
              1 {sym(p.tokenA)} ≈{" "}
              {p.reserveA
                ? fmt(Number(p.reserveB) / Number(p.reserveA), 6)
                : "—"}{" "}
              {sym(p.tokenB)}
            </b>
          </div>
          <div className="detail-row">
            <span>累计输入手续费 A / B</span>
            <b>
              {fmt(p.feesA, 5)} / {fmt(p.feesB, 5)}
            </b>
          </div>
          <div className="detail-row">
            <span>总份额</span>
            <b>{fmt(p.totalShares)}</b>
          </div>
          <div className="contract-address">
            <code>{p.address}</code>
          </div>
          <p className="fine">
            手续费已留在储备中；累计手续费是统计值，不作为额外奖金重复发放。
          </p>
        </>
      ) : (
        <p>尚无交易池</p>
      )}
    </section>
  );
}
export default Workspace;
