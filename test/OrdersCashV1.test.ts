import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber, Contract, Wallet } from "ethers"

const { TypedDataUtils } = require("ethers-eip712")
const { toUtf8Bytes } = require("ethers/lib/utils")

const MaxAmount = "0x0FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
const sep206Addr = "0x0000000000000000000000000000000000002711";
const bchAddr = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const zeroAddr = "0x0000000000000000000000000000000000000000";

// const BCHAddress = '0x0000000000000000000000000000000000000000';

const erc20ABI = [
    `function balanceOf(address owner) external view returns (uint)`,
    `function allowance(address owner, address spender) external view returns (uint)`,
    `function approve(address spender, uint value) external returns (bool)`,
    `function transfer(address to, uint256 amount) external returns (bool)`,
]

const IWETHABI = [
    ...erc20ABI,
    `function deposit() external payable`,
    `function withdraw(uint256 amount) external`,
]

export interface IMessage {
    coinsToMaker: string
    coinsToTaker: string
    dueTime80: string
}

describe("Limit orders without SmartSwap tests", function () {
    // this.timeout(30000000);
    let maker: Wallet
    let taker: Wallet
    let scammerWallet: Wallet
    let exchange: Contract
    let scammerContract: Contract
    let scammer2Contract: Contract

    let wBCH: Contract
    let sUSD: Contract
    let TANGO: Contract
    let ARG: Contract
    let KTH: Contract

    let sep206: Contract

    let BCH = {address: zeroAddr};

    before(async function () {
        const [acc0] = await ethers.getSigners()
        sep206 = new ethers.Contract(sep206Addr, erc20ABI, acc0.provider)

        maker = new ethers.Wallet("82c149d8f7257a6ab690d351d482de51e3540a95859a72a96ef5d744e1f69d60", acc0.provider)
        taker = new ethers.Wallet("f37a49a536c941829424a502bb4579f2ab5451c7104c8541e7797798f3daf4ec", acc0.provider)
        scammerWallet = new ethers.Wallet("9d6082c136c941829424a502bb4579f2ab5451c7104c8541e7797798f3daf4ec", acc0.provider)

        await acc0.sendTransaction({
            to: maker.address,
            value: ethers.utils.parseEther("30.0"),
        })
        await acc0.sendTransaction({
            to: taker.address,
            value: ethers.utils.parseEther("30.0"),
        })

        const Exchange = await ethers.getContractFactory("OrdersCashV1")
        exchange = await Exchange.deploy()
        await exchange.deployed()

        const Scammer = await ethers.getContractFactory("Scammer")
        scammerContract = await Scammer.deploy()
        await scammerContract.deployed()

        const Scammer2 = await ethers.getContractFactory("Scammer2")
        scammer2Contract = await Scammer2.deploy()
        await scammer2Contract.deployed()

        // wBCH = new ethers.Contract('0x3743eC0673453E5009310C727Ba4eaF7b3a1cc04', IWETHABI, acc0.provider)
        // // sUSD = new ethers.Contract('0x7b2B3C5308ab5b2a1d9a94d20D35CCDf61e05b72', erc20ABI, acc0.provider)   // FlexUSD
        // sUSD = new ethers.Contract('0xBc2F884680c95A02cea099dA2F524b366d9028Ba', erc20ABI, acc0.provider)   // BCUSDT
        // TANGO = new ethers.Contract('0x73BE9c8Edf5e951c9a0762EA2b1DE8c8F38B5e91', erc20ABI, acc0.provider)
        // ARG = new ethers.Contract('0x675E1d6FcE8C7cC091aED06A68D079489450338a', erc20ABI, acc0.provider)
        // KTH = new ethers.Contract('0xc70c7718C7f1CCd906534C2c4a76914173EC2c44', erc20ABI, acc0.provider)
        // Wrap BCH
        // await wBCH.connect(maker).deposit({value: ethers.utils.parseEther("20.0")});
        // await wBCH.connect(taker).deposit({value: ethers.utils.parseEther("20.0")});

        const TestERC20 = await ethers.getContractFactory("TestERC20")
        wBCH = await TestERC20.deploy("wBCH", ethers.utils.parseUnits("10000000", 18), 18)
        sUSD = await TestERC20.deploy("sUSD", ethers.utils.parseUnits("10000000", 18), 18)
        TANGO = await TestERC20.deploy("TANGO", ethers.utils.parseUnits("10000000", 18), 18)
        ARG = await TestERC20.deploy("ARG", ethers.utils.parseUnits("10000000", 18), 18)
        KTH = await TestERC20.deploy("KTH", ethers.utils.parseUnits("10000000", 18), 18)
        await Promise.all([wBCH.deployed(), sUSD.deployed(), TANGO.deployed(), ARG.deployed(), KTH.deployed()])

        console.log("Maker wBCH:  ", (await wBCH.balanceOf(maker.address)).toString());
        console.log("Maker sUSD:  ", (await sUSD.balanceOf(maker.address)).toString());
        console.log("Maker TANGO: ", (await TANGO.balanceOf(maker.address)).toString());

        console.log("Taker wBCH:  ", (await wBCH.balanceOf(taker.address)).toString());
        console.log("Taker sUSD:  ", (await sUSD.balanceOf(taker.address)).toString());
        console.log("Taker TANGO: ", (await TANGO.balanceOf(taker.address)).toString());
    })

    // ----------------------------------------------------------------------------------------------------------------
    it("checks initial balances", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("0"))
        expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("0"))

        expect(await sUSD.balanceOf(taker.address)).to.be.gte(toWei("0"))
        expect(await TANGO.balanceOf(taker.address)).to.be.gte(toWei("0"))

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
        const signerAddr = await getSigner(exchange, msg, r, s, v, 1)
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

        await expect(exch(scammerContract.connect(taker), msg, r, s, v, 1, undefined))
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

        await expect(exch(scammer2Contract.connect(taker), msg, r, s, v, 1, undefined))
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

        const ret = exch(exchange.connect(taker), msg, r, s, v, 1, undefined);
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
            dueTime80: getDueTime(-1),
        }

        // console.log("--------------------------------------");
        // console.log(msg.dueTime80)
        // console.log("--------------------------------------");

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, undefined))
            .to.be.revertedWith("OrdersCashV1: order expired")
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
        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, undefined))
            .to.be.revertedWith("OrdersCashV1: transferFrom fail")
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, undefined))
            .to.be.revertedWith("OrdersCashV1: transferFrom fail")
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, undefined))
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, undefined))
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, undefined))
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, undefined))
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, undefined))
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, toWei("1")))
            .to.be.revertedWith("OrdersCashV1: BCH is not allowed")
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, toWei("1")))
            .to.be.revertedWith("OrdersCashV1: BCH is not allowed")
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, toWei("1")))
            .to.be.revertedWith("OrdersCashV1: BCH is not allowed")
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, toWei("1")))
            .to.be.revertedWith("OrdersCashV1: BCH is not allowed")
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, toWei("1")))
            .to.be.revertedWith("OrdersCashV1: BCH is not allowed")
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

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, toWei("1")))
            .to.be.revertedWith("OrdersCashV1: BCH is not allowed")
    })
    // ----------------------------------------------------------------------------------------------------------------

    it("fails when try to use a wrong version number", async function () {
        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "1"),
            coinsToTaker: concatAddressUint96(sUSD.address, "1"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await wBCH.connect(maker).approve(exchange.address, toWei("1"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, 2, toWei("1")))
            .to.be.revertedWith("OrdersCashV1: version does not match")
    })
    // ----------------------------------------------------------------------------------------------------------------

    it("fails when try to use both same tokens", async function () {
        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, "1"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await wBCH.connect(maker).approve(exchange.address, toWei("1"))

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, toWei("1")))
            .to.be.revertedWith("OrdersCashV1: both tokens are the same")
    })
    // ----------------------------------------------------------------------------------------------------------------

    // TODO: create several orders, cancel 1

    it("makes an order, cancel it and fails when try to take it", async function () {
        const dueTime1 = getDueTime(1);
        const dueTime2 = getDueTime(1);

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            dueTime80: dueTime1,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await wBCH.connect(maker).approve(exchange.address, toWei("1"))
        await sUSD.connect(taker).approve(exchange.address, toWei("500"))

        await expect(exchange.connect(maker).addNewDueTime(0))
            .to.be.revertedWith("OrdersCashV1: invalid dueTime")

        await expect(exchange.connect(maker).addNewDueTime(dueTime1))
            .to.emit(exchange, "NewDueTime")

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1, undefined))
            .to.be.revertedWith("OrdersCashV1: dueTime not new")
    })

    // ----------------------------------------------------------------------------------------------------------------

})

// ------------------------------------------------------------------------------
// Helper functions

function getEIP712HashSol(exchange: Contract, msg: IMessage) {
    return exchange.getEIP712Hash(msg.coinsToMaker, msg.coinsToTaker, msg.dueTime80)
}

function getSigner(exchange: Contract, msg: IMessage, r: string, s: string, v: number, version: number) {
    const dueTime80_v8_version8 = bnToHex((BigInt(msg.dueTime80) << 16n) | (BigInt(v) << 8n) | BigInt(version));
    return exchange.getSigner(msg.coinsToMaker, msg.coinsToTaker, dueTime80_v8_version8, r, s)
}

function exch(exchange: Contract, msg: IMessage, r: string, s: string, v: number, version: number, bchAmount: BigNumber | number | undefined) {
    const dueTime80_v8_version8 = bnToHex((BigInt(msg.dueTime80) << 16n) | (BigInt(v) << 8n) | BigInt(version));
    return exchange.directExchange(msg.coinsToMaker, msg.coinsToTaker, dueTime80_v8_version8, r, s, {
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
    const expireDate = (new Date()).getTime() + hs * 3600 * 1000;
    const expireTimestamp =  Math.floor(expireDate / 1000)
    const expireNanosecondsBN = ethers.BigNumber.from(expireTimestamp).mul(1000*1000*1000)
    const expirePicosecondsBN = expireNanosecondsBN.add(Math.floor(Math.random()*1000*1000*1000)).mul(1000)
    const order = "0x" + hexStr32(expirePicosecondsBN).substr(64+2-20)
    return order;
}
