// SPDX-License-Identifier: Apache
pragma solidity 0.8.10;

//import "hardhat/console.sol";

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract Burros {
    address private constant BCHAddress = 0x0000000000000000000000000000000000002711;
    string private constant EIP712_DOMAIN = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)";
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(abi.encodePacked(EIP712_DOMAIN));
    bytes32 private constant NAME_HASH = keccak256(abi.encodePacked("exchange dapp"));
    bytes32 private constant VERSION_HASH = keccak256(abi.encodePacked("v0.1.0"));
    uint256 private constant CHAINID = 10000; // smartBCH mainnet
    bytes32 private constant SALT = keccak256(abi.encodePacked("Exchange"));
    bytes32 private constant TYPE_HASH = keccak256(abi.encodePacked("Exchange(uint256 coinsToMaker,uint256 coinsToTaker,uint256 campaignID,uint256 takerAddr_dueTime80)"));
    uint256 private constant MUL = 10 ** 12; // number of picoseconds in one second
    uint256 private constant MaxClearCount = 10;

    //To prevent replay of coin-exchanging messages, we use dueTime to identify a coin-exchanging message uniquely
    mapping(address => mapping(uint => uint)) public makerNextRecentDueTime; //the pointers of a linked-list
    mapping(address => uint) public makerRDTHeadTail; //the head and tail of a linked-list

    //A maker and a taker exchange their coins
    event Exchange(address indexed maker, uint256 coinsToMaker, uint256 coinsToTaker,
               uint256 takerAddr_dueTime80);

    function getEIP712Hash(uint256 coinsToMaker, uint256 coinsToTaker, uint256 campaignID,
                   uint256 takerAddr_dueTime80) public view returns (bytes32) {
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
                takerAddr_dueTime80
            ))
        ));
    }

    // ** La usa el Taker
    function getSigner(uint256 coinsToMaker, uint256 coinsToTaker, uint256 campaignID,
              uint256 takerAddr_dueTime80_v8, bytes32 r, bytes32 s) public view returns (address) {
        bytes32 eip712Hash = getEIP712Hash(coinsToMaker, coinsToTaker, campaignID,
                           takerAddr_dueTime80_v8>>8);
        uint8 v = uint8(takerAddr_dueTime80_v8); //the lowest byte is v
        return ecrecover(eip712Hash, v, r, s);
    }

    // ** No encuentro uso
    // Returns recent recorded dueTimes of a maker
    function getRecentDueTimes(address makerAddr, uint maxCount) external view returns (uint[] memory) {
        uint head = makerRDTHeadTail[makerAddr]>>80;
        uint[] memory recentDueTimes = new uint[](maxCount);
        for(uint i=0; i<maxCount && head != 0; i++) {
            recentDueTimes[i] = head;
            head = makerNextRecentDueTime[makerAddr][head];
        }
        return recentDueTimes;
    }

    // ** Se usa para que el Maker cancele su propia orden
    // By adding a new dueTime entry in the linked-list, we can revoke a coin-exchanging message
    function addNewDueTime(uint newDueTime) external {
        require(newDueTime != 0, "invalid dueTime");
        uint currTime = block.timestamp * MUL;
        clearOldDueTimesAndInsertNew(msg.sender, newDueTime, currTime);
    }

    // ** No encuentro uso
    // Delete some useless entries from the linked list
    function clearOldDueTimes(uint maxCount, address makerAddr) external {
        uint currTime = block.timestamp * MUL;
        uint headTail = makerRDTHeadTail[makerAddr];
        (uint head, uint tail) = (headTail>>80, uint(uint80(headTail)));
        (head, tail) = _clearOldDueTimes(maxCount, makerAddr, currTime, head, tail);
        makerRDTHeadTail[makerAddr] = (head<<80) | tail;
    }

    // ** La usa el Taker
    // If a message's dueTime was recorded in the linked-list before, it is a replay and can't take effect
    function isReplay(address makerAddr, uint dueTime) external view returns (bool) {
        uint tail = uint80(makerRDTHeadTail[makerAddr]);
        return tail == dueTime || makerNextRecentDueTime[makerAddr][dueTime] != 0;
    }

    //Delete some useless entries from the linked list and insert a new one
    function clearOldDueTimesAndInsertNew(address makerAddr, uint newDueTime, uint currTime) private {
        uint headTail = makerRDTHeadTail[makerAddr];
        (uint head, uint tail) = (headTail>>80, uint(uint80(headTail)));
        require(tail != newDueTime && makerNextRecentDueTime[makerAddr][newDueTime] == 0, "dueTime not new");
        (head, tail) = _clearOldDueTimes(MaxClearCount, makerAddr, currTime, head, tail);
        (head, tail) = _addNewDueTime(makerAddr, newDueTime, head, tail);
        makerRDTHeadTail[makerAddr] = (head<<80) | tail;
    }

    // The linked-list:
    // No entries in queue: head = 0, tail = 0
    // One entry in queue: head = dueTime, tail = dueTime
    // Two entries in queue: head = A, tail = B, makerNextRecentDueTime[makerAddr][A] = B
    function _clearOldDueTimes(uint maxCount, address makerAddr, uint currTime,
                  uint head, uint tail) private returns (uint, uint) {
        for(uint i=0; i<maxCount && head<currTime && head!=0; i++) {
            uint newHead = makerNextRecentDueTime[makerAddr][head];
            makerNextRecentDueTime[makerAddr][head] = 0;
            head = newHead;
        }
        if (head == 0) {
            tail = 0;
        }
        return (head, tail);
    }

    function _addNewDueTime(address makerAddr, uint dueTime,
                  uint head, uint tail) private returns (uint, uint) {
        if (head == 0) {
            return (dueTime, dueTime);
        }
        makerNextRecentDueTime[makerAddr][tail] = dueTime;
        return (head, dueTime);
    }

    // A taker exchanges with a maker, using a message signature generated by the maker's agent
    // This function is used by https://hongbao.click
    function exchangeWithAgentSig(uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime80_v8,
                          address makerAddr, bytes32 r, bytes32 s) payable external {
        _exchange(coinsToMaker, coinsToTaker, takerAddr_dueTime80_v8, makerAddr, r, s);
    }

    // A taker exchanges with a maker, using a message signature generated by the maker
    function exchange(uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime80_v8,
               bytes32 r, bytes32 s) payable external {
        _exchange(coinsToMaker, coinsToTaker, takerAddr_dueTime80_v8, r, s);
    }

    function _exchange(uint256 coinsToMaker, uint256 coinsToTaker, uint256 takerAddr_dueTime80_v8,
               bytes32 r, bytes32 s) private {
        uint dueTime = uint80(takerAddr_dueTime80_v8>>8);
        uint currTime = block.timestamp * MUL;
        require(currTime < dueTime, "too late");

        address makerAddr = getSigner(coinsToMaker, coinsToTaker, uint(uint160(0)),
                         takerAddr_dueTime80_v8, r, s);

        clearOldDueTimesAndInsertNew(makerAddr, dueTime, currTime);
        address takerAddr = address(bytes20(uint160(takerAddr_dueTime80_v8>>(80+8))));
        if (takerAddr == address(0)) { //if taker is not specified, anyone sending tx can be the taker
            takerAddr = msg.sender;
        }
        address coinTypeToMaker = address(bytes20(uint160(coinsToMaker>>96)));
        uint coinAmountToMaker = uint(uint96(coinsToMaker));
        address coinTypeToTaker = address(bytes20(uint160(coinsToTaker>>96)));
        uint coinAmountToTaker = uint(uint96(coinsToTaker));
        emit Exchange(makerAddr, coinsToMaker, coinsToTaker, takerAddr_dueTime80_v8>>8);
        if (coinAmountToTaker != 0) {
            (bool success, bytes memory _notUsed) = coinTypeToTaker.call(
                abi.encodeWithSignature("transferFrom(address,address,uint256)",
                makerAddr, takerAddr, coinAmountToTaker));
            require(success, "transferFrom fail");
        }

        if (coinAmountToMaker != 0) {
            if (coinTypeToMaker == BCHAddress) {
                require(msg.value == coinAmountToMaker, "BCH not enough");
                (bool success, bytes memory _notUsed) = makerAddr.call{gas: 9000, value: coinAmountToMaker}("");
                require(success, "transfer fail");
            } else {
                require(msg.value == 0, "no need for BCH");
                IERC20(coinTypeToMaker).transferFrom(takerAddr, makerAddr, coinAmountToMaker);
            }
        }
    }
}
