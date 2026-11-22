// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Open-mint 6-decimals ERC-20 standing in for USDC on local and test networks. Never deployed on Base mainnet.
contract TestUSDC {
    string public constant name = "Test USD Coin";
    string public constant symbol = "tUSDC";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
        emit Transfer(address(0), to, a);
    }

    function approve(address spender, uint256 a) external returns (bool) {
        allowance[msg.sender][spender] = a;
        emit Approval(msg.sender, spender, a);
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        emit Transfer(msg.sender, to, a);
        return true;
    }

    function transferFrom(address from, address to, uint256 a) external returns (bool) {
        allowance[from][msg.sender] -= a;
        balanceOf[from] -= a;
        balanceOf[to] += a;
        emit Transfer(from, to, a);
        return true;
    }
}
