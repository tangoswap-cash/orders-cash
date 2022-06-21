// SPDX-License-Identifier: Apache
pragma solidity 0.8.10;

contract Test {
	function func0(uint gas) external {
		address(this).call{gas: gas}(abi.encodeWithSignature("func1"));
	}
	function func1(address addr) external {
	}
}

