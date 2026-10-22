// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
interface IDEX {
    function poolTokens(uint256 id) external view returns(address,address);
    function swap(uint256 id,address tokenIn,uint256 amount,uint256 minOut,uint256 deadline) external returns(uint256);
}

contract AtomicArbitrage is ReentrancyGuard {
    using SafeERC20 for IERC20;
    event Arbitrage(address indexed trader,address indexed buyDEX,address indexed sellDEX,address tokenIn,uint256 amountIn,uint256 intermediateAmount,uint256 amountOut,uint256 profit);
    function execute(address buyDEX,uint256 buyPool,address sellDEX,uint256 sellPool,address tokenIn,uint256 amount,uint256 minProfit,uint256 deadline) external nonReentrant returns(uint256 profit) {
        require(block.timestamp <= deadline && minProfit > 0 && amount > 0,'Invalid request');
        require(buyDEX != sellDEX || buyPool != sellPool,'Same pool');
        (address a,address b) = IDEX(buyDEX).poolTokens(buyPool);
        (address c,address d) = IDEX(sellDEX).poolTokens(sellPool);
        require((a == c && b == d) || (a == d && b == c),'Different pair');
        require(tokenIn == a || tokenIn == b,'Invalid token');
        address middle = tokenIn == a ? b : a;
        IERC20(tokenIn).safeTransferFrom(msg.sender,address(this),amount);
        IERC20(tokenIn).forceApprove(buyDEX,amount);
        uint256 received = IDEX(buyDEX).swap(buyPool,tokenIn,amount,1,deadline);
        IERC20(middle).forceApprove(sellDEX,received);
        uint256 result = IDEX(sellDEX).swap(sellPool,middle,received,amount + minProfit,deadline);
        profit = result - amount;
        IERC20(tokenIn).safeTransfer(msg.sender,result);
        emit Arbitrage(msg.sender,buyDEX,sellDEX,tokenIn,amount,received,result,profit);
    }
}
