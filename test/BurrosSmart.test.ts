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
    // `function balanceOf(address owner) external view returns (uint)`,
    // `function allowance(address owner, address spender) external view returns (uint)`,
    // `function approve(address spender, uint value) external returns (bool)`,
    // `function transfer(address to, uint256 amount) external returns (bool)`,
    ...erc20ABI,
    `function deposit() external payable`,
    `function withdraw(uint256 amount) external`,
]

const ISmartSwapABI = [
    `function getExpectedReturn(address fromToken,address destToken,uint256 amount,uint256 parts,uint256 flags) external view returns(uint256 returnAmount, uint256[] memory distribution)`,
    `function swap(address fromToken,address destToken,uint256 amount,uint256 minReturn,uint256[] memory distribution,uint256 flags,uint256 deadline,uint256 feePercent) external payable returns(uint256)`,
]

export interface IMessage {
    coinsToMaker: string
    coinsToTaker: string
    dueTime80: string
}

function adjustReturnAmount(amount: string) {
    const amountBig = ethers.BigNumber.from(amount);
    const i995 = ethers.BigNumber.from("900");
    const i1000 = ethers.BigNumber.from("1000");
    const adjusted = amountBig.mul(i995).div(i1000);
    return adjusted.toString();
}

async function swapUsingAggregator(smartSwap: Contract, fromToken: string, toToken: string, amount: BigNumber) {
    const feePercent = ethers.utils.parseEther("0.0005");
    const flags = 0;
    const deadline = new Date().getTime() + (1000 * 60 * 30);

    const res = await smartSwap.getExpectedReturn(
        fromToken,
        toToken,
        amount,
        1,
        flags
    );

    const minReturn = adjustReturnAmount(res.returnAmount.toString());

    console.log('returnAmount:', res.returnAmount.toString());
    console.log('feePercent:  ', feePercent.toString());
    console.log('deadline:    ', deadline);
    console.log('minReturn:   ', minReturn);

    await smartSwap.swap(
                    fromToken,
                    toToken,
                    amount,
                    minReturn,
                    res.distribution,
                    flags,
                    deadline,
                    feePercent, {
                        value: fromToken === zeroAddr ? amount : 0,
                        gasPrice: 1050000000,
                    });
}

describe("Limit orders tests", function () {
    this.timeout(30000000);
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
    let smartSwap: Contract

    let BCH = {address: zeroAddr};

    before(async function () {
        const [acc0] = await ethers.getSigners()
        sep206 = new ethers.Contract(sep206Addr, erc20ABI, acc0.provider)
        smartSwap = new ethers.Contract("0xEd2E356C00A555DDdd7663BDA822C6acB34Ce614", ISmartSwapABI, acc0.provider)
        // console.log("smartSwap: ", smartSwap);

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

        const Exchange = await ethers.getContractFactory("Burros")
        exchange = await Exchange.deploy(toWei("0.0005"))
        await exchange.deployed()

        const Scammer = await ethers.getContractFactory("Scammer")
        scammerContract = await Scammer.deploy()
        await scammerContract.deployed()

        const Scammer2 = await ethers.getContractFactory("Scammer2")
        scammer2Contract = await Scammer2.deploy()
        await scammer2Contract.deployed()

        wBCH = new ethers.Contract('0x3743eC0673453E5009310C727Ba4eaF7b3a1cc04', IWETHABI, acc0.provider)
        // sUSD = new ethers.Contract('0x7b2B3C5308ab5b2a1d9a94d20D35CCDf61e05b72', erc20ABI, acc0.provider)   // FlexUSD
        sUSD = new ethers.Contract('0xBc2F884680c95A02cea099dA2F524b366d9028Ba', erc20ABI, acc0.provider)   // BCUSDT
        TANGO = new ethers.Contract('0x73BE9c8Edf5e951c9a0762EA2b1DE8c8F38B5e91', erc20ABI, acc0.provider)
        ARG = new ethers.Contract('0x675E1d6FcE8C7cC091aED06A68D079489450338a', erc20ABI, acc0.provider)
        KTH = new ethers.Contract('0xc70c7718C7f1CCd906534C2c4a76914173EC2c44', erc20ABI, acc0.provider)

        // Wrap BCH
        await wBCH.connect(maker).deposit({value: ethers.utils.parseEther("20.0")});
        await wBCH.connect(taker).deposit({value: ethers.utils.parseEther("20.0")});

        //First Swaps
        // await wBCH.connect(maker).approve(smartSwap.address, MaxAmount);
        // await swapUsingAggregator(smartSwap.connect(maker), wBCH, sUSD, ethers.utils.parseEther("0.1"));
        // await wBCH.connect(taker).approve(smartSwap.address, MaxAmount);
        await swapUsingAggregator(smartSwap.connect(taker), BCH.address, sUSD.address, ethers.utils.parseEther("1"));
        await swapUsingAggregator(smartSwap.connect(taker), BCH.address, TANGO.address, ethers.utils.parseEther("1"));




        console.log("Maker wBCH:  ", (await wBCH.balanceOf(maker.address)).toString());
        console.log("Maker sUSD:  ", (await sUSD.balanceOf(maker.address)).toString());
        console.log("Maker TANGO: ", (await TANGO.balanceOf(maker.address)).toString());

        console.log("Taker wBCH:  ", (await wBCH.balanceOf(taker.address)).toString());
        console.log("Taker sUSD:  ", (await sUSD.balanceOf(taker.address)).toString());
        console.log("Taker TANGO: ", (await TANGO.balanceOf(taker.address)).toString());
    })

    // ----------------------------------------------------------------------------------------------------------------
    it.only("checks initial balances", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("20"))
        expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("20"))

        expect(await sUSD.balanceOf(taker.address)).to.be.gte(toWei("0"))
        expect(await TANGO.balanceOf(taker.address)).to.be.gte(toWei("0"))

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

    // it.only('should getExpectedReturn with BCH => flexUSD', async function () {
    //     // console.log("smartSwap: ", smartSwap);
    //     // console.log("smartSwap: ", this.smartSwap);

    //     console.log("BCH: ", BCH);
    //     console.log("BCH: ", BCH.address);
    //     console.log("sUSD: ", sUSD.address);

    //     expect(1).to.equal(1)
    //     const res = await smartSwap.getExpectedReturn(
    //         BCH.address,
    //         sUSD.address,
    //         toWei("1"),
    //         10,
    //         0
    //     );

    //     // console.log('res:', res);
    //     console.log('returnAmount:', res.returnAmount.toString());


    //     // printDistribution(res.distribution, 10);

    //     // console.log('Swap: 1 BCH');
    //     // console.log('returnAmount:', res.returnAmount.toString() / 1e8 + ' flexUSD');
    //     // console.log('distribution:', res.distribution.map(a => a.toString()));
    //     // console.log('raw:', res.returnAmount.toString());
    //     // expect(res.returnAmount).to.be.bignumber.least('100000000000000000000'); // 1 BCH >= 100 flexUSD
    // });

    it.only("TODO smartExchange", async function () {
        // await wBCH.transfer(maker.address, toWei("10"))
        // await sUSD.transfer(taker.address, toWei("5000"))
        // expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("10"))
        // expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("5000"))
        // expect(await wBCH.balanceOf(exchange.address)).to.equal(toWei("0"))
        // expect(await sUSD.balanceOf(exchange.address)).to.equal(toWei("0"))

        const dueTime = getDueTime(1);

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "90"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await wBCH.connect(maker).approve(exchange.address, toWei("1"))
        await sUSD.connect(taker).approve(exchange.address, toWei("90"))

        const ret = smartExch(exchange.connect(taker), TANGO, toWei("1000"), msg, r, s, v, undefined);
        const retAw = await ret;

        await expect(ret)
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, taker.address, sUSD.address, toWei("90"), wBCH.address, toWei("1"), dueTime)

        // expect(await wBCH.balanceOf(maker.address)).to.equal(toWei("9"))
        // expect(await wBCH.balanceOf(taker.address)).to.equal(toWei("1"))
        // expect(await sUSD.balanceOf(maker.address)).to.equal(toWei("500"))
        // expect(await sUSD.balanceOf(taker.address)).to.equal(toWei("4500"))
        // expect(await wBCH.balanceOf(exchange.address)).to.equal(toWei("0"))
        // expect(await sUSD.balanceOf(exchange.address)).to.equal(toWei("0"))
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

function smartExch(exchange: Contract, from: Contract, fromAmount: BigNumber, msg: IMessage, r: string, s: string, v: number, bchAmount: BigNumber | number | undefined) {
    return exchange.smartExchange(from.address, fromAmount, msg.coinsToMaker, msg.coinsToTaker, bnToHex((BigInt(msg.dueTime80) << 8n) | BigInt(v)), r, s, {
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
