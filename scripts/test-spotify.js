const assert = require("node:assert/strict");
const SpotifyResolver = require("../src/core/spotifyResolver");
const AudioResolver = require("../src/core/audioResolver");

async function testSpotifyUrlRecognitionAndNormalization() {
  assert.equal(
    SpotifyResolver.isSpotifyUrl("https://open.spotify.com/playlist/abc123?si=share"),
    true
  );
  assert.equal(SpotifyResolver.isSpotifyUrl("https://example.com/playlist/abc123"), false);
  assert.equal(
    SpotifyResolver.normalizeOpenUrl("https://open.spotify.com/intl-vi/playlist/abc123?si=share"),
    "https://open.spotify.com/playlist/abc123"
  );
}

async function testPublicPlaylistMappingWithoutApiKey() {
  let receivedUrl = null;
  const result = await SpotifyResolver.resolve(
    "https://open.spotify.com/playlist/abc123?si=share",
    "Test User",
    {
      getDetails: async (url) => {
        receivedUrl = url;
        return {
          preview: {
            type: "playlist",
            title: "Danh sách kiểm thử",
            image: "https://i.scdn.co/test.jpg",
            link: url,
          },
          tracks: [
            {
              name: "Bài thứ nhất",
              artist: "Nghệ sĩ A",
              duration: 181_400,
              uri: "spotify:track:trackA123",
            },
            {
              name: "Bài thứ hai",
              artist: "Nghệ sĩ B",
              duration: 205_000,
              uri: "spotify:track:trackB456",
            },
          ],
        };
      },
    }
  );

  assert.equal(receivedUrl, "https://open.spotify.com/playlist/abc123");
  assert.equal(result.type, "playlist");
  assert.equal(result.playlistTitle, "Danh sách kiểm thử");
  assert.equal(result.tracks.length, 2);
  assert.equal(result.tracks[0].duration, "3:01");
  assert.equal(result.tracks[0].durationSec, 181);
  assert.equal(result.tracks[0].isSpotify, true);
  assert.equal(result.tracks[0].url, "https://open.spotify.com/track/trackA123");
  assert.match(result.tracks[0].searchQuery, /Bài thứ nhất Nghệ sĩ A official audio/);
}

async function testShortLinkRedirect() {
  const redirected = await SpotifyResolver.resolveShareUrl(
    "https://spotify.link/share123",
    async () => ({
      ok: true,
      status: 200,
      url: "https://open.spotify.com/intl-vi/playlist/redirected123?si=x",
      body: { cancel: async () => {} },
    })
  );
  assert.equal(redirected, "https://open.spotify.com/playlist/redirected123");
}

async function testYoutubeMatchScoring() {
  const track = {
    title: "Bài Hay - Nghệ Sĩ A",
    spotifyTitle: "Bài Hay",
    spotifyArtist: "Nghệ Sĩ A",
    durationSec: 180,
  };
  const candidates = [
    {
      id: "cover000001",
      title: "Bài Hay - cover karaoke",
      durationInSec: 180,
    },
    {
      id: "correct00001",
      title: "Nghệ Sĩ A - Bài Hay (Official Audio)",
      durationInSec: 182,
    },
    {
      id: "wrong0000001",
      title: "Một bài hoàn toàn khác",
      durationInSec: 400,
    },
  ];

  const best = AudioResolver.selectBestYoutubeMatch(track, candidates);
  assert.equal(best.id, "correct00001");
}

async function main() {
  await testSpotifyUrlRecognitionAndNormalization();
  await testPublicPlaylistMappingWithoutApiKey();
  await testShortLinkRedirect();
  await testYoutubeMatchScoring();
  console.log("[TEST] Spotify playlist resolver OK (4 scenarios).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
