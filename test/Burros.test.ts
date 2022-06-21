import { ethers } from "hardhat"
import { expect } from "chai"
import { Contract, Wallet } from "ethers"

const { TypedDataUtils } = require("ethers-eip712")
const { toUtf8Bytes } = require("ethers/lib/utils")

const bchAddr = "0x0000000000000000000000000000000000002711"
const erc20ABI = [
    `function balanceOf(address owner) external view returns (uint)`,
    `function allowance(address owner, address spender) external view returns (uint)`,
    `function approve(address spender, uint value) external returns (bool)`,
]

export interface IMessage {
    coinsToMaker: string
    coinsToTaker: string
    takerAddr_dueTime80: string
}

describe("Burros", function () {
    let maker: Wallet
    let taker: Wallet
    let exchange: Contract
    let wBCH: Contract
    let fUSD: Contract
    let bch: Contract

    before(async function () {
        const [acc0] = await ethers.getSigners()
        bch = new ethers.Contract(bchAddr, erc20ABI, acc0.provider)
        maker = new ethers.Wallet("82c149d8f7257a6ab690d351d482de51e3540a95859a72a96ef5d744e1f69d60", acc0.provider)
        taker = new ethers.Wallet("f37a49a536c941829424a502bb4579f2ab5451c7104c8541e7797798f3daf4ec", acc0.provider)
        await acc0.sendTransaction({
            to: maker.address,
            value: ethers.utils.parseEther("10.0"),
        })
        await acc0.sendTransaction({
            to: taker.address,
            value: ethers.utils.parseEther("10.0"),
        })

        const Exchange = await ethers.getContractFactory("Burros")
        const exchange = await Exchange.deploy()
        await exchange.deployed()

        const TestERC20 = await ethers.getContractFactory("TestERC20")
        wBCH = await TestERC20.deploy("wBCH", ethers.utils.parseUnits("10000000", 18), 18)
        fUSD = await TestERC20.deploy("fUSD", ethers.utils.parseUnits("10000000", 18), 18)
        await Promise.all([wBCH.deployed(), fUSD.deployed()])
    })

    it("getEIP712Hash", async function () {
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, 0x123),
            coinsToTaker: concatAddressUint96(fUSD.address, 0x456),
            takerAddr_dueTime80: concatAddressUint80(taker.address, 0x789),
        }

        const eip712HashSol = await getEIP712HashSol(exchange, msg)
        const eip712HashJS = getEIP712HashJS(exchange.address, msg)
        expect(eip712HashSol).to.equal(eip712HashJS)
    })

    it("getSigner", async function () {
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, 0x123),
            coinsToTaker: concatAddressUint96(fUSD.address, 0x456),
            takerAddr_dueTime80: concatAddressUint80(taker.address, 0x789),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        const signerAddr = await getSigner(exchange, msg, r, s, v)
        expect(signerAddr).to.equal(maker.address)
    })

    // --------------

    it("getMaker", async function () {
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, 0x123),
            coinsToTaker: concatAddressUint96(fUSD.address, 0x456),
            takerAddr_dueTime80: concatAddressUint80(taker.address, 0x789),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        // console.log('rsv:', r, s, v);
        const makerAddr = await getMaker(exchange, msg, r, s, v)
        // console.log('makerAddr:', makerAddr);
        expect(makerAddr).to.equal(maker.address)
    })

    it("exchange:ok", async function () {
        await wBCH.transfer(maker.address, 10)
        await fUSD.transfer(taker.address, 5000)
        expect(await wBCH.balanceOf(maker.address)).to.equal(10)
        expect(await fUSD.balanceOf(taker.address)).to.equal(5000)

        const dueTime = (Date.now() + 3600 * 1000) * 10 ** 6
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(fUSD.address, 500),
            coinsToTaker: concatAddressUint96(wBCH.address, 1),
            takerAddr_dueTime80: concatAddressUint80(taker.address, dueTime),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        // console.log('rsv:', r, s, v);

        await wBCH.connect(maker).approve(exchange.address, 1)
        await fUSD.connect(taker).approve(exchange.address, 500)
        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, msg.coinsToMaker, msg.coinsToTaker, msg.takerAddr_dueTime80)

        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await wBCH.balanceOf(taker.address)).to.equal(1)
        expect(await fUSD.balanceOf(taker.address)).to.equal(4500)
        expect(await fUSD.balanceOf(maker.address)).to.equal(500)
    })

    it("exchange:out-of-date", async function () {
        const dueTime = (Date.now() - 1) * 10 ** 6
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(fUSD.address, 500),
            coinsToTaker: concatAddressUint96(wBCH.address, 1),
            takerAddr_dueTime80: concatAddressUint80(taker.address, dueTime),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("too late")
    })

    it("exchange:wrong-taker", async function () {
        const dueTime = (Date.now() + 3600 * 1000) * 10 ** 6
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(fUSD.address, 500),
            coinsToTaker: concatAddressUint96(wBCH.address, 1),
            takerAddr_dueTime80: concatAddressUint80(taker.address, dueTime),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(maker), msg, r, s, v, undefined)).to.be.revertedWith("taker mismatch")
    })

    it("exchange:erc20-taker-amt-not-enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await fUSD.balanceOf(taker.address)).to.equal(4500)

        const dueTime = (Date.now() + 3600 * 1000) * 10 ** 6
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(fUSD.address, 5000),
            coinsToTaker: concatAddressUint96(wBCH.address, 10),
            takerAddr_dueTime80: concatAddressUint80(taker.address, dueTime),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("transferFrom fail")
    })

    it("exchange:erc20-taker-allowance-not-enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await fUSD.balanceOf(taker.address)).to.equal(4500)

        const dueTime = (Date.now() + 3600 * 1000) * 10 ** 6
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(fUSD.address, 4500),
            coinsToTaker: concatAddressUint96(wBCH.address, 10),
            takerAddr_dueTime80: concatAddressUint80(taker.address, dueTime),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("transferFrom fail")
    })

    it("exchange:erc20-maker-amt-not-enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await fUSD.balanceOf(taker.address)).to.equal(4500)

        const dueTime = (Date.now() + 3600 * 1000) * 10 ** 6
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(fUSD.address, 4500),
            coinsToTaker: concatAddressUint96(wBCH.address, 10),
            takerAddr_dueTime80: concatAddressUint80(taker.address, dueTime),
        }

        await fUSD.connect(taker).approve(exchange.address, 4500)
        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("transferFrom fail")
    })

    it("exchange:erc20-maker-allowance-not-enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await fUSD.balanceOf(taker.address)).to.equal(4500)

        const dueTime = (Date.now() + 3600 * 1000) * 10 ** 6
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(fUSD.address, 4500),
            coinsToTaker: concatAddressUint96(wBCH.address, 8),
            takerAddr_dueTime80: concatAddressUint80(taker.address, dueTime),
        }

        await fUSD.connect(taker).approve(exchange.address, 4500)
        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("transferFrom fail")
    })

    it("exchange:bch-to-maker", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await wBCH.balanceOf(taker.address)).to.equal(1)

        const dueTime = (Date.now() + 3600 * 1000) * 10 ** 6
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(bchAddr, 1),
            coinsToTaker: concatAddressUint96(wBCH.address, 1),
            takerAddr_dueTime80: concatAddressUint80(taker.address, dueTime),
        }
        // console.log(msg);

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        // console.log('rsv:', r, s, v);
        await wBCH.connect(maker).approve(exchange.address, 1)

        const makerBalance0 = await ethers.provider.getBalance(maker.address)
        await exch(exchange.connect(taker), msg, r, s, v, 1) // TODO
        const makerBalance1 = await ethers.provider.getBalance(maker.address)

        expect(await wBCH.balanceOf(maker.address)).to.equal(8)
        expect(await wBCH.balanceOf(taker.address)).to.equal(2)
        expect(makerBalance1.sub(makerBalance0)).to.equal(1)
    })

    it("exchange:bch-to-taker", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(8)
        expect(await wBCH.balanceOf(taker.address)).to.equal(2)

        const dueTime = (Date.now() + 3600 * 1000) * 10 ** 6
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, 1),
            coinsToTaker: concatAddressUint96(bchAddr, 1),
            takerAddr_dueTime80: concatAddressUint80(taker.address, dueTime),
        }
        // console.log(msg);

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        // console.log('rsv:', r, s, v);

        await bch.connect(maker).approve(exchange.address, 1)
        await wBCH.connect(taker).approve(exchange.address, 1)

        const takerBalance0 = await ethers.provider.getBalance(taker.address)
        const tx = await exch(exchange.connect(taker), msg, r, s, v, undefined)
        const receipt = await tx.wait()
        console.log(tx)
        const takerBalance1 = await ethers.provider.getBalance(taker.address)
        console.log(takerBalance0)
        console.log(takerBalance1)
        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await wBCH.balanceOf(taker.address)).to.equal(1)
        //expect(takerBalance1.sub(takerBalance0)).to.equal(1); // TODO
    })
})

function getEIP712HashSol(exchange: Contract, msg: IMessage) {
    return exchange.getEIP712Hash(msg.coinsToMaker, msg.coinsToTaker, msg.takerAddr_dueTime80)
}
function getSigner(exchange: Contract, msg: IMessage, r: string, s: string, v: number) {
    return exchange.getSigner(msg.coinsToMaker, msg.coinsToTaker, bnToHex((BigInt(msg.takerAddr_dueTime80) << 8n) | BigInt(v)), r, s)
}

function getMaker(exchange: Contract, msg: IMessage, r: string, s: string, v: number) {
    return exchange.getMaker(msg.coinsToMaker, msg.coinsToTaker, bnToHex((BigInt(msg.takerAddr_dueTime80) << 8n) | BigInt(v)), r, s)
}

function exch(exchange: Contract, msg: IMessage, r: string, s: string, v: number, bch: number | undefined) {
    return exchange.exchange(msg.coinsToMaker, msg.coinsToTaker, bnToHex((BigInt(msg.takerAddr_dueTime80) << 8n) | BigInt(v)), r, s, {
        value: bch || 0,
    })
}

function signRawMsg(verifyingContractAddr: string, msg: IMessage, signer: Wallet): [string, string, number] {
    const digest = TypedDataUtils.encodeDigest(getTypedData(verifyingContractAddr, msg))
    const signature = signer._signingKey().signDigest(digest)
    return [signature.r, signature.s, signature.v]
}

function getEIP712HashJS(verifyingContractAddr: string, msg: IMessage) {
    return ethers.utils.hexlify(TypedDataUtils.encodeDigest(getTypedData(verifyingContractAddr, msg)))
}

function getTypedData(verifyingContractAddr: string, msg: IMessage) {
    return {
        types: {
            EIP712Domain: [
                { name: "name", type: "string" },
                { name: "version", type: "string" },
                { name: "chainId", type: "uint256" },
                { name: "verifyingContract", type: "address" },
                { name: "salt", type: "bytes32" },
            ],
            //Exchange(uint256 coinsToMaker,uint256 coinsToTaker,uint256 campaignID,uint256 takerAddr_dueTime80
            Exchange: [
                { name: "coinsToMaker", type: "uint256" },
                { name: "coinsToTaker", type: "uint256" },
                { name: "campaignID", type: "uint256" },
                { name: "takerAddr_dueTime80", type: "uint256" },
            ],
        },
        primaryType: "Exchange",
        domain: {
            name: "exchange dapp",
            version: "v0.1.0",
            chainId: 10000,
            verifyingContract: verifyingContractAddr,
            salt: ethers.utils.id("Exchange"),
        },
        message: msg,
    }
}

function concatAddressUint96(addr: string, n: number) {
    return bnToHex((BigInt(addr) << 96n) | BigInt(n))
}
function concatAddressUint80(addr: string, n: number) {
    return bnToHex((BigInt(addr) << 80n) | BigInt(n))
}
function bnToHex(n: bigint) {
    return "0x" + n.toString(16)
}
// function concatAddressUint64(addr, n) {
//   return bnToHex(BigInt(addr) << 64n | BigInt(n));
// }
// function bnToHex(n) {
//   return '0x' + n.toString(16);
// }
