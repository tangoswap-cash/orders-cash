require('dotenv').config()

require("ts-node").register({
  files: true,
});

const HDWalletProvider = require("@truffle/hdwallet-provider");

// const accounts = [process.env.DEPLOYER_PRIVATE_KEY, process.env.DEV_PRIVATE_KEY];
const accounts = [process.env.DEPLOYER_PRIVATE_KEY];
// console.log("accounts: ", accounts);

module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // to customize your Truffle configuration!
  networks: {
    development: {
      host: 'localhost',
      port: 9545,
      // network_id: '*',
      network_id: '10000',
      // gas: 8000000,
      gasPrice: 1000000000, // web3.eth.gasPrice
    },
    coverage: {
      host: 'localhost',
      port: 8555,
      network_id: '*',
      // gas: 8000000,
      gasPrice: 1000000000, // web3.eth.gasPrice
    },
    smartbch: {
      provider: () => new HDWalletProvider({
        providerOrUrl: "https://smartbch.fountainhead.cash/mainnet",
        // providerOrUrl: "https://smartbch.greyh.at",
        privateKeys: accounts,
      }),
      network_id: "10000",
      gasPrice: 1050000000,
    },
    "smartbch-amber": {
      provider: () => new HDWalletProvider({
        providerOrUrl: "http://35.220.203.194:8545",
        privateKeys: accounts,
      }),
      network_id: "10001",
      gasPrice: 1050000000,
      // host: "158.247.197.98",
      // port: 8545,
    },
  },
  compilers: {
    solc: {
      version: '0.8.10',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        }
      }
    },
  },
  mocha: { // https://github.com/cgewecke/eth-gas-reporter
    // before_timeout: 3000000, // <--- units in ms
    reporter: 'eth-gas-reporter',
    reporterOptions : {
      currency: 'USD',
      gasPrice: 10,
      onlyCalledMethods: true,
      showTimeSpent: true,
      excludeContracts: ['Migrations']
    }
  }
};
