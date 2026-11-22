// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// Hash-timelocked escrow of one ERC-20 (USDC). The BCH counterpart is contracts/bch/SwapLock.cash:
/// same sha256 hashlock over a 32-byte secret.
/// claim is permissionless but always pays the recipient, so a relay can claim for an offline user.
/// refund is permissionless but always pays the sender, and only from timeout on.
contract DeskLock {
    enum State { None, Open, Claimed, Refunded }

    struct Lock {
        address sender;
        address recipient;
        uint64 timeout;
        State state;
        uint256 amount;
        bytes32 hashlock;
    }

    IERC20 public immutable token;
    mapping(bytes32 => Lock) public locks;

    event Locked(bytes32 indexed id, address indexed sender, address indexed recipient, bytes32 hashlock, uint64 timeout, uint256 amount);
    event Claimed(bytes32 indexed id, bytes32 secret);
    event Refunded(bytes32 indexed id);

    constructor(IERC20 token_) {
        token = token_;
    }

    function lock(address recipient, bytes32 hashlock, uint64 timeout, uint256 amount) external returns (bytes32 id) {
        require(amount > 0, "amount");
        require(timeout > block.timestamp, "timeout");
        id = keccak256(abi.encode(msg.sender, recipient, hashlock, timeout, amount));
        require(locks[id].state == State.None, "exists");
        locks[id] = Lock(msg.sender, recipient, timeout, State.Open, amount, hashlock);
        _move(abi.encodeCall(IERC20.transferFrom, (msg.sender, address(this), amount)));
        emit Locked(id, msg.sender, recipient, hashlock, timeout, amount);
    }

    function claim(bytes32 id, bytes32 secret) external {
        Lock storage l = locks[id];
        require(l.state == State.Open, "not open");
        require(block.timestamp < l.timeout, "expired");
        require(sha256(abi.encodePacked(secret)) == l.hashlock, "secret");
        l.state = State.Claimed;
        _move(abi.encodeCall(IERC20.transfer, (l.recipient, l.amount)));
        emit Claimed(id, secret);
    }

    function refund(bytes32 id) external {
        Lock storage l = locks[id];
        require(l.state == State.Open, "not open");
        require(block.timestamp >= l.timeout, "not expired");
        l.state = State.Refunded;
        _move(abi.encodeCall(IERC20.transfer, (l.sender, l.amount)));
        emit Refunded(id);
    }

    function _move(bytes memory data) private {
        (bool ok, bytes memory ret) = address(token).call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "transfer");
    }
}
