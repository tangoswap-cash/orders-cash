const { expect } = require("chai");
const { ethers } = require("hardhat");
const { TypedDataUtils } = require('ethers-eip712');
const {toUtf8Bytes} = require("ethers/lib/utils");

const bchAddr = '0x0000000000000000000000000000000000002711';
const erc20ABI = [
    `function balanceOf(address owner) external view returns (uint)`,
    `function allowance(address owner, address spender) external view returns (uint)`,
    `function approve(address spender, uint value) external returns (bool)`
]

describe("Burros", function () {

    let maker, taker;
    let exchange;
    let wBCH, fUSD;
    let bch;

    before(async function () {
        const [acc0] = await ethers.getSigners();
        bch = new ethers.Contract(bchAddr, erc20ABI, acc0.provider);
        maker = new ethers.Wallet('82c149d8f7257a6ab690d351d482de51e3540a95859a72a96ef5d744e1f69d60', acc0.provider);
        taker = new ethers.Wallet('f37a49a536c941829424a502bb4579f2ab5451c7104c8541e7797798f3daf4ec', acc0.provider);
        await acc0.sendTransaction({to: maker.address, value: ethers.utils.parseEther("10.0")});
        await acc0.sendTransaction({to: taker.address, value: ethers.utils.parseEther("10.0")});

        const Exchange = await ethers.getContractFactory("Burros");
        exchange = await Exchange.deploy();
        await exchange.deployed();

        const TestERC20 = await ethers.getContractFactory("TestERC20");
        wBCH = await TestERC20.deploy('wBCH', ethers.utils.parseUnits('10000000', 18), 18);
        fUSD = await TestERC20.deploy('fUSD', ethers.utils.parseUnits('10000000', 18), 18);
        await Promise.all([wBCH.deployed(), fUSD.deployed()]);
    });

    it("getEIP712Hash", async function () {
        const msg = {
            coinsToMaker: concatAddressUint96(wBCH.address, 0x123),
            coinsToTaker: concatAddressUint96(fUSD.address, 0x456),
            campaignID: 1,
            takerAddr_dueTime80: concatAddressUint80(taker.address, 0x789),
        }

        const eip712HashSol = await getEIP712HashSol(exchange, msg);
        const eip712HashJS = getEIP712HashJS(exchange.address, msg);
        expect(eip712HashSol).to.equal(eip712HashJS);
    });

    it("getSigner", async function () {
        const msg = {
            coinsToMaker: concatAddressUint96(wBCH.address, 0x123),
            coinsToTaker: concatAddressUint96(fUSD.address, 0x456),
            campaignID: 1,
            takerAddr_dueTime80: concatAddressUint80(taker.address, 0x789),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker);
        const signerAddr = await getSigner(exchange, msg, r, s, v);
        expect(signerAddr).to.equal(maker.address);
    });

    it("Campaign:ok", async function () {
        const totalCoinsToTaker = concatAddressUint96(wBCH.address, 5);
        const tx = await exchange.connect(taker).startCampaign(Date.now() + 3600 * 1000, totalCoinsToTaker, toUtf8Bytes("hello"));
        const receipt = await tx.wait();
        const campaignID = receipt.events[0].args.campaignID;
        const takerAddr_startEndTime = receipt.events[0].args.takerAddr_startEndTime;
        const introHash = receipt.events[0].args.introHash;
        const dueTime = (Date.now() + 3600 * 1000) * (10**9);
        const msg = {
            coinsToMaker: bnToHex(0n),
            coinsToTaker: concatAddressUint96(wBCH.address, 5),
            campaignID: campaignID.toString(),
            takerAddr_dueTime80: concatAddressUint80(taker.address, dueTime),
        }
        const [r, s, v] = signRawMsg(exchange.address, msg, maker);
        const amount_dueTime80_v8 = 5n << 88n | BigInt(dueTime) << 8n | BigInt(v);
        await exchange.connect(maker).donate(msg.campaignID, amount_dueTime80_v8, r, s, "");
        const donations = [];
        donations.push({
            "amount_dueTime80_v8": amount_dueTime80_v8,
            "r": r,
            "s": s
        });
        await wBCH.transfer(maker.address, 5);
        await wBCH.connect(maker).approve(exchange.address, 5);
        await exchange.connect(taker).endCampaign(takerAddr_startEndTime, totalCoinsToTaker, introHash, donations);
        expect(await wBCH.balanceOf(taker.address)).to.equal(5);
    });
});

function getEIP712HashSol(exchange, msg) {
    return exchange.getEIP712Hash(
        msg.coinsToMaker,
        msg.coinsToTaker,
        msg.campaignID,
        msg.takerAddr_dueTime80,
    );
}
function getSigner(exchange, msg, r, s, v) {
    return exchange.getSigner(
        msg.coinsToMaker,
        msg.coinsToTaker,
        msg.campaignID,
        bnToHex(BigInt(msg.takerAddr_dueTime80) << 8n | BigInt(v)),
        r, s,
    );
}

function signRawMsg(verifyingContractAddr, msg, signer) {
    const digest = TypedDataUtils.encodeDigest(getTypedData(verifyingContractAddr, msg));
    const signature = signer._signingKey().signDigest(digest);
    return [signature.r, signature.s, signature.v];
}

function getEIP712HashJS(verifyingContractAddr, msg) {
    return ethers.utils.hexlify(TypedDataUtils.encodeDigest(getTypedData(verifyingContractAddr, msg)));
}

function getTypedData(verifyingContractAddr, msg) {
    return {
        types: {
            EIP712Domain: [
                {name: "name", type: "string"},
                {name: "version", type: "string"},
                {name: "chainId", type: "uint256"},
                {name: "verifyingContract", type: "address"},
                {name: "salt", type: "bytes32"},
            ],
            //Exchange(uint256 coinsToMaker,uint256 coinsToTaker,uint256 campaignID,uint256 takerAddr_dueTime80
            Exchange: [
                { name: "coinsToMaker", type: "uint256" },
                { name: "coinsToTaker", type: "uint256" },
                { name: "campaignID", type: "uint256" },
                { name: "takerAddr_dueTime80", type: "uint256" },
            ]
        },
        primaryType: 'Exchange',
        domain: {
            name: "exchange dapp",
            version: "v0.1.0",
            chainId: 10000,
            verifyingContract: verifyingContractAddr,
            salt: ethers.utils.id("Exchange"),
        },
        message: msg,
    };
}

function concatAddressUint96(addr, n) {
    return bnToHex(BigInt(addr) << 96n | BigInt(n));
}
function concatAddressUint80(addr, n) {
    return bnToHex(BigInt(addr) << 80n | BigInt(n));
}
function bnToHex(n) {
    return '0x' + n.toString(16);
}