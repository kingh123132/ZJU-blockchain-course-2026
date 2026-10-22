# 合约部分

合约在 `contracts/`，脚本在 `scripts/`，验证用例在 `test/`。完整启动步骤及实验结果见仓库根目录的 README。

- `npm ci` 安装锁定版本的依赖。
- `npm test` 编译合约并执行 10 项验证。
- `npm run node` 启动本地区块链，提供 25 个测试账户。
- 在另一个终端运行 `npm run deploy`，部署代币、两个 DEX 和套利合约，并更新前端 ABI 及地址。
- 节点运行期间执行 `npm run simulate` 和 `npm run demo`，分别生成多账户报告与套利报告。

编译器随 `solc` 依赖安装，不需要另外下载编译器。测试 ETH 和水龙头代币仅在本地网络使用。
