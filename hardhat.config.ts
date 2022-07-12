// hardhat.config.ts

import "dotenv/config"
import "@nomiclabs/hardhat-solhint"
import "@nomiclabs/hardhat-waffle"
import "hardhat-abi-exporter"
import "hardhat-deploy"
import "hardhat-deploy-ethers"
import "hardhat-gas-reporter"
import "hardhat-spdx-license-identifier"
// import "hardhat-typechain"
import "hardhat-watcher"
import "solidity-coverage"
// import "./tasks"
import "@typechain/hardhat"

import { HardhatUserConfig } from "hardhat/types"
import { removeConsoleLog } from "hardhat-preprocessor"

declare var process : {
  env: {
    DEPLOYER_PRIVATE_KEY: string,
    DEV_PRIVATE_KEY: string,
    TESTER_PRIVATE_KEY: string,
    COINMARKETCAP_API_KEY: string,
    REPORT_GAS: string,
    FORKING: string,
  }
}

const privateKeys : string[] = [process.env.DEPLOYER_PRIVATE_KEY, process.env.DEV_PRIVATE_KEY, process.env.TESTER_PRIVATE_KEY]

const config: HardhatUserConfig = {
  abiExporter: {
    path: "./abi",
    clear: false,
    flat: true,
    // only: [],
    // except: []
  },
  defaultNetwork: "hardhat",
  gasReporter: {
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    currency: "USD",
    enabled: process.env.REPORT_GAS === "true",
    excludeContracts: ["contracts/mocks/", "contracts/libraries/"],
  },
  mocha: {
    timeout: 20000,
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
    dev: {
      // Default to 1
      default: 1,
      // dev address mainnet
      // 1: "",
    },
    tester: {
      default: 2,
    },
  },
  networks: {
    // localhost: {
    //   live: false,
    //   saveDeployments: true,
    //   tags: ["local"],
    // },
    hardhat: {
      forking: {
        enabled: true, //process.env.FORKING === "true",
        url: `https://smartbch.fountainhead.cash/mainnet`,
        // url: `https://smartbch.greyh.at`,
        // blockNumber: 639620,
        blockNumber: 5320762,
        // gasPrice: 1000000000, // web3.eth.gasPrice
      },
      live: false,
      saveDeployments: true,
      tags: ["test", "local"],
      chainId: 10000,
      gasPrice: 1050000000,
    },
    // smartbch: {
    //   url: "https://smartbch.fountainhead.cash/mainnet",
    //   // url: "https://smartbch.greyh.at",
    //   // accounts: privateKeys,
    //   chainId: 10000,
    //   live: true,
    //   saveDeployments: true,
    //   gasMultiplier: 2,
    // },
    // "smartbch-amber": {
    //   url: "http://35.220.203.194:8545",
    //   // url: "https://moeing.tech:9545",
    //   // accounts: privateKeys,
    //   chainId: 10001,
    //   live: true,
    //   saveDeployments: true,
    //   tags: ["staging"],
    //   gasMultiplier: 2,
    // },
  },
  paths: {
    artifacts: "artifacts",
    cache: "cache",
    deploy: "deploy",
    deployments: "deployments",
    imports: "imports",
    sources: "contracts",
    tests: "test",
  },
  preprocess: {
    eachLine: removeConsoleLog((bre) => bre.network.name !== "hardhat" && bre.network.name !== "localhost"),
  },
  solidity: {
    compilers: [
      {
        version: "0.8.10",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  spdxLicenseIdentifier: {
    overwrite: false,
    runOnCompile: true,
  },
  typechain: {
    outDir: "types",
    target: "ethers-v5",
  },
  watcher: {
    compile: {
      tasks: ["compile"],
      files: ["./contracts"],
      verbose: true,
    },
  },
}

export default config


// module.exports = {
//   solidity: {
//     version: "0.8.10",
//     settings: {
//       optimizer: {
//         enabled: true,
//         runs: 200,
//       },
//     },
//   },
//   networks: {
//     sbch_local_node: {
//       url: `http://localhost:8545`,
//       network_id: 10000,
//       gasPrice: 10000000000,
//       timeout: 100000
//     },
//   },
// };
