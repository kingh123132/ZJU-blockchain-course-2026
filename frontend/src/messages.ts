import { parseEther, MaxUint256 } from "ethers";

const errors: [RegExp, string][] = [
  [/Wait 60 seconds/i, "领取间隔为 60 秒，请稍后再试。"],
  [/Pair exists/i, "这家交易所已经有这个代币对，请选择现有交易池。"],
  [/Invalid pair/i, "请使用两个不同的有效代币地址。"],
  [/Not contracts|Unsupported token/i, "该地址不是支持的标准代币合约。"],
  [/Unknown pool/i, "交易池不存在，请刷新后重新选择。"],
  [/Empty pool/i, "交易池尚无流动性，请先添加两种代币。"],
  [/Too small|Zero amount/i, "投入数量过小，请增加两种代币的数量。"],
  [/Liquidity slippage/i, "投入比例或池储备已变化，请刷新后重试。"],
  [/Withdrawal slippage/i, "可撤回数量已变化，请刷新后重试。"],
  [/Swap slippage/i, "兑换输出低于最低要求，本次交易未执行。"],
  [/Not position owner/i, "只有凭证的当前持有人可以撤回流动性。"],
  [/ERC721NonexistentToken/i, "该流动性凭证不存在或已经销毁。"],
  [
    /ERC20InsufficientBalance|transfer amount exceeds balance/i,
    "代币余额不足，请领取测试币或减少输入数量。",
  ],
  [
    /ERC20InsufficientAllowance|insufficient allowance/i,
    "代币授权不足，请重新授权后再试。",
  ],
  [/Expired/i, "交易已超过截止时间，请刷新报价后重试。"],
  [/Same pool/i, "套利的两次兑换不能使用同一个交易池。"],
  [/Different pair/i, "套利路径中的两个池必须使用同一代币对。"],
  [/Invalid token/i, "所选代币不属于这个交易池。"],
  [/Invalid swap|Invalid request/i, "请检查数量、利润门槛和交易截止时间。"],
  [/ACTION_REJECTED|4001|user rejected|user denied/i, "你已取消钱包操作。"],
  [
    /insufficient funds|INSUFFICIENT_FUNDS/i,
    "账户以太币不足，无法支付数量或交易费用。",
  ],
  [/NETWORK_CHANGED|chain changed/i, "钱包网络已变化，请重新连接本地网络。"],
  [
    /ECONNREFUSED|Failed to fetch|fetch failed|SERVER_ERROR|NETWORK_ERROR/i,
    "无法连接本地节点，请确认节点正在运行后重试。",
  ],
  [/invalid address|UNCONFIGURED_NAME|ENS/i, "请输入有效的以太坊合约地址。"],
  [
    /INVALID_ARGUMENT|NUMERIC_FAULT|underflow|overflow/i,
    "数量格式不正确，最多支持 18 位小数。",
  ],
];

export function errorText(error: unknown): string {
  const e = error as any;
  const candidates = [
    e?.reason,
    e?.revert?.name,
    e?.shortMessage,
    e?.message,
    e?.error?.message,
    e?.info?.error?.message,
    e?.code,
  ]
    .filter(Boolean)
    .map(String);
  const combined = candidates.join(" ");
  for (const [pattern, text] of errors) if (pattern.test(combined)) return text;
  const own = candidates.find(
    (text) =>
      /^[\u3400-\u9fff]/.test(text) &&
      !/operation=|transaction=|code=/.test(text),
  );
  return own || "操作未完成，请检查输入数量、账户余额和网络连接后重试。";
}

export function positiveAmount(value: string, label = "数量"): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value.trim()))
    throw Error(`${label}格式不正确，最多支持 18 位小数。`);
  const amount = parseEther(value.trim());
  if (amount <= 0n || amount > MaxUint256)
    throw Error(`${label}必须大于零，且不能超过合约支持的范围。`);
  return amount;
}

export const operationName = (kind: string) =>
  ({ swap: "兑换", add: "添加流动性", remove: "撤回流动性" })[kind] ||
  "其他操作";
