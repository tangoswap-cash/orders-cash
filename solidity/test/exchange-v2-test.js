const { expect } = require("chai");
const { ethers } = require("hardhat");
const { TypedDataUtils } = require('ethers-eip712');

const bchAddr = '0x0000000000000000000000000000000000002711';
const erc20ABI = [
  `function balanceOf(address owner) external view returns (uint)`,
  `function allowance(address owner, address spender) external view returns (uint)`,
  `function approve(address spender, uint value) external returns (bool)`
]

describe("ExchangeV2", function () {

  let maker, taker;
  let exchange;
  let wBCH, fUSD;
  let bch;

  before(async function () {
    const [acc0] = await ethers.getSigners();
    bch = new ethers.Contract(bchAddr, erc20ABI, acc0.provider);
    maker = new ethers.Wallet('82c149d8f7257a6ab690d351d482de51e3540a95859a72a96ef5d744e1f69d60', acc0.provider);
    taker = new ethers.Wallet('f37a49a536c941829424a502bb4579f2ab5451c7104c8541e7797798f3daf4ec', acc0.provider);
    // console.log('maker:', maker.address);
    // console.log('taker:', taker.address);
    await acc0.sendTransaction({to: maker.address, value: ethers.utils.parseEther("10.0")});
    await acc0.sendTransaction({to: taker.address, value: ethers.utils.parseEther("10.0")});

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
      coinsToMaker: concatAddressUint96(wBCH.address, 0x123),
      coinsToTaker: concatAddressUint96(fUSD.address, 0x456),
      takerAddr_dueTime64: concatAddressUint64(taker.address, 0x789),
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
      coinsToMaker: concatAddressUint96(wBCH.address, 0x123),
      coinsToTaker: concatAddressUint96(fUSD.address, 0x456),
      takerAddr_dueTime64: concatAddressUint64(taker.address, 0x789),
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

    const dueTime = (Date.now() + 3600 * 1000) * 10**6;
    const msg = {
      coinsToMaker: concatAddressUint96(fUSD.address, _1e18(500)),
      coinsToTaker: concatAddressUint96(wBCH.address, _1e18(1)),
      takerAddr_dueTime64: concatAddressUint64(taker.address, dueTime),
    }

    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    // console.log('rsv:', r, s, v);

    await wBCH.connect(maker).approve(exchange.address, _1e18(1));
    await fUSD.connect(taker).approve(exchange.address, _1e18(500));
    await expect(exch(exchange.connect(taker), msg, r, s, v))
        .to.emit(exchange, 'Exchange')
        .withArgs(maker.address, msg.coinsToMaker, msg.coinsToTaker, msg.takerAddr_dueTime64);

    expect(await wBCH.balanceOf(maker.address)).to.equal(_1e18(9));
    expect(await wBCH.balanceOf(taker.address)).to.equal(_1e18(1));
    expect(await fUSD.balanceOf(taker.address)).to.equal(_1e18(4500));
    expect(await fUSD.balanceOf(maker.address)).to.equal(_1e18(500));
  });

  it("exchange:out-of-date", async function () {
    const dueTime = (Date.now() - 1) * 10**6;
    const msg = {
      coinsToMaker: concatAddressUint96(fUSD.address, _1e18(500)),
      coinsToTaker: concatAddressUint96(wBCH.address, _1e18(1)),
      takerAddr_dueTime64: concatAddressUint64(taker.address, dueTime),
    }

    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    await expect(exch(exchange.connect(taker), msg, r, s, v))
        .to.be.revertedWith('too late');
  });

  it("exchange:wrong-taker", async function () {
    const dueTime = (Date.now() + 3600 * 1000) * 10**6;
    const msg = {
      coinsToMaker: concatAddressUint96(fUSD.address, _1e18(500)),
      coinsToTaker: concatAddressUint96(wBCH.address, _1e18(1)),
      takerAddr_dueTime64: concatAddressUint64(taker.address, dueTime),
    }

    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    await expect(exch(exchange.connect(maker), msg, r, s, v))
        .to.be.revertedWith('taker mismatch');
  });

  it("exchange:erc20-taker-amt-not-enough", async function () {
    expect(await wBCH.balanceOf(maker.address)).to.equal(_1e18(9));
    expect(await fUSD.balanceOf(taker.address)).to.equal(_1e18(4500));

    const dueTime = (Date.now() + 3600 * 1000) * 10**6;
    const msg = {
      coinsToMaker: concatAddressUint96(fUSD.address, _1e18(5000)),
      coinsToTaker: concatAddressUint96(wBCH.address, _1e18(10)),
      takerAddr_dueTime64: concatAddressUint64(taker.address, dueTime),
    }

    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    await expect(exch(exchange.connect(taker), msg, r, s, v))
        .to.be.revertedWith('ERC20: transfer amount exceeds balance');
  });

  it("exchange:erc20-taker-allowance-not-enough", async function () {
    expect(await wBCH.balanceOf(maker.address)).to.equal(_1e18(9));
    expect(await fUSD.balanceOf(taker.address)).to.equal(_1e18(4500));

    const dueTime = (Date.now() + 3600 * 1000) * 10**6;
    const msg = {
      coinsToMaker: concatAddressUint96(fUSD.address, _1e18(4500)),
      coinsToTaker: concatAddressUint96(wBCH.address, _1e18(10)),
      takerAddr_dueTime64: concatAddressUint64(taker.address, dueTime),
    }

    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    await expect(exch(exchange.connect(taker), msg, r, s, v))
        .to.be.revertedWith('ERC20: transfer amount exceeds allowance');
  });

  it("exchange:erc20-maker-amt-not-enough", async function () {
    expect(await wBCH.balanceOf(maker.address)).to.equal(_1e18(9));
    expect(await fUSD.balanceOf(taker.address)).to.equal(_1e18(4500));

    const dueTime = (Date.now() + 3600 * 1000) * 10**6;
    const msg = {
      coinsToMaker: concatAddressUint96(fUSD.address, _1e18(4500)),
      coinsToTaker: concatAddressUint96(wBCH.address, _1e18(10)),
      takerAddr_dueTime64: concatAddressUint64(taker.address, dueTime),
    }

    await fUSD.connect(taker).approve(exchange.address, _1e18(4500));
    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    await expect(exch(exchange.connect(taker), msg, r, s, v))
        .to.be.revertedWith('ERC20: transfer amount exceeds balance');
  });

  it("exchange:erc20-maker-allowance-not-enough", async function () {
    expect(await wBCH.balanceOf(maker.address)).to.equal(_1e18(9));
    expect(await fUSD.balanceOf(taker.address)).to.equal(_1e18(4500));

    const dueTime = (Date.now() + 3600 * 1000) * 10**6;
    const msg = {
      coinsToMaker: concatAddressUint96(fUSD.address, _1e18(4500)),
      coinsToTaker: concatAddressUint96(wBCH.address, _1e18(8)),
      takerAddr_dueTime64: concatAddressUint64(taker.address, dueTime),
    }

    await fUSD.connect(taker).approve(exchange.address, _1e18(4500));
    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    await expect(exch(exchange.connect(taker), msg, r, s, v))
        .to.be.revertedWith('ERC20: transfer amount exceeds allowance');
  });

  it("exchange:bch-to-taker", async function () {
    expect(await wBCH.balanceOf(maker.address)).to.equal(_1e18(9));
    expect(await fUSD.balanceOf(taker.address)).to.equal(_1e18(4500));

    const dueTime = (Date.now() + 3600 * 1000) * 10**6;
    const msg = {
      coinsToMaker: concatAddressUint96(fUSD.address, _1e18(500)),
      coinsToTaker: concatAddressUint96(bchAddr, _1e18(1)),
      takerAddr_dueTime64: concatAddressUint64(taker.address, dueTime),
    }
    console.log(msg);

    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    // console.log('rsv:', r, s, v);

    await bch.connect(maker).approve(exchange.address, _1e18(1));
    await fUSD.connect(taker).approve(exchange.address, _1e18(500));
    // await exch(exchange.connect(taker), msg, r, s, v); // TODO
  });

  it("exchange:bch-to-maker", async function () {
    expect(await wBCH.balanceOf(maker.address)).to.equal(_1e18(9));
    expect(await fUSD.balanceOf(taker.address)).to.equal(_1e18(4500));

    const dueTime = (Date.now() + 3600 * 1000) * 10**6;
    const msg = {
      coinsToMaker: concatAddressUint96(bchAddr, _1e18(1)),
      coinsToTaker: concatAddressUint96(wBCH.address, _1e18(1)),
      takerAddr_dueTime64: concatAddressUint64(taker.address, dueTime),
    }
    console.log(msg);

    const [r, s, v] = signRawMsg(exchange.address, msg, maker);
    // console.log('rsv:', r, s, v);

    // await bch.connect(maker).approve(exchange.address, _1e18(1));
    // await fUSD.connect(taker).approve(exchange.address, _1e18(500));
    // await exch(exchange.connect(taker), msg, r, s, v, _1e18(1)); // TODO
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
function exch(exchange, msg, r, s, v, bch) {
  return exchange.exchange(
    msg.coinsToMaker,
    msg.coinsToTaker,
    bnToHex(BigInt(msg.takerAddr_dueTime64) << 8n | BigInt(v)),
    r, s,
    {value: bch || 0}
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

function concatAddressUint96(addr, n) {
  return bnToHex(BigInt(addr) << 96n | BigInt(n));
}
function concatAddressUint64(addr, n) {
  return bnToHex(BigInt(addr) << 64n | BigInt(n));
}
function bnToHex(n) {
  return '0x' + n.toString(16);
}
function _1e18(n) {
  return (BigInt(n) * (10n ** 18n)).toString();
}
