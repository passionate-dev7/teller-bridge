// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {DeskLock, IERC20} from "../src/DeskLock.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

contract DeskLockTest is Test {
    DeskLock htlc;
    TestUSDC usdc;
    address user = address(0xA11CE);
    address desk = address(0xDE5C);
    address relayer = address(0xBEEF);
    bytes32 secret = keccak256("secret");
    bytes32 hashlock = sha256(abi.encodePacked(secret));
    uint64 timeout;
    uint256 constant AMT = 500_000;

    event Locked(bytes32 indexed id, address indexed sender, address indexed recipient, bytes32 hashlock, uint64 timeout, uint256 amount);
    event Claimed(bytes32 indexed id, bytes32 secret);
    event Refunded(bytes32 indexed id);

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new TestUSDC();
        htlc = new DeskLock(IERC20(address(usdc)));
        timeout = uint64(block.timestamp + 1 hours);
        usdc.mint(desk, 10 * AMT);
        vm.prank(desk);
        usdc.approve(address(htlc), type(uint256).max);
    }

    function _lock() internal returns (bytes32 id) {
        vm.prank(desk);
        id = htlc.lock(user, hashlock, timeout, AMT);
    }

    function test_lock_escrows_funds_and_emits() public {
        bytes32 id = keccak256(abi.encode(desk, user, hashlock, timeout, AMT));
        vm.expectEmit(true, true, true, true);
        emit Locked(id, desk, user, hashlock, timeout, AMT);
        assertEq(_lock(), id);
        assertEq(usdc.balanceOf(address(htlc)), AMT);
        assertEq(usdc.balanceOf(desk), 9 * AMT);
        (address s, address r, uint64 t, DeskLock.State st, uint256 a, bytes32 h) = htlc.locks(id);
        assertEq(s, desk); assertEq(r, user); assertEq(t, timeout); assertEq(uint8(st), 1); assertEq(a, AMT); assertEq(h, hashlock);
    }

    function test_lock_rejects_zero_amount() public {
        vm.prank(desk);
        vm.expectRevert("amount");
        htlc.lock(user, hashlock, timeout, 0);
    }

    function test_lock_rejects_timeout_not_in_future() public {
        vm.prank(desk);
        vm.expectRevert("timeout");
        htlc.lock(user, hashlock, uint64(block.timestamp), AMT);
    }

    function test_lock_rejects_duplicate() public {
        _lock();
        vm.prank(desk);
        vm.expectRevert("exists");
        htlc.lock(user, hashlock, timeout, AMT);
    }

    function test_lock_reverts_without_allowance() public {
        vm.prank(user);
        vm.expectRevert();
        htlc.lock(desk, hashlock, timeout, AMT);
    }

    function test_claim_pays_recipient_even_when_a_relayer_calls() public {
        bytes32 id = _lock();
        vm.expectEmit(true, false, false, true);
        emit Claimed(id, secret);
        vm.prank(relayer);
        htlc.claim(id, secret);
        assertEq(usdc.balanceOf(user), AMT);
        assertEq(usdc.balanceOf(relayer), 0);
        assertEq(usdc.balanceOf(address(htlc)), 0);
    }

    function test_claim_rejects_wrong_secret() public {
        bytes32 id = _lock();
        vm.expectRevert("secret");
        htlc.claim(id, keccak256("other"));
    }

    function test_claim_rejects_at_timeout_and_after() public {
        bytes32 id = _lock();
        vm.warp(timeout);
        vm.expectRevert("expired");
        htlc.claim(id, secret);
    }

    function test_claim_works_one_second_before_timeout() public {
        bytes32 id = _lock();
        vm.warp(timeout - 1);
        htlc.claim(id, secret);
        assertEq(usdc.balanceOf(user), AMT);
    }

    function test_claim_cannot_run_twice() public {
        bytes32 id = _lock();
        htlc.claim(id, secret);
        vm.expectRevert("not open");
        htlc.claim(id, secret);
    }

    function test_claim_unknown_id() public {
        vm.expectRevert("not open");
        htlc.claim(bytes32(uint256(1)), secret);
    }

    function test_refund_pays_sender_only_from_timeout() public {
        bytes32 id = _lock();
        vm.warp(timeout - 1);
        vm.expectRevert("not expired");
        htlc.refund(id);
        vm.warp(timeout);
        vm.expectEmit(true, false, false, true);
        emit Refunded(id);
        vm.prank(relayer);
        htlc.refund(id);
        assertEq(usdc.balanceOf(desk), 10 * AMT);
        assertEq(usdc.balanceOf(relayer), 0);
    }

    function test_refund_cannot_run_twice() public {
        bytes32 id = _lock();
        vm.warp(timeout);
        htlc.refund(id);
        vm.expectRevert("not open");
        htlc.refund(id);
    }

    function test_refund_after_claim_rejected() public {
        bytes32 id = _lock();
        htlc.claim(id, secret);
        vm.warp(timeout);
        vm.expectRevert("not open");
        htlc.refund(id);
    }

    function test_claim_after_refund_rejected() public {
        bytes32 id = _lock();
        vm.warp(timeout);
        htlc.refund(id);
        vm.expectRevert("not open");
        htlc.claim(id, secret);
    }

    function test_a_third_party_lock_with_same_terms_gets_its_own_id() public {
        usdc.mint(relayer, AMT);
        vm.prank(relayer);
        usdc.approve(address(htlc), AMT);
        bytes32 a = _lock();
        vm.prank(relayer);
        bytes32 b = htlc.lock(user, hashlock, timeout, AMT);
        assertTrue(a != b);
    }
}
