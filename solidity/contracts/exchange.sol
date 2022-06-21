// SPDX-License-Identifier: Apache
pragma solidity 0.8.10;

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract Exchange {
	address constant private BCHAddress = 0x0000000000000000000000000000000000002711;
	bytes32 private constant SALT = keccak256(abi.encodePacked("Exchange"));
	uint256 private constant CHAINID = 10000; // smartBCH mainnet
	string private constant EIP712_DOMAIN = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)";
	bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(abi.encodePacked(EIP712_DOMAIN));
	bytes32 private constant DAPP_HASH = keccak256(abi.encodePacked("exchange dapp"));
	bytes32 private constant VERSION_HASH = keccak256(abi.encodePacked("v0.1.0"));
	bytes32 private constant TYPE_HASH = keccak256(abi.encodePacked("Exchange(uint256 coinsToMaker,uint256 coinsToTaker,uint256 takerAddr_dueTime64_shift8_nonce8)"));
	mapping(address => uint) makerNonces;

	function getEIP712Hash(uint256 coinsToMaker, uint256 coinsToTaker,
			       uint256 takerAddr_dueTime64_shift8_nonce8
		) public view returns (bytes32) {
		bytes32 DOMAIN_SEPARATOR = keccak256(abi.encode(
						     EIP712_DOMAIN_TYPEHASH,
						     DAPP_HASH,
						     VERSION_HASH,
						     CHAINID,
						     address(this),
						     SALT));
		return keccak256(abi.encodePacked(
			"\x19\x01",
			DOMAIN_SEPARATOR,
			keccak256(abi.encode(
				TYPE_HASH,
				coinsToMaker,
				coinsToTaker,
				takerAddr_dueTime64_shift8_nonce8
			))
		));
	}

	function getMaker(uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime64_shift8_nonce8_v8,
			  bytes32 r, bytes32 s) public view returns (address) {
		bytes32 eip712Hash = getEIP712Hash(coinsToMaker, coinsToTaker,
						   takerAddr_dueTime64_shift8_nonce8_v8>>8);
		uint8 v = uint8(takerAddr_dueTime64_shift8_nonce8_v8); //the lowest byte is v
		return ecrecover(eip712Hash, v, r, s);
	}

	// takerAddr_dueTime64_shift8_nonce8_v8:
	// { taker_address 160bit | duration_time 64bit | shift 8bit | nonce 8bit | v 8bit }
	function exchange(uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime64_shift8_nonce8_v8,
			  bytes32 r, bytes32 s) payable external {
		address makerAddr = getMaker(coinsToMaker, coinsToMaker,
					     takerAddr_dueTime64_shift8_nonce8_v8,
					     r, s);
		uint nonce = makerNonces[makerAddr];
		uint dueTime64 = uint(uint64(takerAddr_dueTime64_shift8_nonce8_v8>>24));
		require(block.timestamp < dueTime64, "too late");
		address takerAddr = address(bytes20(uint160(takerAddr_dueTime64_shift8_nonce8_v8>>(64+24))));
		require(takerAddr == address(0) || takerAddr == msg.sender, "taker mismatch");
		uint shift = (takerAddr_dueTime64_shift8_nonce8_v8>>16)&0xFF;
		uint mask = 0xFF<<shift;
		uint nonce8 = (takerAddr_dueTime64_shift8_nonce8_v8>>8)&0xFF;
		require((nonce&mask) == (nonce8<<shift), "nonce mismatch");
		nonce8 = (nonce8+1)&0xFF;
		nonce = (nonce&~mask)|(nonce8<<shift);
		makerNonces[makerAddr] = nonce;

		address coinTypeToMaker = address(bytes20(uint160(coinsToMaker>>96)));
		uint coinAmountToMaker = uint(uint96(coinsToMaker));
		address coinTypeToTaker = address(bytes20(uint160(coinsToTaker>>96)));
		uint coinAmountToTaker = uint(uint96(coinsToTaker));
		if(coinTypeToMaker == BCHAddress) {
			require(msg.value == coinAmountToMaker, "bch not enough");
			IERC20(coinTypeToMaker).transfer(makerAddr, coinAmountToMaker);
		} else {
			require(msg.value == 0, "no need for bch");
			IERC20(coinTypeToMaker).transferFrom(msg.sender, makerAddr, coinAmountToMaker);
		}
		IERC20(coinTypeToTaker).transferFrom(makerAddr, msg.sender, coinAmountToTaker);
	}
}

