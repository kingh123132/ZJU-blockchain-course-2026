// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';
import '@openzeppelin/contracts/utils/Strings.sol';
import '@openzeppelin/contracts/utils/Base64.sol';

/// @notice Constant-product pools; each deposit mints one transferable position NFT.
contract MiniDEX is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 public constant FEE_BPS = 30;
    struct Pool { address tokenA; address tokenB; uint256 reserveA; uint256 reserveB; uint256 totalShares; uint256 createdTimestamp; uint256 feesA; uint256 feesB; }
    struct Position { uint256 poolId; uint256 shares; uint256 depositedA; uint256 depositedB; uint256 createdAt; address provider; }
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => Position) public positions;
    mapping(bytes32 => uint256) public pairId;
    uint256 public poolCount;
    uint256 public nextPositionId = 1;
    event PoolCreated(uint256 indexed poolId,address tokenA,address tokenB,address indexed creator);
    event LiquidityAdded(uint256 indexed poolId,uint256 indexed nftId,address indexed provider,uint256 amountA,uint256 amountB,uint256 shares);
    event LiquidityRemoved(uint256 indexed poolId,uint256 indexed nftId,address indexed provider,uint256 amountA,uint256 amountB);
    event Swap(uint256 indexed poolId,address indexed trader,address indexed tokenIn,uint256 amountIn,uint256 amountOut,uint256 fee);
    constructor(string memory n) ERC721(n,'TLP') {}
    function createPool(address x,address y) external returns(uint256 id) {
        require(x != y && x != address(0) && y != address(0),'Invalid pair');
        require(x.code.length > 0 && y.code.length > 0,'Not contracts');
        (address a,address b) = x < y ? (x,y) : (y,x);
        bytes32 key = keccak256(abi.encode(a,b));
        require(pairId[key] == 0,'Pair exists');
        id = ++poolCount;
        pairId[key] = id;
        pools[id] = Pool(a,b,0,0,0,block.timestamp,0,0);
        emit PoolCreated(id,a,b,msg.sender);
    }
    function poolTokens(uint256 id) external view returns(address,address) { Pool storage p = _pool(id); return(p.tokenA,p.tokenB); }
    function _pool(uint256 id) private view returns(Pool storage p) { require(id > 0 && id <= poolCount,'Unknown pool'); return pools[id]; }
    function _pull(address token,uint256 amount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender,address(this),amount);
        require(IERC20(token).balanceOf(address(this)) - beforeBalance == amount,'Unsupported token');
    }
    function addLiquidity(uint256 id,uint256 maxA,uint256 maxB,uint256 minA,uint256 minB,uint256 deadline) external nonReentrant returns(uint256 nftId) {
        require(block.timestamp <= deadline,'Expired');
        Pool storage p = _pool(id);
        require(maxA > 0 && maxB > 0,'Zero amount');
        uint256 a = maxA; uint256 b = maxB; uint256 shares;
        if(p.totalShares == 0) {
            uint256 root = Math.sqrt(a * b);
            require(root > MINIMUM_LIQUIDITY,'Too small');
            shares = root - MINIMUM_LIQUIDITY;
            p.totalShares = MINIMUM_LIQUIDITY;
        } else {
            uint256 optimalB = Math.mulDiv(a,p.reserveB,p.reserveA);
            if(optimalB <= b) b = optimalB; else a = Math.mulDiv(b,p.reserveA,p.reserveB);
            shares = Math.min(Math.mulDiv(a,p.totalShares,p.reserveA),Math.mulDiv(b,p.totalShares,p.reserveB));
        }
        require(a >= minA && b >= minB && shares > 0,'Liquidity slippage');
        _pull(p.tokenA,a); _pull(p.tokenB,b);
        p.reserveA += a; p.reserveB += b; p.totalShares += shares;
        nftId = nextPositionId++;
        positions[nftId] = Position(id,shares,a,b,block.timestamp,msg.sender);
        _mint(msg.sender,nftId);
        emit LiquidityAdded(id,nftId,msg.sender,a,b,shares);
    }
    function positionValue(uint256 nftId) public view returns(uint256 a,uint256 b) {
        _requireOwned(nftId);
        Position storage pos = positions[nftId]; Pool storage p = pools[pos.poolId];
        return(Math.mulDiv(p.reserveA,pos.shares,p.totalShares),Math.mulDiv(p.reserveB,pos.shares,p.totalShares));
    }
    function removeLiquidity(uint256 nftId,uint256 minA,uint256 minB,uint256 deadline) external nonReentrant returns(uint256 a,uint256 b) {
        require(block.timestamp <= deadline,'Expired');
        require(ownerOf(nftId) == msg.sender,'Not position owner');
        Position memory pos = positions[nftId]; Pool storage p = pools[pos.poolId];
        (a,b) = positionValue(nftId);
        require(a >= minA && b >= minB,'Withdrawal slippage');
        p.totalShares -= pos.shares; p.reserveA -= a; p.reserveB -= b;
        _burn(nftId); delete positions[nftId];
        IERC20(p.tokenA).safeTransfer(msg.sender,a); IERC20(p.tokenB).safeTransfer(msg.sender,b);
        emit LiquidityRemoved(pos.poolId,nftId,msg.sender,a,b);
    }
    function quote(uint256 id,address tokenIn,uint256 amount) public view returns(uint256) {
        Pool storage p = _pool(id);
        require(tokenIn == p.tokenA || tokenIn == p.tokenB,'Invalid token');
        (uint256 rIn,uint256 rOut) = tokenIn == p.tokenA ? (p.reserveA,p.reserveB) : (p.reserveB,p.reserveA);
        require(rIn > 0 && rOut > 0,'Empty pool');
        uint256 effective = amount * (10000 - FEE_BPS);
        return Math.mulDiv(effective,rOut,rIn * 10000 + effective);
    }
    function swap(uint256 id,address tokenIn,uint256 amount,uint256 minOut,uint256 deadline) external nonReentrant returns(uint256 out) {
        require(block.timestamp <= deadline && amount > 0,'Invalid swap');
        Pool storage p = _pool(id); out = quote(id,tokenIn,amount);
        require(out >= minOut && out > 0,'Swap slippage');
        _pull(tokenIn,amount);
        uint256 fee = Math.mulDiv(amount,FEE_BPS,10000);
        address tokenOut;
        if(tokenIn == p.tokenA) { p.reserveA += amount; p.reserveB -= out; p.feesA += fee; tokenOut = p.tokenB; }
        else { p.reserveB += amount; p.reserveA -= out; p.feesB += fee; tokenOut = p.tokenA; }
        IERC20(tokenOut).safeTransfer(msg.sender,out);
        emit Swap(id,msg.sender,tokenIn,amount,out,fee);
    }
    function tokenURI(uint256 id) public view override returns(string memory) {
        _requireOwned(id); Position storage p = positions[id];
        return string.concat('data:application/json;base64,',Base64.encode(bytes(string.concat('{"name":"Tidal LP #',id.toString(),'","description":"AMM liquidity position; fees remain in reserves.","pool":',p.poolId.toString(),',"shares":"',p.shares.toString(),'","depositedA":"',p.depositedA.toString(),'","depositedB":"',p.depositedB.toString(),'","createdAt":',p.createdAt.toString(),'}'))));
    }
}
