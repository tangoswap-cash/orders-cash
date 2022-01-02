// SPDX-License-Identifier: Apache
pragma solidity 0.8.10;

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract ExchangeHub {
	struct Donation {
		uint256 amount_dueTime64_v8;
		bytes32 r;
		bytes32 s;
	}

	address constant private BCHAddress = 0x0000000000000000000000000000000000002711;
	string private constant EIP712_DOMAIN = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)";
	bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(abi.encodePacked(EIP712_DOMAIN));
	bytes32 private constant NAME_HASH = keccak256(abi.encodePacked("exchange dapp"));
	bytes32 private constant VERSION_HASH = keccak256(abi.encodePacked("v0.1.0"));
	uint256 private constant CHAINID = 10000; // smartBCH mainnet
	bytes32 private constant SALT = keccak256(abi.encodePacked("Exchange"));
	bytes32 private constant TYPE_HASH = keccak256(abi.encodePacked("Exchange(uint256 coinsToMaker,uint256 coinsToTaker,uint256 campaignID,uint256 takerAddr_dueTime64)"));
	uint256 private constant MUL = 10**9; // number of nanoseconds in one second

	mapping(address => address) public makerToAgent;
	mapping(address => uint64[1<<32]) public makerRecentDueTimeList;
	mapping(address => uint) public makerRDTStartEnd;
	
	event Exchange(address indexed maker, uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime64);
	event CampaignStart(uint256 indexed campaignID, address indexed coinTaker,
			    uint startTime, uint totalCoinsToTaker, bytes intro);
	event CampaignSuccess(uint256 indexed campaignID);
	event Donate(uint256 indexed campaignID, Donation donation);

	function getEIP712Hash(uint256 coinsToMaker, uint256 coinsToTaker, uint256 campaignID,
			       uint256 takerAddr_dueTime64) private view returns (bytes32) {
		bytes32 DOMAIN_SEPARATOR = keccak256(abi.encode(
						     EIP712_DOMAIN_TYPEHASH,
						     NAME_HASH,
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
				campaignID,
				takerAddr_dueTime64
			))
		));
	}

	function getSigner(uint256 coinsToMaker, uint256 coinsToTaker, uint256 campaignID,
			  uint256 takerAddr_dueTime64_v8, bytes32 r, bytes32 s) private view returns (address) {
		bytes32 eip712Hash = getEIP712Hash(coinsToMaker, coinsToTaker, campaignID,
						   takerAddr_dueTime64_v8>>8);
		uint8 v = uint8(takerAddr_dueTime64_v8); //the lowest byte is v
		return ecrecover(eip712Hash, v, r, s);
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

	function addNewDueTime(uint64 newDueTime) external {
		uint currTime = block.timestamp*MUL;
		clearOldDueTimesAndInsertNew(msg.sender, newDueTime, currTime);
	}

	function clearOldDueTimes(address makerAddr) external {
		uint currTime = block.timestamp*MUL;
		clearOldDueTimesAndInsertNew(makerAddr, 0, currTime);
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
				recentDueTimeList[i] = 0; //clear old useless records
			} else if(newStart==end) { // not updated yet in this loop
				newStart = i; //update start
			}
		}
		if(newDueTime == 0) { //keep old value of end
			makerRDTStartEnd[makerAddr] = uint(uint32(newStart<<32)) + uint(uint32(end));
		} else { //insert newDueTime at end
			recentDueTimeList[end] = newDueTime;
			makerRDTStartEnd[makerAddr] = uint(uint32(newStart<<32)) + uint(uint32(end+1));
		}
	}

	function setMakerAgent(address agent) external {
		makerToAgent[msg.sender] = agent;
	}

	function exchangeWithAgentSig(uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime64_v8,
			              address makerAddr, bytes32 r, bytes32 s) payable external {
		_exchange(coinsToMaker, coinsToTaker, takerAddr_dueTime64_v8, makerAddr, r, s);
	}

	function exchange(uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime64_v8,
			   bytes32 r, bytes32 s) payable external {
		_exchange(coinsToMaker, coinsToTaker, takerAddr_dueTime64_v8, address(0), r, s);
	}

	function _exchange(uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime64_v8,
			   address makerAddr, bytes32 r, bytes32 s) private {
		if(makerAddr == address(0)) {				 
			makerAddr = getSigner(coinsToMaker, coinsToTaker, uint(uint160(0)),
					     takerAddr_dueTime64_v8, r, s);
		} else {
			address agentAddr = getSigner(coinsToMaker, coinsToTaker, uint(uint160(makerAddr)),
					     takerAddr_dueTime64_v8, r, s);
			require(makerToAgent[makerAddr] == agentAddr, "invalid agent");
		}
		uint64 dueTime = uint64(takerAddr_dueTime64_v8>>8);
		uint currTime = block.timestamp*MUL;
		require(currTime < dueTime, "too late");
		clearOldDueTimesAndInsertNew(makerAddr, dueTime, currTime);
		address takerAddr = address(bytes20(uint160(takerAddr_dueTime64_v8>>(64+8))));
		if(takerAddr == address(0)) { //if taker is not specified, anyone sending tx can be the taker
			takerAddr = msg.sender;
		}
		address coinTypeToMaker = address(bytes20(uint160(coinsToMaker>>96)));
		uint coinAmountToMaker = uint(uint96(coinsToMaker));
		address coinTypeToTaker = address(bytes20(uint160(coinsToTaker>>96)));
		uint coinAmountToTaker = uint(uint96(coinsToTaker));
		emit Exchange(makerAddr, coinsToMaker, coinsToTaker, takerAddr_dueTime64_v8>>8);
		if(coinAmountToTaker != 0) {
			(bool success, bytes memory _notUsed) = coinTypeToTaker.call(
				abi.encodeWithSignature("transferFrom(address,address,uint256)", 
				makerAddr, takerAddr, coinAmountToTaker));
			require(success, "transferFrom fail");				
		}
		if(coinAmountToMaker != 0) {
			if(coinTypeToMaker == BCHAddress) {
				require(msg.value == coinAmountToMaker, "bch not enough");
				makerAddr.call{gas: 9000, value: coinAmountToMaker}("");
			} else {
				require(msg.value == 0, "no need for bch");
				IERC20(coinTypeToMaker).transferFrom(takerAddr, makerAddr, coinAmountToMaker);
			}
		}
	}

	function handleDonation(Donation calldata donation, uint currTime, address coinTypeToTaker, uint campaignID,
			       address takerAddr) private returns (uint) {
		uint64 dueTime = uint64(donation.amount_dueTime64_v8>>8);
		require(currTime < dueTime, "too late");
		uint coinAmountToTaker;
		uint takerAddr_dueTime64_v8;
		{
			uint amount = donation.amount_dueTime64_v8>>72;
			coinAmountToTaker = (uint(uint160(coinTypeToTaker))<<96) + amount;
			uint dueTime64_v8 = uint72(donation.amount_dueTime64_v8);
			takerAddr_dueTime64_v8 = (uint(uint160(takerAddr))<<72) + dueTime64_v8;
		}
		address makerAddr = getSigner(0/*zero coinsToMaker*/, coinAmountToTaker, campaignID,
					      takerAddr_dueTime64_v8, donation.r, donation.s);
		clearOldDueTimesAndInsertNew(makerAddr, dueTime, currTime);

		(bool success, bytes memory _notUsed) = coinTypeToTaker.call(
			abi.encodeWithSignature("transferFrom(address,address,uint256)", 
			makerAddr, takerAddr, coinAmountToTaker));
		require(success, "transferFrom fail");				
		return coinAmountToTaker;
	}

	function endCampaign(uint takerAddr_startTime64, uint totalCoinsToTaker, bytes32 introHash,
			   Donation[] calldata donations) external {
		uint currTime = block.timestamp*MUL;
		address coinTypeToTaker = address(uint160(totalCoinsToTaker>>96));
		uint campaignID = uint(keccak256(abi.encodePacked(
			takerAddr_startTime64, totalCoinsToTaker, introHash)));
		address takerAddr = address(uint160(takerAddr_startTime64>>64));
		uint sumAmount = 0;
		for(uint i=0; i<donations.length; i++) {
			sumAmount += handleDonation(donations[i], currTime, coinTypeToTaker, campaignID, takerAddr);
		}
		uint totalAmount = uint(uint96(totalCoinsToTaker));
		require(sumAmount >= totalAmount, "campaign fail");
		emit CampaignSuccess(campaignID);
	}

	function startCampaign(uint totalCoinsToTaker, bytes calldata intro) external {
		uint takerAddr_startTime64 = (uint(uint160(msg.sender))<<64) + block.timestamp;
		bytes32 introHash = keccak256(intro);
		uint campaignID = uint(keccak256(abi.encodePacked(
			takerAddr_startTime64, totalCoinsToTaker, introHash)));
		emit CampaignStart(campaignID, msg.sender, block.timestamp, totalCoinsToTaker, intro);
	}

	function donate(uint campaignID, Donation calldata donation) external {
		emit Donate(campaignID, donation);
	}
}

