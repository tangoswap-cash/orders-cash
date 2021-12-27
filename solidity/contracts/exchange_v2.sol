// SPDX-License-Identifier: Apache
pragma solidity 0.8.10;

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract ExchangeV2 {
	address constant private BCHAddress = 0x0000000000000000000000000000000000002711;
	bytes32 private constant SALT = keccak256(abi.encodePacked("Exchange"));
	uint256 private constant CHAINID = 10000; // smartBCH mainnet
	string private constant EIP712_DOMAIN = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)";
	bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(abi.encodePacked(EIP712_DOMAIN));
	bytes32 private constant DAPP_HASH = keccak256(abi.encodePacked("exchange dapp"));
	bytes32 private constant VERSION_HASH = keccak256(abi.encodePacked("v0.1.0"));
	bytes32 private constant TYPE_HASH = keccak256(abi.encodePacked("Exchange(uint256 coinsToMaker,uint256 coinsToTaker,uint256 takerAddr_dueTime64)"));
	uint256 private constant MUL = 10**9;

	mapping(address => uint64[1<<32]) public makerRecentDueTimeList;
	mapping(address => uint) public makerRDTStartEnd;

	function getEIP712Hash(uint256 coinsToMaker, uint256 coinsToTaker,
			       uint256 takerAddr_dueTime64
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
				takerAddr_dueTime64
			))
		));
	}

	function getMaker(uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime64_v8,
			  bytes32 r, bytes32 s) public view returns (address) {
		bytes32 eip712Hash = getEIP712Hash(coinsToMaker, coinsToTaker,
						   takerAddr_dueTime64_v8>>8);
		uint8 v = uint8(takerAddr_dueTime64_v8); //the lowest byte is v
		return ecrecover(eip712Hash, v, r, s);
	}

	function clearDueTime(uint index) external {
		makerRecentDueTimeList[msg.sender][index] = 0;
	}

	function getRecentDueTimes(address makerAddr) external view returns (uint[] memory recentDueTimes) {
		uint64[1<<32] storage recentDueTimeList = makerRecentDueTimeList[makerAddr];
		uint startEnd = makerRDTStartEnd[makerAddr];
		uint start = uint(uint32(startEnd>>32));
		uint end = uint(uint32(startEnd));
		recentDueTimes = new uint[](end-start);
		for(uint i=start; i<end; i++) {
			recentDueTimes[i-start] = recentDueTimeList[i];
		}
	}

	function clearOldDueTimesAndInsertNew(address makerAddr, uint64 newDueTime, uint currTime) private {
		uint64[1<<32] storage recentDueTimeList = makerRecentDueTimeList[makerAddr];
		uint startEnd = makerRDTStartEnd[makerAddr];
		uint start = uint(uint32(startEnd>>32));
		uint end = uint(uint32(startEnd));
		uint newStart = end;
		for(uint i=start; i<end; i++) {
			uint dueTime = recentDueTimeList[i];
			require(dueTime != newDueTime, "cannot replay old order"); //check replay
			if(dueTime < currTime) {
				recentDueTimeList[start] = 0; //clear old useless records
			} else if(newStart==end) {
				newStart = i; //update start
			}
		}
		recentDueTimeList[end] = newDueTime;
		makerRDTStartEnd[makerAddr] = uint(uint32(newStart<<32)) + uint(uint32(end+1));
	}

	function exchange(uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime64_v8,
			  bytes32 r, bytes32 s) payable external {
		address makerAddr = getMaker(coinsToMaker, coinsToMaker,
					     takerAddr_dueTime64_v8,
					     r, s);
		uint64 dueTime = uint64(takerAddr_dueTime64_v8>>24);
		uint currTime = block.timestamp*MUL;
		require(currTime < dueTime, "too late");
		clearOldDueTimesAndInsertNew(makerAddr, dueTime, currTime);
		address takerAddr = address(bytes20(uint160(takerAddr_dueTime64_v8>>(64+8))));
		require(takerAddr == address(0) || takerAddr == msg.sender, "taker mismatch");

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

