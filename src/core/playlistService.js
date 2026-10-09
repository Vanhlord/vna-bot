const fs = require("node:fs");
const path = require("node:path");

// Thư mục musiclist dùng chung ở thư mục gốc của dự án (nếu chạy local)
const MUSICLIST_DIR = path.resolve(__dirname, "../../../musiclist");
const MAIN_BOT_API_URL = (process.env.MAIN_BOT_API_URL || "https://vnasss.com").replace(/\/+$/, "");

// Bộ nhớ đệm danh sách phát khi chạy trên Hosting độc lập
const remotePlaylistCache = {
  lists: [],
  details: new Map(),
  lastSync: 0,
};

async function syncPlaylistsFromMainBot() {
  if (!MAIN_BOT_API_URL) return;
  try {
    const res = await fetch(`${MAIN_BOT_API_URL}/api/playlists`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && Array.isArray(data.playlists)) {
      remotePlaylistCache.lists = data.playlists;
      for (const pl of data.playlists) {
        try {
          const detRes = await fetch(`${MAIN_BOT_API_URL}/api/playlists/${encodeURIComponent(pl.name)}`, {
            signal: AbortSignal.timeout(6000),
          });
          if (detRes.ok) {
            const detData = await detRes.json();
            if (detData.success && detData.playlist) {
              remotePlaylistCache.details.set(pl.name, detData.playlist);
            }
          }
        } catch {}
      }
      remotePlaylistCache.lastSync = Date.now();
      console.log(`[PLAYLIST SYNC] Đã đồng bộ ${data.playlists.length} playlists từ Bot Main (${MAIN_BOT_API_URL})!`);
    }
  } catch (err) {
    // Không làm phiền console nếu mạng chập chờn
  }
}

// Chạy đồng bộ ngay và lặp lại mỗi 30s
syncPlaylistsFromMainBot();
setInterval(syncPlaylistsFromMainBot, 30000).unref();

function ensureMusiclistDir() {
  if (!fs.existsSync(MUSICLIST_DIR)) {
    try {
      fs.mkdirSync(MUSICLIST_DIR, { recursive: true });
    } catch {}
  }
}

function sanitizePlaylistName(name) {
  if (!name) return "";
  let safe = name.replace(/[/\\:*?"<>|]/g, "").trim();
  if (safe.toLowerCase().endsWith(".txt")) {
    safe = safe.slice(0, -4).trim();
  }
  return safe;
}

function findActualPlaylistName(name) {
  const safe = sanitizePlaylistName(name);
  if (!safe) return null;
  ensureMusiclistDir();
  if (fs.existsSync(MUSICLIST_DIR)) {
    try {
      const files = fs.readdirSync(MUSICLIST_DIR).filter((f) => f.toLowerCase().endsWith(".txt"));
      const match = files.find((f) => f.slice(0, -4).toLowerCase() === safe.toLowerCase());
      if (match) return match.slice(0, -4);
    } catch {}
  }
  for (const pl of remotePlaylistCache.lists) {
    if (pl.name && pl.name.toLowerCase() === safe.toLowerCase()) {
      return pl.name;
    }
  }
  for (const k of remotePlaylistCache.details.keys()) {
    if (k.toLowerCase() === safe.toLowerCase()) {
      return k;
    }
  }
  return safe;
}

function getPlaylistFilePath(name) {
  const actualName = findActualPlaylistName(name);
  const safeName = sanitizePlaylistName(actualName || name);
  if (!safeName) return null;
  return path.join(MUSICLIST_DIR, `${safeName}.txt`);
}

function createPlaylist(name) {
  ensureMusiclistDir();
  const safeName = sanitizePlaylistName(name);
  if (!safeName) {
    return { ok: false, error: "Tên danh sách không hợp lệ." };
  }

  const filePath = getPlaylistFilePath(safeName);
  if (fs.existsSync(filePath)) {
    return { ok: false, error: `Danh sách **${safeName}** đã tồn tại từ trước!` };
  }

  try {
    fs.writeFileSync(
      filePath,
      `# Playlist: ${safeName}\n# Ngày tạo: ${new Date().toLocaleString("vi-VN")}\n\n`,
      "utf8"
    );
    return { ok: true, name: safeName, filePath, message: `Đã tạo danh sách **${safeName}** thành công!` };
  } catch (err) {
    return { ok: false, error: `Lỗi khi tạo file: ${err.message}` };
  }
}

function addTrackToPlaylist(name, trackQuery) {
  ensureMusiclistDir();
  const safeName = sanitizePlaylistName(name);
  if (!safeName) {
    return { ok: false, error: "Tên danh sách không hợp lệ." };
  }

  const query = (trackQuery || "").trim();
  if (!query) {
    return { ok: false, error: "Link hoặc tên bài hát không được để trống." };
  }

  const filePath = getPlaylistFilePath(safeName);
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      error: `Danh sách **${safeName}** chưa tồn tại. Dùng \`/playlist create ${safeName}\` để tạo trước!`,
    };
  }

  try {
    fs.appendFileSync(filePath, `${query}\n`, "utf8");
    const tracks = getPlaylistTracks(safeName);
    return {
      ok: true,
      name: safeName,
      totalTracks: tracks.length,
      message: `Đã thêm vào danh sách **${safeName}** thành công! (Hiện có ${tracks.length} bài)`,
    };
  } catch (err) {
    return { ok: false, error: `Lỗi khi lưu vào danh sách: ${err.message}` };
  }
}

function removeTrackFromPlaylist(name, indexOrQuery) {
  ensureMusiclistDir();
  const safeName = sanitizePlaylistName(name);
  const filePath = getPlaylistFilePath(safeName);
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: `Danh sách **${safeName}** không tồn tại.` };
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const headerLines = [];
    const trackLines = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) {
        headerLines.push(line);
      } else if (trimmed.length > 0) {
        trackLines.push(trimmed);
      }
    }

    if (trackLines.length === 0) {
      return { ok: false, error: `Danh sách **${safeName}** hiện đang trống!` };
    }

    let removedTrack = null;
    let targetIndex = -1;

    const num = Number(indexOrQuery);
    if (Number.isInteger(num) && num >= 1 && num <= trackLines.length) {
      targetIndex = num - 1;
    } else {
      const queryLower = String(indexOrQuery).toLowerCase().trim();
      targetIndex = trackLines.findIndex(
        (t) => t.toLowerCase() === queryLower || t.toLowerCase().includes(queryLower)
      );
    }

    if (targetIndex < 0 || targetIndex >= trackLines.length) {
      return {
        ok: false,
        error: `Không tìm thấy bài hát cần xóa (danh sách có từ bài 1 đến bài ${trackLines.length}).`,
      };
    }

    removedTrack = trackLines.splice(targetIndex, 1)[0];

    const newContent = `${headerLines.join("\n")}\n\n${trackLines.join("\n")}${trackLines.length > 0 ? "\n" : ""}`;
    fs.writeFileSync(filePath, newContent, "utf8");

    return {
      ok: true,
      name: safeName,
      removedTrack,
      removedIndex: targetIndex + 1,
      totalTracks: trackLines.length,
      message: `Đã xóa bài số **#${targetIndex + 1}** (\`${removedTrack}\`) khỏi danh sách **${safeName}**! (Còn lại ${trackLines.length} bài)`,
    };
  } catch (err) {
    return { ok: false, error: `Lỗi khi xóa bài hát: ${err.message}` };
  }
}

function getPlaylistTracks(name) {
  ensureMusiclistDir();
  const actualName = findActualPlaylistName(name);
  const safeName = sanitizePlaylistName(actualName || name);
  if (!safeName) return [];

  const filePath = getPlaylistFilePath(safeName);
  if (filePath && fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
    } catch (err) {
      console.error(`[PLAYLIST] Error reading local playlist ${name}:`, err);
    }
  }

  // Fallback từ remote cache khi chạy trên hosting
  const cached = remotePlaylistCache.details.get(safeName);
  if (cached && Array.isArray(cached.tracks)) {
    return cached.tracks.map((t) => t.query);
  }

  return [];
}

function getPlaylistDetails(name) {
  ensureMusiclistDir();
  const actualName = findActualPlaylistName(name);
  const safeName = sanitizePlaylistName(actualName || name);
  const filePath = getPlaylistFilePath(safeName);
  if (filePath && fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split(/\r?\n/);
      let createdAt = "Không rõ";
      const tracks = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("# Ngày tạo:")) {
          createdAt = trimmed.replace("# Ngày tạo:", "").trim();
        } else if (trimmed.length > 0 && !trimmed.startsWith("#")) {
          tracks.push({
            index: tracks.length + 1,
            query: trimmed,
          });
        }
      }

      return {
        name: safeName,
        createdAt,
        totalTracks: tracks.length,
        tracks,
      };
    } catch (err) {
      console.error(`[PLAYLIST] Error reading local details for ${name}:`, err);
    }
  }

  // Fallback từ remote cache khi chạy trên hosting
  return remotePlaylistCache.details.get(safeName) || null;
}

function listPlaylists() {
  ensureMusiclistDir();
  try {
    if (fs.existsSync(MUSICLIST_DIR)) {
      const files = fs.readdirSync(MUSICLIST_DIR).filter((f) => f.toLowerCase().endsWith(".txt"));
      if (files.length > 0) {
        return files.map((fileName) => {
          const name = fileName.slice(0, -4);
          const tracks = getPlaylistTracks(name);
          return {
            name,
            fileName,
            trackCount: tracks.length,
          };
        });
      }
    }
  } catch (err) {
    console.error("[PLAYLIST] Error listing playlists:", err);
  }

  // Fallback từ remote cache khi chạy trên hosting
  return remotePlaylistCache.lists;
}

function deletePlaylist(name) {
  ensureMusiclistDir();
  const safeName = sanitizePlaylistName(name);
  const filePath = getPlaylistFilePath(safeName);
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: `Danh sách **${safeName}** không tồn tại.` };
  }

  try {
    fs.unlinkSync(filePath);
    return { ok: true, message: `Đã xóa danh sách **${safeName}**!` };
  } catch (err) {
    return { ok: false, error: `Lỗi khi xóa: ${err.message}` };
  }
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function batchAddTracks(name, queries) {
  ensureMusiclistDir();
  const safeName = sanitizePlaylistName(name);
  if (!safeName) return { ok: false, error: "Tên danh sách không hợp lệ." };

  const filePath = getPlaylistFilePath(safeName);
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `Danh sách **${safeName}** chưa tồn tại.` };
  }

  const rawList = Array.isArray(queries)
    ? queries
    : String(queries || "").split(/\r?\n/);

  const items = rawList
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && !q.startsWith("#"));

  if (items.length === 0) {
    return { ok: false, error: "Không có bài hát hợp lệ nào để thêm." };
  }

  try {
    const toAppend = items.join("\n") + "\n";
    fs.appendFileSync(filePath, toAppend, "utf8");
    const tracks = getPlaylistTracks(safeName);
    return {
      ok: true,
      name: safeName,
      addedCount: items.length,
      totalTracks: tracks.length,
      message: `Đã thêm thành công ${items.length} bài vào danh sách **${safeName}**! (Hiện có ${tracks.length} bài)`,
    };
  } catch (err) {
    return { ok: false, error: `Lỗi khi lưu bài hát: ${err.message}` };
  }
}

module.exports = {
  MUSICLIST_DIR,
  ensureMusiclistDir,
  sanitizePlaylistName,
  findActualPlaylistName,
  createPlaylist,
  addTrackToPlaylist,
  batchAddTracks,
  removeTrackFromPlaylist,
  getPlaylistTracks,
  getPlaylistDetails,
  listPlaylists,
  deletePlaylist,
  shuffleArray,
};
