import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber, Contract, Wallet } from "ethers"

const { TypedDataUtils } = require("ethers-eip712")
const { toUtf8Bytes } = require("ethers/lib/utils")

const MaxAmount = "0x0FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
const sep206Addr = "0x0000000000000000000000000000000000002711";
const bchAddr = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const zeroAddr = "0x0000000000000000000000000000000000000000";

const erc20ABI = [
    `function balanceOf(address owner) external view returns (uint)`,
    `function allowance(address owner, address spender) external view returns (uint)`,
    `function approve(address spender, uint value) external returns (bool)`,
]

export interface IMessage {
    coinsToMaker: string
    coinsToTaker: string
    dueTime80: string
}

describe("Limit orders tests", function () {
    let maker: Wallet
    let taker: Wallet
    let scammerWallet: Wallet
    let exchange: Contract
    let scammerContract: Contract
    let scammer2Contract: Contract
    let wBCH: Contract
    let sUSD: Contract
    let sep206: Contract

    before(async function () {
        const [acc0] = await ethers.getSigners()
        sep206 = new ethers.Contract(sep206Addr, erc20ABI, acc0.provider)
        maker = new ethers.Wallet("82c149d8f7257a6ab690d351d482de51e3540a95859a72a96ef5d744e1f69d60", acc0.provider)
        taker = new ethers.Wallet("f37a49a536c941829424a502bb4579f2ab5451c7104c8541e7797798f3daf4ec", acc0.provider)
        scammerWallet = new ethers.Wallet("9d6082c136c941829424a502bb4579f2ab5451c7104c8541e7797798f3daf4ec", acc0.provider)

        await acc0.sendTransaction({
            to: maker.address,
            value: ethers.utils.parseEther("10.0"),
        })
        await acc0.sendTransaction({
            to: taker.address,
            value: ethers.utils.parseEther("10.0"),
        })

        const Exchange = await ethers.getContractFactory("Burros")
        exchange = await Exchange.deploy(toWei("0.0005"))
        await exchange.deployed()

        const Scammer = await ethers.getContractFactory("Scammer")
        scammerContract = await Scammer.deploy()
        await scammerContract.deployed()

        const Scammer2 = await ethers.getContractFactory("Scammer2")
        scammer2Contract = await Scammer2.deploy()
        await scammer2Contract.deployed()

        const TestERC20 = await ethers.getContractFactory("TestERC20")
        wBCH = await TestERC20.deploy("wBCH", ethers.utils.parseUnits("10000000", 18), 18)
        sUSD = await TestERC20.deploy("sUSD", ethers.utils.parseUnits("10000000", 18), 18)
        await Promise.all([wBCH.deployed(), sUSD.deployed()])
    })

    // ----------------------------------------------------------------------------------------------------------------
    it("checks the refereal and feePercent set at the constructor", async function () {
        expect(await exchange.smartSwapFeePercent()).to.equal(toWei("0.0005"))
    })

    it("sets a new fee percent by the owner", async function () {
        expect(await exchange.smartSwapFeePercent()).to.equal(toWei("0.0005"))
        await exchange.connect(exchange.signer).setSmartSwapFeePercent(toWei("0.0008"));
        expect(await exchange.smartSwapFeePercent()).to.equal(toWei("0.0008"))
        await exchange.connect(exchange.signer).setSmartSwapFeePercent(toWei("0.0005"));
        expect(await exchange.smartSwapFeePercent()).to.equal(toWei("0.0005"))
    })

    it("fails when a non-owner try to set a new fee percent", async function () {
        expect(await exchange.smartSwapFeePercent()).to.equal(toWei("0.0005"))
        await expect(exchange.connect(taker).setSmartSwapFeePercent(toWei("0.0005")))
            .to.be.revertedWith("Ownable: caller is not the owner")
    })

    it("fails when try to set a new fee percent out of range", async function () {
        expect(await exchange.smartSwapFeePercent()).to.equal(toWei("0.0005"))
        await expect(exchange.connect(exchange.signer).setSmartSwapFeePercent(toWei("0.0301")))
            .to.be.revertedWith("Burros: SmartSwap feePercent out of range")
    })

    // ----------------------------------------------------------------------------------------------------------------

    it("getEIP712Hash", async function () {
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "123"),
            coinsToTaker: concatAddressUint96(sUSD.address, "456"),
            dueTime80: getDueTime(0x789),
        }

        const eip712HashSol = await getEIP712HashSol(exchange, msg)
        const eip712HashJS = getEIP712HashJS(exchange.address, msg)
        expect(eip712HashSol).to.equal(eip712HashJS)
    })

    it("getSigner", async function () {
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "123"),
            coinsToTaker: concatAddressUint96(sUSD.address, "456"),
            // dueTime80: concatAddressUint80_v8(taker.address, 0x789, 1),
            dueTime80: getDueTime(0x789),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        const signerAddr = await getSigner(exchange, msg, r, s, v)
        expect(signerAddr).to.equal(maker.address)
    })

    // ----------------------------------------------------------------------------------------------------------------
    // Check for scams
    it("does not allow an scammer contract", async function () {
        await wBCH.transfer(maker.address, toWei("10"))
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("10"))

        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            dueTime80: dueTime,
        }

        // const [r, s, v] = signRawMsg(scammerContract.address, msg, maker)
        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await wBCH.connect(maker).approve(scammerContract.address, toWei("1"))
        await sUSD.connect(taker).approve(scammerContract.address, toWei("500"))

        await expect(exch(scammerContract.connect(taker), msg, r, s, v, undefined))
            .to.be.revertedWith("Scammer: transferFrom failed")
    })

    it("will scam you if you autorize a wrong contract", async function () {
        await sUSD.transfer(taker.address, toWei("5000"))
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("10"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("5000"))

        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(scammer2Contract.address, msg, maker)

        await wBCH.connect(maker).approve(scammer2Contract.address, MaxAmount)
        await sUSD.connect(taker).approve(scammer2Contract.address, MaxAmount)

        await expect(exch(scammer2Contract.connect(taker), msg, r, s, v, undefined))
            .to.emit(scammer2Contract, "Exchange")
            .withArgs(maker.address, taker.address, sUSD.address, toWei("500"), wBCH.address, toWei("1"), dueTime)

        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("0"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("0"))
        expect(await wBCH.balanceOf(scammerWallet.address)).to.equal(toWei("10"))
        expect(await sUSD.balanceOf(scammerWallet.address)).to.equal(toWei("5000"))
    })
    // ----------------------------------------------------------------------------------------------------------------

    it("makes a wBCH -> sUSD order and then it taken properly", async function () {
        await wBCH.transfer(maker.address, toWei("10"))
        await sUSD.transfer(taker.address, toWei("5000"))
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("10"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("5000"))
        expect(await wBCH.balanceOf(exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.balanceOf(exchange.address)).to.equal(toWei("0"))

        const dueTime = getDueTime(1);

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            dueTime80: dueTime,
        }

        // https://bitcoin.stackexchange.com/questions/38351/ecdsa-v-r-s-what-is-v
        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        // console.log('rsv:', r, s, v);

        await wBCH.connect(maker).approve(exchange.address, toWei("1"))
        await sUSD.connect(taker).approve(exchange.address, toWei("500"))

        const ret = exch(exchange.connect(taker), msg, r, s, v, undefined);
        const retAw = await ret;

        await expect(ret)
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, taker.address, sUSD.address, toWei("500"), wBCH.address, toWei("1"), dueTime)

        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("9"))
        expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("1"))
        expect(await sUSD.balanceOf(maker.address)).to.equal(toWei("500"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("4500"))
        expect(await wBCH.balanceOf(exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.balanceOf(exchange.address)).to.equal(toWei("0"))
    })

    it("fails when try to take the order too late", async function () {
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            // dueTime80: concatAddressUint80_v8(taker.address, dueTime, 1),
            dueTime80: getDueTime(-1),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.be.revertedWith("Burros: order expired")
    })

    it("fails when the maker allowance is not enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("9"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("4500"))
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("0"))

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "4500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "9"),
            dueTime80: getDueTime(1),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.be.revertedWith("Burros: transferFrom fail")
    })

    it("fails when the maker balance is not enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("9"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("4500"))
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("0"))

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "4500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "10"),
            dueTime80: getDueTime(1),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await wBCH.connect(maker).approve(exchange.address, toWei("9"))
        await sUSD.connect(taker).approve(exchange.address, toWei("4500"))
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("9"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("4500"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.be.revertedWith("Burros: transferFrom fail")
    })

    it("works after changing the allowance and with proper maker balance", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("9"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("4500"))
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("9"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("4500"))
        expect(await wBCH.balanceOf(exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.balanceOf(exchange.address)).to.equal(toWei("0"))

        const dueTime = getDueTime(1);

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "4500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "9"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await wBCH.connect(maker).approve(exchange.address, toWei("9"))
        await sUSD.connect(taker).approve(exchange.address, toWei("4500"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, taker.address, sUSD.address, toWei("4500"), wBCH.address, toWei("9"), dueTime)

        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("0"))
        expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("10"))
        expect(await sUSD.balanceOf(maker.address)).to.equal(toWei("5000"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("0"))
        expect(await wBCH.balanceOf(exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.balanceOf(exchange.address)).to.equal(toWei("0"))

        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("0"))
    })

    it("makes an order the other way around (sUSD -> wBCH)", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("0"))
        expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("10"))
        expect(await sUSD.balanceOf(maker.address)).to.equal(toWei("5000"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("0"))
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("0"))

        const dueTime = getDueTime(1);

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "5"),
            coinsToTaker: concatAddressUint96(sUSD.address, "2500"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await sUSD.connect(maker).approve(exchange.address, toWei("2500"))
        await wBCH.connect(taker).approve(exchange.address, toWei("5"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, taker.address, wBCH.address, toWei("5"), sUSD.address, toWei("2500"), dueTime)

        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("5"))
        expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("5"))
        expect(await sUSD.balanceOf(maker.address)).to.equal(toWei("2500"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("2500"))
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("0"))
    })

    it("fails when the taker allowance is not enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("5"))
        expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("5"))
        expect(await sUSD.balanceOf(maker.address)).to.equal(toWei("2500"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("2500"))
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("0"))

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "1"),
            coinsToTaker: concatAddressUint96(sUSD.address, "250"),
            dueTime80: getDueTime(1),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await sUSD.connect(maker).approve(exchange.address, toWei("250"))

        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(toWei("250"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("0"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.be.revertedWith("ERC20: insufficient allowance")
    })

    it("fails when the taker balance is not enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("5"))
        expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("5"))
        expect(await sUSD.balanceOf(maker.address)).to.equal(toWei("2500"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("2500"))
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(toWei("250"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("0"))

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "6"),
            coinsToTaker: concatAddressUint96(sUSD.address, "250"),
            dueTime80: getDueTime(1),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await sUSD.connect(maker).approve(exchange.address, toWei("250"))
        await wBCH.connect(taker).approve(exchange.address, toWei("6"))
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(toWei("250"))
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(toWei("6"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.be.revertedWith("ERC20: transfer amount exceeds balance")
    })

    it("works after changing the allowance and with proper taker balance", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("5"))
        expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("5"))
        expect(await sUSD.balanceOf(maker.address)).to.equal(toWei("2500"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("2500"))
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(toWei("6"))
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(toWei("250"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("0"))

        const dueTime = getDueTime(1);

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "1"),
            coinsToTaker: concatAddressUint96(sUSD.address, "250"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, taker.address, wBCH.address, toWei("1"), sUSD.address, toWei("250"), dueTime)

        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("6"))
        expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("4"))
        expect(await sUSD.balanceOf(maker.address)).to.equal(toWei("2250"))
        expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("2750"))
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(toWei("5"))
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(toWei("0"))
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(toWei("0"))
    })

    // ----------------------------------------------------------------------------------------------------------------

    it("fails when try to use the SEP206 (BCH) address for the maker", async function () {
        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sep206Addr, "1"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await wBCH.connect(maker).approve(exchange.address, toWei("1"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, toWei("1")))
            .to.be.revertedWith("Burros: BCH is not allowed")
    })

    it("fails when try to use the SEP206 (BCH) address for the taker", async function () {
        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "1"),
            coinsToTaker: concatAddressUint96(sep206Addr, "1"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await wBCH.connect(maker).approve(exchange.address, toWei("1"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, toWei("1")))
            .to.be.revertedWith("Burros: BCH is not allowed")
    })

    it("fails when try to use the bchAddr (0xEee...) address for the maker", async function () {
        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(bchAddr, "1"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await wBCH.connect(maker).approve(exchange.address, toWei("1"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, toWei("1")))
            .to.be.revertedWith("Burros: BCH is not allowed")
    })

    it("fails when try to use the bchAddr (0xEee...) address for the taker", async function () {
        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "1"),
            coinsToTaker: concatAddressUint96(bchAddr, "1"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await wBCH.connect(maker).approve(exchange.address, toWei("1"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, toWei("1")))
            .to.be.revertedWith("Burros: BCH is not allowed")
    })

    it("fails when try to use the zeroAddr (0x000...0) address for the maker", async function () {
        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(zeroAddr, "1"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await wBCH.connect(maker).approve(exchange.address, toWei("1"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, toWei("1")))
            .to.be.revertedWith("Burros: BCH is not allowed")
    })

    it("fails when try to use the zeroAddr (0x000...0) address for the taker", async function () {
        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "1"),
            coinsToTaker: concatAddressUint96(zeroAddr, "1"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await wBCH.connect(maker).approve(exchange.address, toWei("1"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, toWei("1")))
            .to.be.revertedWith("Burros: BCH is not allowed")
    })
})

// ------------------------------------------------------------------------------
// Helper functions

function getEIP712HashSol(exchange: Contract, msg: IMessage) {
    return exchange.getEIP712Hash(msg.coinsToMaker, msg.coinsToTaker, msg.dueTime80)
}

function getSigner(exchange: Contract, msg: IMessage, r: string, s: string, v: number) {
    return exchange.getSigner(msg.coinsToMaker, msg.coinsToTaker, bnToHex((BigInt(msg.dueTime80) << 8n) | BigInt(v)), r, s)
}

function exch(exchange: Contract, msg: IMessage, r: string, s: string, v: number, bchAmount: BigNumber | number | undefined) {
    return exchange.directExchange(msg.coinsToMaker, msg.coinsToTaker, bnToHex((BigInt(msg.dueTime80) << 8n) | BigInt(v)), r, s, {
        value: bchAmount || 0,
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
            //Exchange(uint256 coinsToMaker,uint256 coinsToTaker,uint256 takerAddr_dueTime80
            Exchange: [
                { name: "coinsToMaker", type: "uint256" },
                { name: "coinsToTaker", type: "uint256" },
                { name: "dueTime80", type: "uint256" },
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

function toWei(n: string) {
    return ethers.utils.parseUnits(n, 18);
}

function concatAddressUint96(addr: string, nStr: string) {
    const n = ethers.utils.parseUnits(nStr, 18);
    return bnToHex(BigInt(addr) << 96n | BigInt(n.toString()))
}

function bnToHex(n: bigint) {
    return "0x" + n.toString(16)
}

function hexStr32(bn : BigNumber) {
    return ethers.utils.hexZeroPad(bn.toHexString(), 32);
}

function getDueTime(hs: number) {
    // const dueTime = (Date.now() + hs * 3600 * 1000) * 10 ** 12;
    // return dueTime;


    const expireDate = Date.now() + hs * 3600 * 1000;
    const expireTimestamp =  Math.floor(expireDate / 1000)
    const expireNanosecondsBN = ethers.BigNumber.from(expireTimestamp).mul(1000*1000*1000)
    var expirePicosecondsBN = expireNanosecondsBN.add(Math.floor(Math.random()*1000*1000*1000)).mul(1000)
    const order = "0x" + hexStr32(expirePicosecondsBN).substr(64+2-20)
    return order;


    // console.log("expireDate:                 ", expireDate);
    // console.log("expireTimestamp:            ", expireTimestamp);
    // console.log("expireNanosecondsBN:        ", expireNanosecondsBN);
    // console.log("expirePicosecondsBN:        ", expirePicosecondsBN);
    // console.log("expirePicosecondsBN_16:     ", hexStr32(expirePicosecondsBN));
    // console.log("expirePicosecondsBN_16_sub: ", order);


    // const now = Date.now();

    // console.log("Date.now():                 ", now);
    // console.log("(Date.now() + 1 hr:         ", (now + 1 * 3600 * 1000));

    // // const dueTime = (Date.now() + hs * 3600 * 1000) * 10 ** 12;
}

function calculateFee(amount: BigNumber, feePercent: BigNumber) {
    return amount.mul(feePercent).div(toWei("1"));
}
