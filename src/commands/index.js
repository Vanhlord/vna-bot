const playCommand = require("./play");
const playlistCommand = require("./playlist");
const joinCommand = require("./join");
const leaveCommand = require("./leave");
const treoCommand = require("./treo");
const mode247Command = require("./mode247");
const skipCommand = require("./skip");
const pauseCommand = require("./pause");
const resumeCommand = require("./resume");
const loopCommand = require("./loop");
const shuffleCommand = require("./shuffle");
const queueCommand = require("./queue");
const nowplayingCommand = require("./nowplaying");
const helpCommand = require("./help");

const commands = [
  playCommand,
  playlistCommand,
  joinCommand,
  leaveCommand,
  treoCommand,
  mode247Command,
  skipCommand,
  pauseCommand,
  resumeCommand,
  loopCommand,
  shuffleCommand,
  queueCommand,
  nowplayingCommand,
  helpCommand,
];

const commandMap = new Map();
commands.forEach((cmd) => {
  commandMap.set(cmd.data.name, cmd);
});

module.exports = {
  commands,
  commandMap,
};
