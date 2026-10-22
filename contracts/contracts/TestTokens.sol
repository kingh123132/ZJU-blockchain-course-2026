// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract TestToken is ERC20 {
    mapping(address => uint256) public lastClaim;
    constructor(string memory n, string memory s) ERC20(n,s) {}
    function faucet() external {
        require(lastClaim[msg.sender] == 0 || block.timestamp >= lastClaim[msg.sender] + 60, 'Wait 60 seconds');
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, 100_000 ether);
    }
}

contract WrappedETH is ERC20 {
    constructor() ERC20('Wrapped Ether','WETH') {}
    function deposit() public payable { _mint(msg.sender,msg.value); }
    function withdraw(uint256 amount) external {
        _burn(msg.sender,amount);
        (bool ok,) = msg.sender.call{value:amount}('');
        require(ok,'ETH transfer failed');
    }
    receive() external payable { deposit(); }
}
