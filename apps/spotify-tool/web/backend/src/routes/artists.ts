import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// Get artist by ID
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const artist = await req.spotifyService!.getArtist(req.params.id);
    res.json(artist);
  } catch (error) {
    console.error('Get artist error:', error);
    res.status(500).json({ error: 'Failed to get artist' });
  }
});

// Get artist's top tracks
router.get('/:id/top-tracks', async (req: AuthenticatedRequest, res) => {
  try {
    const market = (req.query.market as string) || 'US';
    const tracks = await req.spotifyService!.getArtistTopTracks(req.params.id, market);
    res.json(tracks);
  } catch (error) {
    console.error('Get artist top tracks error:', error);
    res.status(500).json({ error: 'Failed to get artist top tracks' });
  }
});

// Get artist's albums
router.get('/:id/albums', async (req: AuthenticatedRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const albums = await req.spotifyService!.getArtistAlbums(req.params.id, limit, offset);
    res.json(albums);
  } catch (error) {
    console.error('Get artist albums error:', error);
    res.status(500).json({ error: 'Failed to get artist albums' });
  }
});

// ============ ARTIST PLAYLIST DETECTION ============

// Detect artist playlists by scanning user's playlists
router.get('/playlists/detect', async (req: AuthenticatedRequest, res) => {
  try {
    // Get all user playlists
    const allPlaylists = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const response = await req.spotifyService!.getUserPlaylists(limit, offset);
      allPlaylists.push(...response.items);

      if (response.items.length < limit) break;
      offset += limit;
    }

    // For each playlist, try to find a matching artist
    const artistPlaylists = [];

    for (const playlist of allPlaylists) {
      try {
        // Only process playlists with #artist tag in description
        if (!playlist.description || !playlist.description.toLowerCase().includes('#artist')) {
          continue;
        }

        // Search for an artist with the same name as the playlist
        const searchResults = await req.spotifyService!.search(playlist.name, ['artist'], 1);

        if (searchResults.artists && searchResults.artists.items.length > 0) {
          const artist = searchResults.artists.items[0];

          // Check if it's an exact match (case-insensitive)
          if (artist.name.toLowerCase() === playlist.name.toLowerCase()) {
            artistPlaylists.push({
              artist_id: artist.id,
              artist_name: artist.name,
              playlist_id: playlist.id,
              playlist_name: playlist.name,
              track_count: playlist.tracks.total,
              playlist_images: playlist.images
            });
          }
        }
      } catch (error) {
        // Skip playlists that don't match artists
        continue;
      }
    }

    res.json(artistPlaylists);
  } catch (error) {
    console.error('Detect artist playlists error:', error);
    res.status(500).json({ error: 'Failed to detect artist playlists' });
  }
});

// ============ SYNC OPERATIONS ============

// Sync all artist playlists (two-way: liked songs <-> artist playlists)
router.post('/sync/all', async (req: AuthenticatedRequest, res) => {
  try {
    // Step 1: Detect all artist playlists
    const allPlaylists = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const response = await req.spotifyService!.getUserPlaylists(limit, offset);
      allPlaylists.push(...response.items);

      if (response.items.length < limit) break;
      offset += limit;
    }

    // Find artist playlists by matching names
    const artistPlaylists = [];

    for (const playlist of allPlaylists) {
      try {
        // Only process playlists with #artist tag in description
        if (!playlist.description || !playlist.description.toLowerCase().includes('#artist')) {
          continue;
        }

        const searchResults = await req.spotifyService!.search(playlist.name, ['artist'], 1);

        if (searchResults.artists && searchResults.artists.items.length > 0) {
          const artist = searchResults.artists.items[0];

          if (artist.name.toLowerCase() === playlist.name.toLowerCase()) {
            artistPlaylists.push({
              artist_id: artist.id,
              artist_name: artist.name,
              playlist_id: playlist.id,
              playlist_name: playlist.name
            });
          }
        }
      } catch (error) {
        continue;
      }
    }

    if (artistPlaylists.length === 0) {
      return res.json({
        success: true,
        results: {
          artistPlaylists: { updated: [], added: 0 },
          likedSongs: { removed: 0 }
        }
      });
    }

    // Step 2: Get all liked songs
    const allLikedSongs = [];
    let lOffset = 0;
    const lLimit = 50;

    while (true) {
      const response = await req.spotifyService!.getSavedTracks(lLimit, lOffset);
      allLikedSongs.push(...response.items);

      if (response.items.length < lLimit) break;
      lOffset += lLimit;
    }

    // Step 3: For each artist playlist, sync liked songs TO the playlist
    const artistPlaylistMap = new Map();
    for (const ap of artistPlaylists) {
      artistPlaylistMap.set(ap.artist_id, ap);
    }

    // Get existing tracks in each artist playlist
    const artistPlaylistTracks = new Map();
    for (const ap of artistPlaylists) {
      const trackUris = new Set();
      let pOffset = 0;

      while (true) {
        const response = await req.spotifyService!.getPlaylistTracks(ap.playlist_id, 100, pOffset);

        for (const item of response.items) {
          if (item.track) {
            trackUris.add(item.track.uri);
          }
        }

        if (response.items.length < 100) break;
        pOffset += 100;
      }

      artistPlaylistTracks.set(ap.artist_id, trackUris);
    }

    // Find tracks to add (liked songs -> artist playlists)
    const tracksToAdd = new Map();
    for (const item of allLikedSongs) {
      if (!item.track || !item.track.artists || item.track.artists.length === 0) continue;

      // Check all artists on the track
      for (const artist of item.track.artists) {
        const mapping = artistPlaylistMap.get(artist.id);

        if (mapping) {
          const existingTracks = artistPlaylistTracks.get(artist.id);

          if (!existingTracks.has(item.track.uri)) {
            if (!tracksToAdd.has(artist.id)) {
              tracksToAdd.set(artist.id, []);
            }
            tracksToAdd.get(artist.id).push(item.track.uri);
          }
        }
      }
    }

    // Add tracks to playlists
    const updatedArtists = [];
    let totalAdded = 0;

    for (const [artistId, uris] of tracksToAdd.entries()) {
      const mapping = artistPlaylistMap.get(artistId);

      // Add in batches of 100 (Spotify API limit)
      for (let i = 0; i < uris.length; i += 100) {
        const batch = uris.slice(i, i + 100);
        await req.spotifyService!.addTracksToPlaylist(mapping.playlist_id, batch);
      }

      updatedArtists.push(mapping.artist_name);
      totalAdded += uris.length;
    }

    // Step 4: Two-way sync - Remove from liked songs if removed from artist playlist
    const tracksToRemoveFromLiked = new Set();

    for (const ap of artistPlaylists) {
      const playlistTrackUris = artistPlaylistTracks.get(ap.artist_id);

      // Check all liked songs from this artist
      for (const item of allLikedSongs) {
        if (!item.track || !item.track.artists || item.track.artists.length === 0) continue;

        const isByArtist = item.track.artists.some((artist: any) => artist.id === ap.artist_id);

        if (isByArtist) {
          // If the track is NOT in the artist playlist, remove it from liked songs
          if (!playlistTrackUris.has(item.track.uri)) {
            tracksToRemoveFromLiked.add(item.track.id);
          }
        }
      }
    }

    // Remove tracks from liked songs
    let removed = 0;
    if (tracksToRemoveFromLiked.size > 0) {
      const trackIds = Array.from(tracksToRemoveFromLiked);

      for (let i = 0; i < trackIds.length; i += 50) {
        const batch = trackIds.slice(i, i + 50);
        await req.spotifyService!.removeSavedTracks(batch as string[]);
        removed += batch.length;
      }
    }

    res.json({
      success: true,
      results: {
        artistPlaylists: {
          detected: artistPlaylists.length,
          updated: updatedArtists,
          added: totalAdded
        },
        likedSongs: { removed }
      }
    });
  } catch (error) {
    console.error('Sync all error:', error);
    res.status(500).json({ error: 'Failed to sync' });
  }
});

export default router;
