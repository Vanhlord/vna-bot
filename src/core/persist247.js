const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.resolve(__dirname, "../../data");
const filePath = path.join(dataDir, "guilds247.json");

function ensureDirectory() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2), "utf8");
  }
}

class Persist247Service {
  static getAll() {
    ensureDirectory();
    try {
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content || "{}");
    } catch (_) {
      return {};
    }
  }

  static get(guildId) {
    const all = this.getAll();
    return all[guildId] || null;
  }

  static set(guildId, data) {
    ensureDirectory();
    const all = this.getAll();
    all[guildId] = {
      channelId: data.channelId,
      textChannelId: data.textChannelId,
      enabled: Boolean(data.enabled),
      updatedAt: Date.now(),
    };
    fs.writeFileSync(filePath, JSON.stringify(all, null, 2), "utf8");
    return all[guildId];
  }

  static remove(guildId) {
    ensureDirectory();
    const all = this.getAll();
    delete all[guildId];
    fs.writeFileSync(filePath, JSON.stringify(all, null, 2), "utf8");
  }

  static is247(guildId) {
    const data = this.get(guildId);
    return Boolean(data && data.enabled);
  }
}

module.exports = Persist247Service;
