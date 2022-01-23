// SPDX-License-Identifier: Apache
pragma solidity 0.8.10;

contract Test {
	function func0() external {
		address(this).call{gas: 9000}("");
	}
	function func1(address addr) external {
	}
}

