import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber, Contract, Wallet } from "ethers"

const { TypedDataUtils } = require("ethers-eip712")
const { toUtf8Bytes } = require("ethers/lib/utils")

const MaxAmount = "0x0FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"
const bchAddr = "0x0000000000000000000000000000000000002711"
const erc20ABI = [
    `function balanceOf(address owner) external view returns (uint)`,
    `function allowance(address owner, address spender) external view returns (uint)`,
    `function approve(address spender, uint value) external returns (bool)`,
]

export interface IMessage {
    coinsToMaker: string
    coinsToTaker: string
    // takerAddr_dueTime80: string
    dueTime80: string
}

describe("Burros", function () {
    let maker: Wallet
    let taker: Wallet
    let exchange: Contract
    let wBCH: Contract
    let sUSD: Contract
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
        exchange = await Exchange.deploy()
        await exchange.deployed()

        // console.log("exchange.address: ", exchange.address);

        const TestERC20 = await ethers.getContractFactory("TestERC20")
        wBCH = await TestERC20.deploy("wBCH", ethers.utils.parseUnits("10000000", 18), 18)
        sUSD = await TestERC20.deploy("sUSD", ethers.utils.parseUnits("10000000", 18), 18)
        await Promise.all([wBCH.deployed(), sUSD.deployed()])
    })

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

    // --------------

    it("makes a wBCH -> sUSD order and then it taken properly", async function () {
        await wBCH.transfer(maker.address, 10)
        await sUSD.transfer(taker.address, 5000)
        expect(await wBCH.balanceOf(maker.address)).to.equal(10)
        expect(await sUSD.balanceOf(taker.address)).to.equal(5000)

        const dueTime = getDueTime(1);

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            // takerAddr_dueTime80: concatAddressUint80_v8(taker.address, dueTime, 1),
            // dueTime80: concatUint80_v8(dueTime, 1),
            // dueTime80: "0x0059c84fa59fe2f067e0", //dueTime,
            dueTime80: dueTime,
        }

        // https://bitcoin.stackexchange.com/questions/38351/ecdsa-v-r-s-what-is-v
        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        // console.log('rsv:', r, s, v);

        await wBCH.connect(maker).approve(exchange.address, 1)
        await sUSD.connect(taker).approve(exchange.address, 500)

        // const makerBalance0 = await ethers.provider.getBalance(maker.address)
        // const takerBalance0 = await ethers.provider.getBalance(taker.address)
        // console.log("makerBalance0: ", makerBalance0.toString());
        // console.log("takerBalance0: ", takerBalance0.toString());

        const ret = exch(exchange.connect(taker), msg, r, s, v, undefined);
        const retAw = await ret;
        // console.log(retAw);

        // console.log("maxPriorityFeePerGas: ", retAw.maxPriorityFeePerGas.toString());
        // console.log("maxFeePerGas:         ", retAw.maxFeePerGas.toString());
        // // console.log("gasPrice:             ", retAw.gasPrice.toString());
        // console.log("gasLimit:             ", retAw.gasLimit.toString());

        // maxPriorityFeePerGas: BigNumber { _hex: '0x59682f00', _isBigNumber: true },
        // maxFeePerGas: BigNumber { _hex: '0x7e151804', _isBigNumber: true },
        // gasPrice: null,
        // gasLimit: BigNumber { _hex: '0x01baf398', _isBigNumber: true },



        await expect(ret)
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, taker.address, sUSD.address, 500, wBCH.address, 1, dueTime)

        // // const makerBalance1 = await ethers.provider.getBalance(maker.address)
        // const takerBalance1 = await ethers.provider.getBalance(taker.address)
        // // console.log("makerBalance1: ", makerBalance1.toString());
        // console.log("takerBalance1: ", takerBalance1.toString());

        // const gasSpent = takerBalance0.sub(takerBalance1);
        // console.log("gasSpent: ", gasSpent.toString());

        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await wBCH.balanceOf(taker.address)).to.equal(1)
        expect(await sUSD.balanceOf(maker.address)).to.equal(500)
        expect(await sUSD.balanceOf(taker.address)).to.equal(4500)
    })

    it("fails when try to take the order too late", async function () {
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "1"),
            // dueTime80: concatAddressUint80_v8(taker.address, dueTime, 1),
            dueTime80: getDueTime(-1),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("Burros: order expired")
    })

    it("fails when the maker allowance is not enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await sUSD.balanceOf(taker.address)).to.equal(4500)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(0)

        // `function allowance(address owner, address spender) external view returns (uint)`,

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "4500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "9"),
            dueTime80: getDueTime(1),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("Burros: transferFrom fail")
    })

    it("fails when the maker balance is not enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await sUSD.balanceOf(taker.address)).to.equal(4500)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(0)

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "4500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "10"),
            dueTime80: getDueTime(1),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await wBCH.connect(maker).approve(exchange.address, 9)
        await sUSD.connect(taker).approve(exchange.address, 4500)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(9)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(4500)

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("Burros: transferFrom fail")
    })

    it("works after changing the allowance and with proper maker balance", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(9)
        expect(await sUSD.balanceOf(taker.address)).to.equal(4500)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(9)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(4500)

        const dueTime = getDueTime(1);

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(sUSD.address, "4500"),
            coinsToTaker: concatAddressUint96(wBCH.address, "9"),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await wBCH.connect(maker).approve(exchange.address, 9)
        await sUSD.connect(taker).approve(exchange.address, 4500)

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, taker.address, sUSD.address, 4500, wBCH.address, 9, dueTime)

        expect(await wBCH.balanceOf(maker.address)).to.equal(0)
        expect(await wBCH.balanceOf(taker.address)).to.equal(10)
        expect(await sUSD.balanceOf(maker.address)).to.equal(5000)
        expect(await sUSD.balanceOf(taker.address)).to.equal(0)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(0)
    })

    it("makes an order the other way around (sUSD -> wBCH)", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(0)
        expect(await wBCH.balanceOf(taker.address)).to.equal(10)
        expect(await sUSD.balanceOf(maker.address)).to.equal(5000)
        expect(await sUSD.balanceOf(taker.address)).to.equal(0)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(0)

        const dueTime = getDueTime(1);

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, 5),
            coinsToTaker: concatAddressUint96(sUSD.address, 2500),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await sUSD.connect(maker).approve(exchange.address, 2500)
        await wBCH.connect(taker).approve(exchange.address, 5)

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, taker.address, wBCH.address, 5, sUSD.address, 2500, dueTime)

        expect(await wBCH.balanceOf(maker.address)).to.equal(5)
        expect(await wBCH.balanceOf(taker.address)).to.equal(5)
        expect(await sUSD.balanceOf(maker.address)).to.equal(2500)
        expect(await sUSD.balanceOf(taker.address)).to.equal(2500)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(0)
    })

    it("fails when the taker allowance is not enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(5)
        expect(await wBCH.balanceOf(taker.address)).to.equal(5)
        expect(await sUSD.balanceOf(maker.address)).to.equal(2500)
        expect(await sUSD.balanceOf(taker.address)).to.equal(2500)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(0)

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, 1),
            coinsToTaker: concatAddressUint96(sUSD.address, 250),
            dueTime80: getDueTime(1),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await sUSD.connect(maker).approve(exchange.address, 250)

        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(250)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(0)

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("ERC20: insufficient allowance")
    })

    it("fails when the taker balance is not enough", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(5)
        expect(await wBCH.balanceOf(taker.address)).to.equal(5)
        expect(await sUSD.balanceOf(maker.address)).to.equal(2500)
        expect(await sUSD.balanceOf(taker.address)).to.equal(2500)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(250)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(0)

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, 6),
            coinsToTaker: concatAddressUint96(sUSD.address, 250),
            dueTime80: getDueTime(1),
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await sUSD.connect(maker).approve(exchange.address, 250)
        await wBCH.connect(taker).approve(exchange.address, 6)
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(250)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(6)

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("ERC20: transfer amount exceeds balance")
    })

    it("works after changing the allowance and with proper taker balance", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(5)
        expect(await wBCH.balanceOf(taker.address)).to.equal(5)
        expect(await sUSD.balanceOf(maker.address)).to.equal(2500)
        expect(await sUSD.balanceOf(taker.address)).to.equal(2500)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(6)
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(250)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(0)

        const dueTime = getDueTime(1);

        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(wBCH.address, 1),
            coinsToTaker: concatAddressUint96(sUSD.address, 250),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)

        await expect(exch(exchange.connect(taker), msg, r, s, v, undefined))
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, taker.address, wBCH.address, 1, sUSD.address, 250, dueTime)

        expect(await wBCH.balanceOf(maker.address)).to.equal(6)
        expect(await wBCH.balanceOf(taker.address)).to.equal(4)
        expect(await sUSD.balanceOf(maker.address)).to.equal(2250)
        expect(await sUSD.balanceOf(taker.address)).to.equal(2750)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(5)
        expect(await sUSD.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await sUSD.allowance(taker.address, exchange.address)).to.equal(0)
    })






    it("makes a wBCH -> BCH order and then it taken properly", async function () {
        expect(await wBCH.balanceOf(maker.address)).to.equal(6)
        expect(await wBCH.balanceOf(taker.address)).to.equal(4)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(5)

        // const tmp = ethers.utils.parseEther("10.0");
        // console.log("tmp: ", tmp.toString());

        // const tmp = ethers.utils.parseUnits("10000000", 18)
        // console.log("tmp: ", tmp.toString());

        const dueTime = getDueTime(1);
        const msg: IMessage = {
            coinsToMaker: concatAddressUint96(bchAddr, ethers.utils.parseUnits("1", 18)),
            coinsToTaker: concatAddressUint96(wBCH.address, ethers.utils.parseUnits("1", 18)),
            dueTime80: dueTime,
        }

        const [r, s, v] = signRawMsg(exchange.address, msg, maker)
        await wBCH.connect(maker).approve(exchange.address, 1)

        const makerBalance0 = await ethers.provider.getBalance(maker.address)
        const takerBalance0 = await ethers.provider.getBalance(taker.address)

        // console.log("takerBalance0: ", takerBalance0.toString());

        await expect(exch(exchange.connect(taker), msg, r, s, v, 1))
            .to.emit(exchange, "Exchange")
            .withArgs(maker.address, taker.address, bchAddr, 1, wBCH.address, 1, dueTime)

        const makerBalance1 = await ethers.provider.getBalance(maker.address)
        const takerBalance1 = await ethers.provider.getBalance(taker.address)

        // console.log("takerBalance1: ", takerBalance1.toString());

        // const gasSpent = takerBalance0.sub(takerBalance1);
        // console.log("gasSpent: ", gasSpent.toString());

        expect(await wBCH.balanceOf(maker.address)).to.equal(5)
        expect(await wBCH.balanceOf(taker.address)).to.equal(5)
        expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
        expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(5)
        expect(makerBalance1.sub(makerBalance0)).to.equal(1)
        expect(takerBalance0.sub(takerBalance1)).to.equal(-1)
    })

    // it("fails when the Taker sends more BCH than he should", async function () {
    //     expect(await wBCH.balanceOf(maker.address)).to.equal(6)
    //     expect(await wBCH.balanceOf(taker.address)).to.equal(4)
    //     expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
    //     expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(5)

    //     const dueTime = getDueTime(1);
    //     const msg: IMessage = {
    //         coinsToMaker: concatAddressUint96(bchAddr, 1),
    //         coinsToTaker: concatAddressUint96(wBCH.address, 1),
    //         dueTime80: dueTime,
    //     }

    //     const [r, s, v] = signRawMsg(exchange.address, msg, maker)
    //     await wBCH.connect(maker).approve(exchange.address, 1)

    //     await expect(exch(exchange.connect(taker), msg, r, s, v, 2))
    //         .to.emit(exchange, "Exchange")
    //         .withArgs(maker.address, taker.address, bchAddr, 1, wBCH.address, 1, dueTime)

    //     await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("Burros: BCH sent exceeds the amount to be sent")
    // })

    // it("fails to make a wBCH -> BCH order with not enough BCH", async function () {
    //     expect(await wBCH.balanceOf(maker.address)).to.equal(5)
    //     expect(await wBCH.balanceOf(taker.address)).to.equal(5)
    //     expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(0)
    //     expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(5)

    //     const dueTime = getDueTime(1);
    //     const msg: IMessage = {
    //         coinsToMaker: concatAddressUint96(bchAddr, 1),
    //         coinsToTaker: concatAddressUint96(wBCH.address, 1),
    //         dueTime80: dueTime,
    //     }

    //     const [r, s, v] = signRawMsg(exchange.address, msg, maker)
    //     await wBCH.connect(maker).approve(exchange.address, 1)

    //     await expect(exch(exchange.connect(taker), msg, r, s, v, undefined)).to.be.revertedWith("Burros: BCH not enough")
    // })

    // it("makes a BCH -> wBCH order and then it taken properly", async function () {
    //     expect(await wBCH.balanceOf(maker.address)).to.equal(5)
    //     expect(await wBCH.balanceOf(taker.address)).to.equal(5)
    //     expect(await wBCH.allowance(maker.address, exchange.address)).to.equal(1)
    //     expect(await wBCH.allowance(taker.address, exchange.address)).to.equal(5)

    //     const dueTime = getDueTime(1);
    //     const msg: IMessage = {
    //         coinsToMaker: concatAddressUint96(wBCH.address, 0),
    //         coinsToTaker: concatAddressUint96(bchAddr, 1),
    //         dueTime80: dueTime,
    //     }

    //     const [r, s, v] = signRawMsg(exchange.address, msg, maker)

    //     // await bch.connect(maker).approve(exchange.address, 1)
    //     await wBCH.connect(taker).approve(exchange.address, 1)

    //     const makerBalance0 = await ethers.provider.getBalance(maker.address)
    //     const takerBalance0 = await ethers.provider.getBalance(taker.address)

    //     await expect(exch(exchange.connect(taker), msg, r, s, v, 1))
    //         .to.emit(exchange, "Exchange")
    //         .withArgs(maker.address, taker.address, wBCH.address, 0, bchAddr, 1, dueTime)

    //     const makerBalance1 = await ethers.provider.getBalance(maker.address)
    //     const takerBalance1 = await ethers.provider.getBalance(taker.address)

    //     expect(await wBCH.balanceOf(maker.address)).to.equal(6)
    //     expect(await wBCH.balanceOf(taker.address)).to.equal(4)
    //     expect(makerBalance1.sub(makerBalance0)).to.equal(-1); // TODO
    //     expect(takerBalance1.sub(takerBalance0)).to.equal(1); // TODO
    // })
})

// ------------------------------------------------------------------------------
// Helper functions

function getEIP712HashSol(exchange: Contract, msg: IMessage) {
    return exchange.getEIP712Hash(msg.coinsToMaker, msg.coinsToTaker, msg.dueTime80)
}

function getSigner(exchange: Contract, msg: IMessage, r: string, s: string, v: number) {
    return exchange.getSigner(msg.coinsToMaker, msg.coinsToTaker, bnToHex((BigInt(msg.dueTime80) << 8n) | BigInt(v)), r, s)
}

function exch(exchange: Contract, msg: IMessage, r: string, s: string, v: number, bch: number | undefined) {
    // const gas = await exchange.estimateGas.exchange(msg.coinsToMaker, msg.coinsToTaker, bnToHex((BigInt(msg.dueTime80) << 8n) | BigInt(v)), r, {
    //     value: bch || 0,
    // });
    // console.log("gas estimated: ", gas);

    const ret = exchange.exchange(msg.coinsToMaker, msg.coinsToTaker, bnToHex((BigInt(msg.dueTime80) << 8n) | BigInt(v)), r, s, {
        value: bch || 0,
    })

    // console.log("ret: ", ret);

    return ret;
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

// function concatAddressUint96(addr: string, n: number) {
//     return bnToHex(BigInt(addr) << 96n | BigInt(n))
// }

function concatAddressUint96(addr: string, nStr: string) {
    return bnToHex(BigNumber(addr) << 96n | ethers.utils.parseUnits(nStr, 18))
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
