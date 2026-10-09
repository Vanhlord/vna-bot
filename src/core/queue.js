/**
 * Guild Music Queue & State Manager
 */
class GuildQueue {
  constructor(guildId, options = {}) {
    this.guildId = guildId;
    this.textChannel = options.textChannel || null;
    this.voiceChannel = options.voiceChannel || null;
    this.tracks = [];
    this.currentTrack = null;
    this.loopMode = "off"; // "off" | "track" | "queue"
    this.player = null;
    this.connection = null;
    this.resource = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.playbackStartTime = 0;
    this.pausedAt = 0;
    this.idleTimer = null;
    this.progressInterval = null;
    this.currentTrackMessage = null;
    this.lastInteraction = null;
    this.isTransitioning = false;
    // True while a voice join is still in flight; used to suppress the
    // auto-leave-on-empty handler so a freshly joined channel is not abandoned.
    this.isJoining = false;
    this.pendingEndContext = null;
    this.lifecycleId = 0;
    // Number of playlist imports that are still fetching tracks in the background.
    this.activePlaylistLoads = 0;
  }

  addTrack(track) {
    this.tracks.push(track);
    return this.tracks.length;
  }

  addTracks(trackArray) {
    this.tracks.push(...trackArray);
    return this.tracks.length;
  }

  getNextTrack(options = {}) {
    const ignoreCurrentLoop = Boolean(options.ignoreCurrentLoop);

    if (!ignoreCurrentLoop && this.loopMode === "track" && this.currentTrack) {
      return this.currentTrack;
    }

    if (!ignoreCurrentLoop && this.loopMode === "queue" && this.currentTrack) {
      this.tracks.push(this.currentTrack);
    }

    this.currentTrack = this.tracks.shift() || null;
    return this.currentTrack;
  }

  shuffle() {
    if (this.tracks.length <= 1) return;
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
  }

  setLoop(mode) {
    if (["off", "track", "queue"].includes(mode)) {
      this.loopMode = mode;
    } else {
      // Toggle cycle: off -> track -> queue -> off
      if (this.loopMode === "off") this.loopMode = "track";
      else if (this.loopMode === "track") this.loopMode = "queue";
      else this.loopMode = "off";
    }
    return this.loopMode;
  }

  clear() {
    this.tracks = [];
  }

  remove(index) {
    if (index >= 0 && index < this.tracks.length) {
      return this.tracks.splice(index, 1)[0];
    }
    return null;
  }

  getPlaybackDuration() {
    if (!this.isPlaying) return 0;
    if (this.isPaused) return Math.floor((this.pausedAt - this.playbackStartTime) / 1000);
    return Math.floor((Date.now() - this.playbackStartTime) / 1000);
  }

  getProgressBar(size = 16) {
    const elapsedSec = this.getPlaybackDuration();
    const totalSec = Number(this.currentTrack?.durationSec) > 0 ? Number(this.currentTrack.durationSec) : null;

    const formatTime = (sec) => {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };

    if (!totalSec) {
      return `\`[ LIVE ]\`  \`${formatTime(elapsedSec)}\``;
    }

    const safeTotal = Math.max(1, totalSec);
    const safeCurrent = Math.max(0, Math.min(elapsedSec, safeTotal));
    const ratio = safeCurrent / safeTotal;
    const filled = Math.round(ratio * size);
    const bar = "▰".repeat(filled) + "▱".repeat(Math.max(0, size - filled));

    return `\`${bar}\`  \`${formatTime(safeCurrent)} / ${formatTime(safeTotal)}\``;
  }
}

module.exports = GuildQueue;
