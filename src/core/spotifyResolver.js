const createSpotifyClient = require("spotify-url-info");

const spotifyClient = createSpotifyClient(fetch);
const SUPPORTED_TYPES = new Set(["track", "album", "playlist"]);
const SPOTIFY_HOSTS = new Set([
  "open.spotify.com",
  "play.spotify.com",
  "spotify.link",
  "spotify.app.link",
]);

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  const remaining = String(value % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function spotifyUriToUrl(uri, fallbackUrl) {
  const match = String(uri || "").match(/^spotify:track:([A-Za-z0-9]+)$/);
  return match ? `https://open.spotify.com/track/${match[1]}` : fallbackUrl;
}

class SpotifyResolver {
  static isSpotifyUrl(value) {
    try {
      return SPOTIFY_HOSTS.has(new URL(String(value)).hostname.toLowerCase());
    } catch (_) {
      return false;
    }
  }

  static normalizeOpenUrl(value) {
    const parsed = new URL(String(value));
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "open.spotify.com" && hostname !== "play.spotify.com") {
      return parsed.toString();
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0]?.toLowerCase().startsWith("intl-")) parts.shift();
    const type = String(parts[0] || "").toLowerCase();
    const id = String(parts[1] || "").trim();

    if (!SUPPORTED_TYPES.has(type) || !/^[A-Za-z0-9]+$/.test(id)) {
      throw new Error("Link Spotify phải là bài hát, album hoặc playlist công khai.");
    }

    return `https://open.spotify.com/${type}/${id}`;
  }

  static async resolveShareUrl(value, fetchImpl = fetch) {
    const parsed = new URL(String(value));
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "spotify.link" && hostname !== "spotify.app.link") {
      return this.normalizeOpenUrl(parsed.toString());
    }

    const response = await fetchImpl(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145 Safari/537.36",
      },
    });
    await response.body?.cancel?.().catch(() => {});
    if (!response.ok) throw new Error(`Spotify trả về HTTP ${response.status}.`);
    return this.normalizeOpenUrl(response.url);
  }

  static createTrack(track, preview, sourceUrl, requestedBy) {
    const name = String(track?.name || preview?.track || preview?.title || "").trim();
    const artist = String(track?.artist || preview?.artist || "Spotify Artist").trim();
    if (!name) return null;

    const durationSec = Math.max(0, Math.round((Number(track?.duration) || 0) / 1000));
    return {
      title: artist ? `${name} - ${artist}` : name,
      url: spotifyUriToUrl(track?.uri, preview?.link || sourceUrl),
      duration: durationSec ? formatDuration(durationSec) : "Unknown",
      durationSec,
      thumbnail: preview?.image || "",
      author: artist || "Spotify Artist",
      requestedBy,
      isSpotify: true,
      spotifyTitle: name,
      spotifyArtist: artist,
      spotifyUri: track?.uri || "",
      searchQuery: `${name} ${artist} official audio`.trim(),
    };
  }

  static async resolve(value, requestedBy = "Unknown", dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl || fetch;
    const sourceUrl = await this.resolveShareUrl(value, fetchImpl);
    const getDetails = dependencies.getDetails || spotifyClient.getDetails;
    const details = await getDetails(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145 Safari/537.36",
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    const preview = details?.preview || {};
    const type = String(preview.type || "").toLowerCase();
    if (!SUPPORTED_TYPES.has(type)) {
      throw new Error("Link Spotify này không phải bài hát, album hoặc playlist được hỗ trợ.");
    }

    const tracks = (details?.tracks || [])
      .map((track) => this.createTrack(track, preview, sourceUrl, requestedBy))
      .filter(Boolean);
    if (tracks.length === 0) {
      throw new Error("Spotify không cung cấp bài hát nào từ playlist này. Playlist có thể đang riêng tư hoặc trống.");
    }

    return {
      type: type === "track" ? "single" : "playlist",
      playlistTitle: preview.title || (type === "album" ? "Spotify Album" : "Spotify Playlist"),
      tracks,
    };
  }
}

module.exports = SpotifyResolver;
