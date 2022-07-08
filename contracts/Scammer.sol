// SPDX-License-Identifier: Apache
pragma solidity 0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./UniversalERC20.sol";

import "hardhat/console.sol";

contract Scammer {
    using SafeMath for uint256;
    using UniversalERC20 for IERC20;

    address private constant SEP206Addr = 0x0000000000000000000000000000000000002711;
    address private constant BCH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address private constant ZERO_ADDRESS = 0x0000000000000000000000000000000000000000;

    string private constant EIP712_DOMAIN = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)";
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(abi.encodePacked(EIP712_DOMAIN));
    bytes32 private constant NAME_HASH = keccak256(abi.encodePacked("exchange dapp"));
    bytes32 private constant VERSION_HASH = keccak256(abi.encodePacked("v0.1.0"));
    uint256 private constant CHAINID = 10000; // smartBCH mainnet
    bytes32 private constant SALT = keccak256(abi.encodePacked("Exchange"));

    // bytes32 private constant TYPE_HASH =
    //     keccak256(abi.encodePacked("Exchange(uint256 coinsToMaker,uint256 coinsToTaker,uint256 takerAddr_dueTime80)"));

    bytes32 private constant TYPE_HASH =
        keccak256(abi.encodePacked("Exchange(uint256 coinsToMaker,uint256 coinsToTaker,uint256 dueTime80)"));

    uint256 private constant MUL = 10**12; // number of picoseconds in one second
    uint256 private constant MaxClearCount = 10;

    address public referral;
    uint256 public feePercent;

    //To prevent replay of coin-exchanging messages, we use dueTime to identify a coin-exchanging message uniquely
    mapping(address => mapping(uint256 => uint256)) public makerNextRecentDueTime; //the pointers of a linked-list
    mapping(address => uint256) public makerRDTHeadTail; //the head and tail of a linked-list

    //A maker and a taker exchange their coins
    event Exchange(address indexed maker, address indexed taker, address coinTypeToMaker, uint256 coinAmountToMaker, address coinTypeToTaker, uint256 coinAmountToTaker, uint256 dueTime80);
    // event Exchange(address indexed maker, address indexed taker, address coinTypeToMaker, uint256 coinAmountToMaker, address coinTypeToTaker, uint256 coinAmountToTaker);
    event ReferralUpdated(address indexed newReferral);
    event FeePercentUpdated(uint256 feePercent);

    constructor(address _referral, uint256 _feePercent) public {
        setNewReferral(_referral);
        setNewFeePercent(_feePercent);
    }

    function setNewReferral(address _referral) public onlyOwner {
        referral = _referral;
        emit ReferralUpdated(referral);
    }

    function setNewFeePercent(uint256 _feePercent) public onlyOwner {
        require(_feePercent >= 0.0005e18 && _feePercent <= 0.03e18, "Burros: feePercent out of range");
        feePercent = _feePercent;
        emit FeePercentUpdated(feePercent);
    }

    function isBCH(address tokenAddr) internal pure returns(bool) {
        return (tokenAddr == ZERO_ADDRESS || tokenAddr == BCH_ADDRESS || tokenAddr == SEP206Addr);
    }

    function getEIP712Hash(
        uint256 coinsToMaker,
        uint256 coinsToTaker,
        uint256 dueTime80
    ) public view returns (bytes32) {
        bytes32 DOMAIN_SEPARATOR = keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, CHAINID, address(this), SALT));
        return
            keccak256(
                abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, keccak256(abi.encode(TYPE_HASH, coinsToMaker, coinsToTaker, dueTime80)))
            );
    }

    // ** La usa el Taker
    function getSigner(
        uint256 coinsToMaker,
        uint256 coinsToTaker,
        uint256 dueTime80_v8,
        bytes32 r,
        bytes32 s
    ) public view returns (address) {
        bytes32 eip712Hash = getEIP712Hash(coinsToMaker, coinsToTaker, dueTime80_v8 >> 8);
        uint8 v = uint8(dueTime80_v8); //the lowest byte is v
        return ecrecover(eip712Hash, v, r, s);
    }

    // ** No encuentro uso
    // Returns recent recorded dueTimes of a maker
    function getRecentDueTimes(address makerAddr, uint256 maxCount) external view returns (uint256[] memory) {
        uint256 head = makerRDTHeadTail[makerAddr] >> 80;
        uint256[] memory recentDueTimes = new uint256[](maxCount);
        for (uint256 i = 0; i < maxCount && head != 0; ++i) {
            recentDueTimes[i] = head;
            head = makerNextRecentDueTime[makerAddr][head];
        }
        return recentDueTimes;
    }

    // ** Se usa para que el Maker cancele su propia orden
    // By adding a new dueTime entry in the linked-list, we can revoke a coin-exchanging message
    function addNewDueTime(uint256 newDueTime) external {
        require(newDueTime != 0, "Burros: invalid dueTime");
        uint256 currTime = block.timestamp * MUL;
        clearOldDueTimesAndInsertNew(msg.sender, newDueTime, currTime);
    }

    // ** No encuentro uso
    // Delete some useless entries from the linked list
    function clearOldDueTimes(uint256 maxCount, address makerAddr) external {
        uint256 currTime = block.timestamp * MUL;
        uint256 headTail = makerRDTHeadTail[makerAddr];
        (uint256 head, uint256 tail) = (headTail >> 80, uint256(uint80(headTail)));
        (head, tail) = _clearOldDueTimes(maxCount, makerAddr, currTime, head, tail);
        makerRDTHeadTail[makerAddr] = (head << 80) | tail;
    }

    // ** La usa el Taker
    // If a message's dueTime was recorded in the linked-list before, it is a replay and can't take effect
    function isReplay(address makerAddr, uint256 dueTime) external view returns (bool) {
        uint256 tail = uint80(makerRDTHeadTail[makerAddr]);
        return tail == dueTime || makerNextRecentDueTime[makerAddr][dueTime] != 0;
    }

    //Delete some useless entries from the linked list and insert a new one
    function clearOldDueTimesAndInsertNew(
        address makerAddr,
        uint256 newDueTime,
        uint256 currTime
    ) private {
        uint256 headTail = makerRDTHeadTail[makerAddr];
        (uint256 head, uint256 tail) = (headTail >> 80, uint256(uint80(headTail)));
        require(tail != newDueTime && makerNextRecentDueTime[makerAddr][newDueTime] == 0, "Burros: dueTime not new");

        (head, tail) = _clearOldDueTimes(MaxClearCount, makerAddr, currTime, head, tail);
        (head, tail) = _addNewDueTime(makerAddr, newDueTime, head, tail);
        makerRDTHeadTail[makerAddr] = (head << 80) | tail;
    }

    // The linked-list:
    // No entries in queue: head = 0, tail = 0
    // One entry in queue: head = dueTime, tail = dueTime
    // Two entries in queue: head = A, tail = B, makerNextRecentDueTime[makerAddr][A] = B
    function _clearOldDueTimes(
        uint256 maxCount,
        address makerAddr,
        uint256 currTime,
        uint256 head,
        uint256 tail
    ) private returns (uint256, uint256) {
        for (uint256 i = 0; i < maxCount && head < currTime && head != 0; ++i) {
            uint256 newHead = makerNextRecentDueTime[makerAddr][head];
            makerNextRecentDueTime[makerAddr][head] = 0;
            head = newHead;
        }

        if (head == 0) {
            tail = 0;
        }

        return (head, tail);
    }

    function _addNewDueTime(
        address makerAddr,
        uint256 dueTime,
        uint256 head,
        uint256 tail
    ) private returns (uint256, uint256) {
        if (head == 0) {
            return (dueTime, dueTime);
        }

        makerNextRecentDueTime[makerAddr][tail] = dueTime;
        return (head, dueTime);
    }

    // A taker exchanges with a maker, using a message signature generated by the maker
    function exchange(
        uint256 coinsToMaker,
        uint256 coinsToTaker,
        uint256 dueTime80_v8,
        bytes32 r,
        bytes32 s
    ) external payable {
        _exchange(coinsToMaker, coinsToTaker, dueTime80_v8, r, s);
    }

    // 0x
    // 9fe46736679d2d9a65f0992f2272de9f3c7fa6e0
    function _exchange(
        uint256 coinsToMaker,
        uint256 coinsToTaker,
        uint256 dueTime80_v8,
        bytes32 r,
        bytes32 s
    ) private {
        uint256 dueTime = uint80(dueTime80_v8 >> 8);
        uint256 currTime = block.timestamp * MUL;
        require(currTime < dueTime, "Burros: order expired");

        address makerAddr = getSigner(coinsToMaker, coinsToTaker, dueTime80_v8, r, s);

        clearOldDueTimesAndInsertNew(makerAddr, dueTime, currTime);
        address takerAddr = msg.sender;

        address coinTypeToMaker = address(bytes20(uint160(coinsToMaker >> 96)));
        uint256 coinAmountToMaker = uint256(uint96(coinsToMaker));
        address coinTypeToTaker = address(bytes20(uint160(coinsToTaker >> 96)));
        uint256 coinAmountToTaker = uint256(uint96(coinsToTaker));

        require( ! isBCH(coinTypeToMaker), "Burros: BCH is not allowed");
        require( ! isBCH(coinTypeToTaker), "Burros: BCH is not allowed");

        emit Exchange(makerAddr, takerAddr, coinTypeToMaker, coinAmountToMaker, coinTypeToTaker, coinAmountToTaker, dueTime);

        if (coinAmountToTaker != 0) {
            uint256 beforeBalance = IERC20(coinTypeToTaker).universalBalanceOf(address(this));

            (bool success, bytes memory _notUsed) = coinTypeToTaker.call(
                abi.encodeWithSignature("transferFrom(address,address,uint256)", makerAddr, address(this), coinAmountToTaker)
            );
            require(success, "Burros: transferFrom failed");

            coinAmountToTaker = IERC20(coinTypeToTaker).universalBalanceOf(address(this)).sub(beforeBalance);

            uint256 feeAmountReferral = coinAmountToTaker.mul(feePercent).div(1e18);
            IERC20(coinTypeToTaker).universalTransfer(referral, feeAmountReferral);

            coinAmountToTaker = IERC20(coinTypeToTaker).universalBalanceOf(address(this)).sub(beforeBalance);
            IERC20(coinTypeToTaker).universalTransfer(takerAddr, coinAmountToTaker);

            // ------------------------------------------------------------------------------------------------
            // (bool success, bytes memory _notUsed) = coinTypeToTaker.call(
            //     abi.encodeWithSignature("transferFrom(address,address,uint256)", makerAddr, takerAddr, coinAmountToTaker)
            // );
            // require(success, "Burros: transferFrom failed");
        }

        if (coinAmountToMaker != 0) {
            require(msg.value == 0, "Burros: no need for BCH");
            IERC20(coinTypeToMaker).transferFrom(takerAddr, makerAddr, coinAmountToMaker);
        }
    }
}
