# 前端部分

React、TypeScript、Vite 和 ethers v6。完整操作流程见根目录 README。

先启动本地区块链并部署合约，再执行：

```sh
npm ci
npm start
```

访问 http://127.0.0.1:3000。默认使用本地账户 01，可以切换到其他解锁的测试账户，也可以连接 31337 网络上的浏览器钱包。`npm run build` 完成类型检查并生成 `build/`。

`src/generated/deployment.json` 由部署脚本生成。重建本地区块链后应重新部署合约。页面从 `../docs/results/` 读取已保存的实验报告，并明确标为历史记录。当前余额、储备和凭证仍从本地区块链读取。
