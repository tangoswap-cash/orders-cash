const { expect } = require("chai");
const { ethers } = require("hardhat");
const { TypedDataUtils } = require('ethers-eip712');

describe("ExchangeV2", function () {

  let maker, taker;
  let exchange;
  let wBCH, fUSD;

  before(async function () {
    const [acc0] = await ethers.getSigners();
    maker = new ethers.Wallet('82c149d8f7257a6ab690d351d482de51e3540a95859a72a96ef5d744e1f69d60', acc0.provider);
    taker = new ethers.Wallet('f37a49a536c941829424a502bb4579f2ab5451c7104c8541e7797798f3daf4ec', acc0.provider);
    // console.log('maker:', maker.address);
    // console.log('taker:', taker.address);
    await acc0.sendTransaction({to: maker.address, value: ethers.utils.parseEther("1.0")});
    await acc0.sendTransaction({to: taker.address, value: ethers.utils.parseEther("1.0")});

    const Exchange = await ethers.getContractFactory("ExchangeV2");
    exchange = await Exchange.deploy();
    await exchange.deployed();

    const TestERC20 = await ethers.getContractFactory("TestERC20");
    wBCH = await TestERC20.deploy('wBCH', ethers.utils.parseUnits('10000000', 18), 18);
    fUSD = await TestERC20.deploy('fUSD', ethers.utils.parseUnits('10000000', 18), 18);
    // console.log('wBCH:', wBCH.address);
    // console.log('fUSD:', fUSD.address);
    await Promise.all([wBCH.deployed(), fUSD.deployed()]);
  });

  it("getEIP712Hash", async function () {
    const msg = {
      coinsToMaker: bnToHex(BigInt(wBCH.address) << 96n | 0x123n),
      coinsToTaker: bnToHex(BigInt(fUSD.address) << 96n | 0x456n),
      takerAddr_dueTime64: bnToHex(BigInt(taker.address) << 64n | 0x789n),
    }
    // console.log(msg);

    const eip712HashSol = await getEIP712HashSol(exchange, msg);
    const eip712HashJS = getEIP712HashJS(exchange.address, msg);
    // console.log('eip712HashSol:', eip712HashSol);
    // console.log('eip712HashJS :', eip712HashJS);
    expect(eip712HashSol).to.equal(eip712HashJS);
  });

  it("getMaker", async function () {
    const msg = {
      coinsToMaker: bnToHex(BigInt(wBCH.address) << 96n | 0x123n),
      coinsToTaker: bnToHex(BigInt(fUSD.address) << 96n | 0x456n),
      takerAddr_dueTime64: bnToHex(BigInt(taker.address) << 64n | 0x789n),
    }

    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    // console.log('rsv:', r, s, v);
    const makerAddr = await getMaker(exchange, msg, r, s, v);
    // console.log('makerAddr:', makerAddr);
    expect(makerAddr).to.equal(maker.address);
  });

  it("exchange:ok", async function () {
    await wBCH.transfer(maker.address, _1e18(10));
    await fUSD.transfer(taker.address, _1e18(5000));
    expect(await wBCH.balanceOf(maker.address)).to.equal(_1e18(10));
    expect(await fUSD.balanceOf(taker.address)).to.equal(_1e18(5000));

    // const payerAllowance = 0x123456;
    // const payAmount = 0x9876;
    // await myToken.transfer(payer.address, payAmount + 1);
    // await myToken.connect(payer).approve(stochasticPay.address, payerAllowance);

    const msg = {
      coinsToMaker: bnToHex(BigInt(fUSD.address) << 96n | 500n),
      coinsToTaker: bnToHex(BigInt(wBCH.address) << 96n | 1n),
      takerAddr_dueTime64: bnToHex(BigInt(taker.address) << 64n | 0x789n),
    }

    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    // console.log('rsv:', r, s, v);
    await exch(exchange, msg, r, s, v);

    // expect(await myToken.balanceOf(payer.address)).to.equal(1);
    // expect(await myToken.balanceOf(payee.address)).to.equal(payAmount);
  });

});

function getEIP712HashSol(exchange, msg) {
  return exchange.getEIP712Hash(
    msg.coinsToMaker,
    msg.coinsToTaker,
    msg.takerAddr_dueTime64,
  );
}
function getMaker(exchange, msg, r, s, v) {
  return exchange.getMaker(
    msg.coinsToMaker,
    msg.coinsToTaker,
    bnToHex(BigInt(msg.takerAddr_dueTime64) << 8n | BigInt(v)),
    r, s,
  );
}
function exch(exchange, msg, r, s, v) {
  return exchange.exchange(
    msg.coinsToMaker,
    msg.coinsToTaker,
    bnToHex(BigInt(msg.takerAddr_dueTime64) << 8n | BigInt(v)),
    r, s,
  );
}

function signRawMsg(verifyingContractAddr, msg, signer) {
  const typedData = getTypedData(verifyingContractAddr, msg);
  const digest = TypedDataUtils.encodeDigest(typedData);
  // const signature = await signer.signMessage(digest);
  // const r = signature.substring(0, 66);
  // const s = "0x" + signature.substring(66, 130);
  // const v = parseInt(signature.substring(130, 132), 16);
  // return [r, s, v];
  const signature = signer._signingKey().signDigest(digest);
  return [signature.r, signature.s, signature.v];
}

function getEIP712HashJS(verifyingContractAddr, msg) {
  const typedData = getTypedData(verifyingContractAddr, msg);
  const digest = TypedDataUtils.encodeDigest(typedData);
  const digestHex = ethers.utils.hexlify(digest);
  return digestHex;
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
      Exchange: [
        { name: "coinsToMaker", type: "uint256" },
        { name: "coinsToTaker", type: "uint256" },
        { name: "takerAddr_dueTime64", type: "uint256" },
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
    // message: {
    //   coinsToMaker: "",
    //   coinsToTaker: "",
    //   takerAddr_dueTime64: "",
    // }
    message: msg,
  };
}

function _1e18(n) {
  return (BigInt(n) * (10n ** 18n)).toString();
}
function bnToHex(n) {
  return '0x' + n.toString(16);
}
