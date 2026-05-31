const basePath = process.cwd();
const fs = require("fs");
const path = require("path");
const {
  renderBatch,
  buildSetup: engineBuildSetup,
} = require("../packages/engine/src/index.js");

const config = require(`${basePath}/src/config.js`);
const buildDir = `${basePath}/build`;
const layersDir = `${basePath}/layers`;

const buildSetup = () => {
  engineBuildSetup(buildDir, config.gif?.export || false);
};

const startCreating = async () => {
  await renderBatch(config, {
    layersDir,
    outputDir: buildDir,
    onProgress: ({ completed, total, edition }) => {
      console.log(`Created edition: ${edition} (${completed}/${total})`);
    },
  });
};

module.exports = { startCreating, buildSetup, getElements: require("../packages/engine/src/layers.js").getElements };
