# 界面设计

设计参考见 [interface-reference-v2.png](interface-reference-v2.png)。运行截图在 `../screenshots/`，参考图不作为功能验证。

页面使用纯白背景、黑灰文字和中性灰分隔线。兑换输入和主要操作放在左侧，储备及测试资产放在右侧，交易记录列在下方。导航采用横向布局。

去掉了暖色背景、装饰性大标题、重复统计卡片、渐变和阴影。绿色只提示成功状态，红色提示失败，状态同时配有文字。窄屏下两栏改成单栏，输入框字号不低于 16px。

实现时主要核对金额对齐、代币方向、交易确认状态、长地址换行和表格横向滚动。文案直接说明操作和计算结果。

参考：[Linear 界面重构](https://linear.app/now/how-we-redesigned-the-linear-ui)、[Web Interface Guidelines](https://vercel.com/design/guidelines)。
