module.exports = async function ({
    ethers,
    getNamedAccounts,
    deployments,
    getChainId,
  }) {
    console.log("-------------------------------------------- 1");
    const { deploy } = deployments;
    console.log("-------------------------------------------- 2");

    const { deployer, dev } = await getNamedAccounts();
    console.log("-------------------------------------------- 3");
    console.log("deploy:   ", deploy);
    console.log("deployer: ", deployer);

    await deploy("OrdersCashV1", {
      from: deployer,
      log: true,
      deterministicDeployment: false,
    });
};

module.exports.tags = ["OrdersCashV1"];
