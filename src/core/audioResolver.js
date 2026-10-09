const play = require("play-dl");
const { spawn } = require("node:child_process");
const { PassThrough } = require("node:stream");
const readline = require("node:readline");
const path = require("node:path");
const fs = require("node:fs");
const { StreamType } = require("@discordjs/voice");
const YtDlpManager = require("./ytdlpManager");
const FFmpegManager = require("./ffmpegManager");
const SpotifyResolver = require("./spotifyResolver");
const { registerChild } = require("./processGuard");

const cookiesDir = path.resolve(__dirname, "../../cookies");
const cookiesPath = path.resolve(cookiesDir, "cookies.txt");
const spotifyYoutubeCache = new Map();

function parseCookiesToHeaderString(content) {
  if (!content) return "";
  const pairs = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\t+/);
    if (parts.length >= 7) {
      const name = parts[5].trim();
      const value = parts[6].trim();
      if (name && value) {
        pairs.push(`${name}=${value}`);
      }
    }
  }
  return pairs.length > 0 ? pairs.join("; ") : content.replace(/[\r\n\t]/g, " ").trim();
}

// Tự động nạp YouTube cookies (nếu có từ file cookies.txt hoặc biến môi trường YOUTUBE_COOKIE)
async function initYouTubeCookies() {
  try {
    if (!fs.existsSync(cookiesDir)) {
      fs.mkdirSync(cookiesDir, { recursive: true });
    }

    const envCookie = process.env.YOUTUBE_COOKIE_CONTENT || process.env.YOUTUBE_COOKIE;
    if (envCookie && !fs.existsSync(cookiesPath)) {
      fs.writeFileSync(cookiesPath, envCookie, "utf8");
      console.log("[AUDIO-RESOLVER] 🍪 Đã khởi tạo cookies.txt từ biến môi trường YOUTUBE_COOKIE!");
    }

    if (fs.existsSync(cookiesPath)) {
      const cookieContent = fs.readFileSync(cookiesPath, "utf8").trim();
      if (cookieContent) {
        const headerCookie = parseCookiesToHeaderString(cookieContent);
        if (headerCookie) {
          await play.setToken({
            youtube: { cookie: headerCookie },
          }).catch((e) => {
            console.warn(`[AUDIO-RESOLVER] play.setToken warning: ${e.message}`);
          });
          console.log(`[AUDIO-RESOLVER] 🍪 Đã áp dụng YouTube cookies cho play-dl!`);
        }
      }
    }
  } catch (err) {
    console.warn(`[AUDIO-RESOLVER] Lỗi khởi tạo cookie: ${err.message}`);
  }
}

initYouTubeCookies();

function isValidHttpUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function getPlayableYoutubeUrl(item) {
  if (!item) return null;
  if (isValidHttpUrl(item.url)) return item.url;
  if (item.id) return `https://www.youtube.com/watch?v=${item.id}`;
  return null;
}

class AudioResolver {
  static normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  static scoreYoutubeMatch(track, video) {
    const candidateTitle = this.normalizeSearchText(video?.title);
    const wantedTitle = this.normalizeSearchText(track?.spotifyTitle || track?.title);
    const wantedArtist = this.normalizeSearchText(track?.spotifyArtist || track?.author);
    let score = 0;

    if (wantedTitle && candidateTitle.includes(wantedTitle)) score += 8;
    if (wantedArtist && candidateTitle.includes(wantedArtist)) score += 5;

    const wantedWords = new Set(wantedTitle.split(" ").filter((word) => word.length > 2));
    const candidateWords = new Set(candidateTitle.split(" "));
    for (const word of wantedWords) {
      if (candidateWords.has(word)) score += 1;
    }

    const expectedDuration = Number(track?.durationSec) || 0;
    const actualDuration = Number(video?.durationInSec) || 0;
    if (expectedDuration && actualDuration) {
      const difference = Math.abs(expectedDuration - actualDuration);
      if (difference <= 5) score += 6;
      else if (difference <= 15) score += 3;
      else if (difference <= 30) score += 1;
      else if (difference >= 90) score -= 5;
    }

    const unwantedVersion = /\b(cover|karaoke|nightcore|slowed|reverb|instrumental|sped up|live)\b/i;
    const wantedVersion = this.normalizeSearchText(`${track?.spotifyTitle || ""} ${track?.spotifyArtist || ""}`);
    if (unwantedVersion.test(candidateTitle) && !unwantedVersion.test(wantedVersion)) score -= 6;
    return score;
  }

  static selectBestYoutubeMatch(track, videos) {
    return [...(videos || [])]
      .filter((video) => Boolean(getPlayableYoutubeUrl(video)))
      .sort((a, b) => this.scoreYoutubeMatch(track, b) - this.scoreYoutubeMatch(track, a))[0] || null;
  }

  static async resolveSpotifyYoutubeUrl(track) {
    const cacheKey = track.spotifyUri || track.url || track.searchQuery || track.title;
    if (spotifyYoutubeCache.has(cacheKey)) return spotifyYoutubeCache.get(cacheKey);

    const query = track.searchQuery || `${track.spotifyTitle || track.title} ${track.spotifyArtist || track.author}`;
    let targetUrl = null;

    try {
      const results = await play.search(query, { limit: 8, source: { youtube: "video" } });
      const best = this.selectBestYoutubeMatch(track, results);
      targetUrl = getPlayableYoutubeUrl(best);
    } catch (error) {
      console.warn(`[SPOTIFY] Tìm kiếm YouTube qua play-dl thất bại: ${error.message}`);
    }

    if (!targetUrl) {
      const info = await this.extractInfoWithYtDlp(`ytsearch1:${query}`);
      targetUrl = info?.webpage_url || (info?.id ? `https://www.youtube.com/watch?v=${info.id}` : null);
    }

    if (!targetUrl || !isValidHttpUrl(targetUrl)) {
      throw new Error(`Không tìm thấy bản phát phù hợp trên YouTube cho "${track.title}".`);
    }

    spotifyYoutubeCache.set(cacheKey, targetUrl);
    if (spotifyYoutubeCache.size > 500) {
      spotifyYoutubeCache.delete(spotifyYoutubeCache.keys().next().value);
    }
    return targetUrl;
  }

  static createYoutubeTrack(video, requestedBy) {
    return {
      title: video?.title || "Unknown Title",
      url: getPlayableYoutubeUrl(video) || video?.url,
      duration: video?.durationRaw || "Unknown",
      durationSec: video?.durationInSec || 0,
      thumbnail: video?.thumbnails?.[0]?.url || "",
      author: video?.channel?.name || "Unknown Artist",
      requestedBy,
    };
  }

  static createYtDlpTrack(info, requestedBy) {
    const thumbnail = info?.thumbnail || info?.thumbnails?.at?.(-1)?.url || "";
    return {
      title: info?.title || "Unknown Title",
      url: info?.webpage_url || info?.url || (info?.id ? `https://www.youtube.com/watch?v=${info.id}` : ""),
      duration: info?.duration_string || "Unknown",
      durationSec: Number(info?.duration) || 0,
      thumbnail,
      author: info?.uploader || info?.channel || "Unknown Artist",
      requestedBy,
    };
  }

  /**
   * YouTube Mixes (playlist ids beginning with RD) do not reliably expose
   * continuation pages to play-dl. yt-dlp emits one JSON record per item,
   * allowing us to receive the first song and continue consuming the rest.
   */
  static async startYoutubePlaylistWithYtDlp(query, requestedBy = "Unknown") {
    const binPath = await YtDlpManager.getBinaryPath();
    const args = [
      query,
      "--flat-playlist",
      "--dump-json",
      "--ignore-errors",
      "--no-warnings",
      "--no-check-certificates",
      "--extractor-args", "youtube:player_client=ios,tv,web",
    ];

    if (fs.existsSync(cookiesPath)) args.push("--cookies", cookiesPath);

    const proc = registerChild(
      spawn(binPath, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
    );
    const entries = [];
    const waiters = [];
    let ended = false;
    let processError = null;

    const resolveWaiters = () => {
      while (waiters.length && entries.length) {
        waiters.shift().resolve(entries.shift());
      }
      if (ended && entries.length === 0) {
        while (waiters.length) {
          const waiter = waiters.shift();
          if (processError) waiter.reject(processError);
          else waiter.resolve(null);
        }
      }
    };

    const nextEntry = () => new Promise((resolve, reject) => {
      if (entries.length) return resolve(entries.shift());
      if (ended) return processError ? reject(processError) : resolve(null);
      waiters.push({ resolve, reject });
    });

    const lines = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      try {
        entries.push(JSON.parse(line));
        resolveWaiters();
      } catch (_) {}
    });
    proc.on("error", (error) => {
      processError = error;
      ended = true;
      resolveWaiters();
    });
    proc.on("close", (code) => {
      ended = true;
      if (code !== 0 && entries.length === 0) {
        processError = new Error(`yt-dlp không thể đọc playlist (mã lỗi ${code}).`);
      }
      resolveWaiters();
    });

    let timeoutId;
    try {
      const firstInfo = await Promise.race([
        nextEntry(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("Hết thời gian chờ lấy bài đầu tiên từ YouTube Mix.")), 30_000);
        }),
      ]);
      if (!firstInfo) throw new Error("Playlist không có bài hát nào có thể phát.");

      const firstTrack = this.createYtDlpTrack(firstInfo, requestedBy);
      if (!firstTrack.url) throw new Error("Không thể lấy đường dẫn bài đầu tiên từ playlist.");
      const totalTracks = Number(firstInfo.playlist_count || firstInfo.n_entries || firstInfo.__last_playlist_index) || null;
      const playlistTitle = firstInfo.playlist_title || firstInfo.playlist || "YouTube Mix";

      return {
        type: "playlist-progressive",
        playlistTitle,
        firstTrack,
        totalTracks,
        async loadRemaining(onBatch) {
          let loaded = 1;
          try {
            while (true) {
              const info = await nextEntry();
              if (!info) break;
              const track = AudioResolver.createYtDlpTrack(info, requestedBy);
              if (!track.url) continue;
              loaded += 1;
              if ((await onBatch([track], { loaded, totalTracks })) === false) {
                proc.kill();
                return { loaded, totalTracks, cancelled: true };
              }
            }
            return { loaded, totalTracks, cancelled: false };
          } finally {
            if (!ended) proc.kill();
          }
        },
      };
    } catch (error) {
      proc.kill();
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Opens a YouTube playlist without waiting for every page to download.
   * The caller gets the first track immediately, then consumes the remaining
   * tracks through loadRemaining while music is already playing.
   */
  static async startYoutubePlaylist(query, requestedBy = "Unknown") {
    const trimmed = (query || "").trim();
    if (!trimmed || (await play.validate(trimmed)) !== "yt_playlist") return null;

    // RD is the prefix used by YouTube Mix / radio playlists.
    // These are dynamic playlists, which play-dl can keep waiting on forever.
    try {
      const playlistId = new URL(trimmed).searchParams.get("list") || "";
      if (playlistId.startsWith("RD")) {
        return await this.startYoutubePlaylistWithYtDlp(trimmed, requestedBy);
      }
    } catch (_) {}

    const playlist = await play.playlist_info(trimmed, { incomplete: true });
    let initialVideos = Array.isArray(playlist.videos) ? [...playlist.videos] : [];

    // Rarely, YouTube returns an empty first page. Fetch until the first
    // playable item is available, but do not fetch the whole playlist here.
    while (initialVideos.length === 0) {
      const nextPage = await playlist.next();
      if (!nextPage?.length) {
        throw new Error("Playlist không có bài hát nào có thể phát.");
      }
      initialVideos = nextPage;
    }

    const firstTrack = this.createYoutubeTrack(initialVideos.shift(), requestedBy);
    const totalTracks = Number.isFinite(Number(playlist.videoCount)) && Number(playlist.videoCount) > 0
      ? Number(playlist.videoCount)
      : null;

    return {
      type: "playlist-progressive",
      playlistTitle: playlist.title || "YouTube Playlist",
      firstTrack,
      totalTracks,
      /**
       * Calls onBatch with each new batch. Return false from onBatch to stop
       * downloading when the queue was removed or the bot was stopped.
       */
      async loadRemaining(onBatch) {
        let loaded = 1;

        const deliver = async (videos) => {
          const tracks = videos
            .map((video) => AudioResolver.createYoutubeTrack(video, requestedBy))
            .filter((track) => Boolean(track.url));
          loaded += tracks.length;
          if (tracks.length === 0) return true;
          return (await onBatch(tracks, { loaded, totalTracks })) !== false;
        };

        if (!(await deliver(initialVideos))) return { loaded, totalTracks, cancelled: true };

        while (true) {
          const nextPage = await playlist.next();
          if (!nextPage?.length) break;
          if (!(await deliver(nextPage))) return { loaded, totalTracks, cancelled: true };
        }

        return { loaded, totalTracks, cancelled: false };
      },
    };
  }

  /**
   * Autocomplete live search
   */
  static async searchAutocomplete(query, limit = 5) {
    if (!query || typeof query !== "string" || !query.trim()) return [];
    try {
      const results = await play.search(query.trim(), {
        limit: Math.min(limit, 10),
        source: { youtube: "video" },
      });
      return (results || []).map((video) => {
        const url = getPlayableYoutubeUrl(video) || video.url;
        return {
          name: `${video.title || "Unknown"} (${video.durationRaw || "Live"})`.slice(0, 100),
          value: url,
        };
      });
    } catch (_) {
      return [];
    }
  }

  /**
   * Resolve a search string or URL to track(s)
   */
  static async resolve(query, requestedBy = "Unknown") {
    const trimmed = (query || "").trim();
    if (!trimmed) throw new Error("Vui lòng cung cấp link hoặc tên bài hát!");

    // Spotify public links are resolved from the embed metadata and do not
    // require a Spotify API key. Handle them before play-dl validation because
    // play-dl throws when no Spotify credential has ever been configured.
    if (SpotifyResolver.isSpotifyUrl(trimmed)) {
      try {
        return await SpotifyResolver.resolve(trimmed, requestedBy);
      } catch (error) {
        throw new Error(`Không thể đọc link Spotify: ${error.message}`);
      }
    }

    const validateType = await play.validate(trimmed);

    // 1. YouTube Video
    if (validateType === "yt_video") {
      try {
        const info = await play.video_basic_info(trimmed);
        const details = info?.video_details;
        const url = getPlayableYoutubeUrl(details) || trimmed;
        return {
          type: "single",
          tracks: [
            {
              title: details?.title || "Unknown Title",
              url,
              duration: details?.durationRaw || "Live",
              durationSec: details?.durationInSec || 0,
              thumbnail: details?.thumbnails?.[0]?.url || "",
              author: details?.channel?.name || "Unknown Artist",
              requestedBy,
            },
          ],
        };
      } catch (err) {
        console.warn(`[AUDIO-RESOLVER] play-dl video_basic_info failed: ${err.message}. Trying yt-dlp fallback...`);
      }
    }

    // 2. YouTube Playlist
    if (validateType === "yt_playlist") {
      try {
        const playlist = await play.playlist_info(trimmed, { incomplete: true });
        const allVideos = await playlist.all_videos();
        const tracks = allVideos.map((video) => this.createYoutubeTrack(video, requestedBy));
        return {
          type: "playlist",
          playlistTitle: playlist.title || "YouTube Playlist",
          tracks,
        };
      } catch (err) {
        console.warn(`[AUDIO-RESOLVER] play-dl playlist_info failed: ${err.message}.`);
      }
    }

    // 3. Keyword Search via play-dl
    try {
      const searchResults = await play.search(trimmed, { limit: 5, source: { youtube: "video" } });
      if (searchResults && searchResults.length > 0) {
        const video = searchResults[0];
        const url = getPlayableYoutubeUrl(video) || video.url;
        return {
          type: "single",
          tracks: [
            {
              title: video.title || "Unknown Title",
              url,
              duration: video.durationRaw || "Live",
              durationSec: video.durationInSec || 0,
              thumbnail: video.thumbnails?.[0]?.url || "",
              author: video.channel?.name || "Unknown Artist",
              requestedBy,
            },
          ],
        };
      }
    } catch (_) {}

    // 4. Fallback: Search / Extract via yt-dlp binary directly
    console.log(`[AUDIO-RESOLVER] Searching via yt-dlp for "${trimmed}"...`);
    const ytdlpInfo = await this.extractInfoWithYtDlp(trimmed.startsWith("http") ? trimmed : `ytsearch1:${trimmed}`);
    if (ytdlpInfo) {
      return {
        type: "single",
        tracks: [
          {
            title: ytdlpInfo.title || trimmed,
            url: ytdlpInfo.webpage_url || (ytdlpInfo.id ? `https://www.youtube.com/watch?v=${ytdlpInfo.id}` : trimmed),
            duration: ytdlpInfo.duration_string || "Live",
            durationSec: ytdlpInfo.duration || 0,
            thumbnail: ytdlpInfo.thumbnail || "",
            author: ytdlpInfo.uploader || ytdlpInfo.channel || "Artist",
            requestedBy,
          },
        ],
      };
    }

    throw new Error(`Không tìm thấy hoặc không thể trích xuất thông tin bài hát từ "${trimmed}". Vui lòng thử lại với từ khóa hoặc đường link khác!`);
  }

  /**
   * Helper: Execute yt-dlp to dump JSON info with automatic bot-block bypass
   */
  static async extractInfoWithYtDlp(targetUrl, retryCount = 0) {
    const binPath = await YtDlpManager.getBinaryPath();
    const isSearch = targetUrl.startsWith("ytsearch");
    const useCookies = !isSearch && retryCount === 0 && fs.existsSync(cookiesPath);

    const args = [
      targetUrl,
      "--dump-single-json",
      "--no-warnings",
      "--no-check-certificates",
      "--prefer-free-formats",
    ];

    if (useCookies) {
      args.push("--cookies", cookiesPath);
    } else if (!isSearch && process.env.YOUTUBE_COOKIE && retryCount === 0) {
      args.push("--add-header", `Cookie: ${process.env.YOUTUBE_COOKIE}`);
    }

    if (retryCount > 0) {
      args.push("--extractor-args", "youtube:player_client=ios,tv");
    }

    return new Promise((resolve) => {
      const proc = registerChild(spawn(binPath, args, { stdio: ["ignore", "pipe", "pipe"] }));
      let output = "";
      let errorOutput = "";

      proc.stdout.on("data", (chunk) => {
        output += chunk;
      });

      proc.stderr.on("data", (chunk) => {
        errorOutput += chunk;
      });

      proc.on("close", async (code) => {
        if (code === 0 && output.trim()) {
          try {
            const data = JSON.parse(output);
            const item = data.entries ? data.entries[0] : data;
            return resolve(item);
          } catch (_) {}
        }
        if (code !== 0 && errorOutput.trim()) {
          console.warn(`[YT-DLP ERROR]: code ${code} | ${errorOutput.trim().split("\n")[0].slice(0, 250)}`);
          if (retryCount === 0) {
            console.warn(`[YT-DLP] 🛡️ Tự động thử lại chế độ TV/iOS bypass không dùng cookies...`);
            const retryResult = await AudioResolver.extractInfoWithYtDlp(targetUrl, 1);
            return resolve(retryResult);
          }
        }
        resolve(null);
      });

      proc.on("error", (err) => {
        console.warn(`[YT-DLP SPAWN ERROR]: ${err.message}`);
        resolve(null);
      });
    });
  }

  /**
   * Create Hi-Fi Studio Audio Stream (320kbps Opus Music Profile)
   */
  static async getAudioStream(track) {
    let targetUrl = track.url;

    // If Spotify, search on YouTube first
    if (track.isSpotify) {
      targetUrl = await this.resolveSpotifyYoutubeUrl(track);
    }

    console.log(`[AUDIO-RESOLVER] Extracting Hi-Fi audio stream for "${track.title}" (${targetUrl})...`);

    // 1. Primary: yt-dlp + ffmpeg Hi-Fi Pipeline
    try {
      const info = await this.extractInfoWithYtDlp(targetUrl);
      if (info) {
        const audioFormats = (info.formats || []).filter(
          (f) => f.url && f.acodec && f.acodec !== "none" && !f.format_id?.startsWith("sb") && f.ext !== "mhtml"
        );

        audioFormats.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));

        const selectedFormat =
          audioFormats.find((f) => f.acodec?.includes("opus")) ||
          audioFormats.find((f) => f.ext === "m4a") ||
          audioFormats[0] ||
          info;

        const streamUrl = selectedFormat?.url || info.url;
        if (streamUrl && isValidHttpUrl(streamUrl)) {
          const ffmpegPath = await FFmpegManager.getBinaryPath();

          const defaultHeaders = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Mode": "navigate",
          };
          const headerLines =
            Object.entries(defaultHeaders)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\r\n") + "\r\n";

          const volFloat = "0.70";

          // Studio Quality 320kbps Opus Music Encoder Profile with anti-burst packet flush
          const ffmpegArgs = [
            "-hide_banner",
            "-loglevel", "error",
            "-nostdin",
            "-threads", "2",
            "-headers", headerLines,
            "-thread_queue_size", "4096",
            "-probesize", "65536",
            "-analyzeduration", "1000000",
            "-fflags", "+flush_packets",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
            "-i", streamUrl,
            "-vn",
            "-af", `volume=${volFloat}`,
            "-c:a", "libopus",
            "-b:a", "320k",
            "-vbr", "on",
            "-application", "audio",
            "-compression_level", "10",
            "-cutoff", "20000",
            "-ar", "48000",
            "-ac", "2",
            "-f", "ogg",
            "pipe:1",
          ];

          const ffmpegProcess = registerChild(
            spawn(ffmpegPath, ffmpegArgs, {
              windowsHide: true,
              stdio: ["ignore", "pipe", "ignore"],
            })
          );

          const passThrough = new PassThrough({ highWaterMark: 1024 * 512 });
          ffmpegProcess.stdout.pipe(passThrough);

          ffmpegProcess.on("error", (err) => {
            console.error(`[FFMPEG ERROR] ${err.message}`);
            passThrough.destroy(err);
          });

          passThrough.on("close", () => {
            if (!ffmpegProcess.killed) ffmpegProcess.kill("SIGKILL");
          });

          return {
            stream: passThrough,
            type: StreamType.OggOpus,
            engine: "yt-dlp+ffmpeg-hifi",
          };
        }
      }
    } catch (ytdlpErr) {
      console.warn(`[AUDIO-RESOLVER] yt-dlp stream pipeline failed: ${ytdlpErr.message}. Trying play-dl fallback...`);
    }

    // 2. Secondary / Fallback: play-dl stream
    try {
      console.log(`[AUDIO-RESOLVER] Attempting play-dl stream fallback for "${track.title}" (${targetUrl})...`);
      const playStream = await play.stream(targetUrl);
      if (playStream && playStream.stream) {
        return {
          stream: playStream.stream,
          type: playStream.type || StreamType.Arbitrary,
          engine: "play-dl-fallback",
        };
      }
    } catch (playDlErr) {
      console.warn(`[AUDIO-RESOLVER] play-dl fallback stream failed: ${playDlErr.message}`);
    }

    throw new Error("Không thể trích xuất luồng âm thanh từ YouTube (video bị giới hạn bản quyền, yêu cầu đăng nhập hoặc lỗi kết nối tạm thời).");
  }
}

module.exports = AudioResolver;
