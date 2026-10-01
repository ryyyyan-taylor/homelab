import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import db from '../db/database';

const router = Router();
router.use(requireAuth);

// Get combined playlist configuration
router.get('/config', async (req: AuthenticatedRequest, res) => {
  try {
    console.log('[COMBINED] GET /config - Request received');
    const userId = req.userId!;
    console.log('[COMBINED] User ID:', userId);

    const config = db.prepare(`
      SELECT playlist_id, playlist_name, updated_at
      FROM combined_playlist
      WHERE user_id = ?
    `).get(userId) as { playlist_id: string; playlist_name: string; updated_at: number } | undefined;

    const artists = db.prepare(`
      SELECT artist_id, artist_name, added_at
      FROM combined_playlist_artists
      WHERE user_id = ?
      ORDER BY added_at DESC
    `).all(userId) as Array<{ artist_id: string; artist_name: string; added_at: number }>;

    console.log('[COMBINED] Config:', config);
    console.log('[COMBINED] Artists count:', artists.length);

    res.json({
      playlist: config || null,
      artists
    });
  } catch (error) {
    console.error('[COMBINED] Get combined playlist config error:', error);
    res.status(500).json({ error: 'Failed to get combined playlist configuration' });
  }
});

// Set combined playlist
router.post('/config', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { playlistId, playlistName } = req.body;

    if (!playlistId || !playlistName) {
      return res.status(400).json({ error: 'playlistId and playlistName are required' });
    }

    db.prepare(`
      INSERT INTO combined_playlist (user_id, playlist_id, playlist_name, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        playlist_id = excluded.playlist_id,
        playlist_name = excluded.playlist_name,
        updated_at = excluded.updated_at
    `).run(userId, playlistId, playlistName, Date.now());

    res.json({ success: true });
  } catch (error) {
    console.error('Set combined playlist error:', error);
    res.status(500).json({ error: 'Failed to set combined playlist' });
  }
});

// Add artist to combined playlist
router.post('/artists', async (req: AuthenticatedRequest, res) => {
  try {
    console.log('[COMBINED] POST /artists - Request received');
    console.log('[COMBINED] Request body:', req.body);
    console.log('[COMBINED] User ID:', req.userId);

    const userId = req.userId!;
    const { artistId, artistName } = req.body;

    if (!artistId || !artistName) {
      console.error('[COMBINED] Missing required fields:', { artistId, artistName });
      return res.status(400).json({ error: 'artistId and artistName are required' });
    }

    console.log('[COMBINED] Adding artist:', { userId, artistId, artistName });

    const result = db.prepare(`
      INSERT OR IGNORE INTO combined_playlist_artists (user_id, artist_id, artist_name, added_at)
      VALUES (?, ?, ?, ?)
    `).run(userId, artistId, artistName, Date.now());

    console.log('[COMBINED] Insert result:', result);
    console.log('[COMBINED] Artist added successfully');

    res.json({ success: true, artistId, artistName });
  } catch (error) {
    console.error('[COMBINED] Add artist to combined playlist error:', error);
    res.status(500).json({ error: 'Failed to add artist' });
  }
});

// Remove artist from combined playlist
router.delete('/artists/:artistId', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { artistId } = req.params;

    db.prepare(`
      DELETE FROM combined_playlist_artists
      WHERE user_id = ? AND artist_id = ?
    `).run(userId, artistId);

    res.json({ success: true });
  } catch (error) {
    console.error('Remove artist from combined playlist error:', error);
    res.status(500).json({ error: 'Failed to remove artist' });
  }
});

// Sync combined playlist (2-way sync)
router.post('/sync', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;

    // Get combined playlist config
    const config = db.prepare(`
      SELECT playlist_id
      FROM combined_playlist
      WHERE user_id = ?
    `).get(userId) as { playlist_id: string } | undefined;

    if (!config) {
      return res.status(404).json({ error: 'Combined playlist not configured' });
    }

    // Get tracked artists
    const artists = db.prepare(`
      SELECT artist_id
      FROM combined_playlist_artists
      WHERE user_id = ?
    `).all(userId) as Array<{ artist_id: string }>;

    const artistIds = new Set(artists.map(a => a.artist_id));

    // Get all liked songs
    const allLikedSongs = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const response = await req.spotifyService!.getSavedTracks(limit, offset);
      allLikedSongs.push(...response.items);

      if (response.items.length < limit) break;
      offset += limit;
    }

    // Build set of liked song URIs from tracked artists
    const likedFromTrackedArtists = new Set<string>();

    for (const item of allLikedSongs) {
      if (!item.track || !item.track.artists || item.track.artists.length === 0) continue;

      // Check if track is by a tracked artist
      const isTrackedArtist = item.track.artists.some((artist: any) => artistIds.has(artist.id));

      if (isTrackedArtist) {
        likedFromTrackedArtists.add(item.track.uri);
      }
    }

    // Get existing tracks in combined playlist
    const existingTracks = new Map<string, string>(); // uri -> uri (for removal)
    let pOffset = 0;

    while (true) {
      const response = await req.spotifyService!.getPlaylistTracks(config.playlist_id, 100, pOffset);

      for (const item of response.items) {
        if (item.track) {
          existingTracks.set(item.track.uri, item.track.uri);
        }
      }

      if (response.items.length < 100) break;
      pOffset += 100;
    }

    // Find tracks to add (liked from tracked artists but not in playlist)
    const tracksToAdd: string[] = [];
    for (const uri of likedFromTrackedArtists) {
      if (!existingTracks.has(uri)) {
        tracksToAdd.push(uri);
      }
    }

    // Find tracks to remove (in playlist but not liked from tracked artists)
    const tracksToRemove: string[] = [];
    for (const uri of existingTracks.keys()) {
      if (!likedFromTrackedArtists.has(uri)) {
        tracksToRemove.push(uri);
      }
    }

    // Remove tracks in batches
    let removed = 0;
    for (let i = 0; i < tracksToRemove.length; i += 100) {
      const batch = tracksToRemove.slice(i, i + 100);
      await req.spotifyService!.removeTracksFromPlaylist(config.playlist_id, batch);
      removed += batch.length;
    }

    // Add tracks in batches
    let added = 0;
    for (let i = 0; i < tracksToAdd.length; i += 100) {
      const batch = tracksToAdd.slice(i, i + 100);
      await req.spotifyService!.addTracksToPlaylist(config.playlist_id, batch);
      added += batch.length;
    }

    // Update timestamp
    db.prepare(`
      UPDATE combined_playlist
      SET updated_at = ?
      WHERE user_id = ?
    `).run(Date.now(), userId);

    res.json({
      success: true,
      added,
      removed,
      message: `Synced combined playlist: added ${added}, removed ${removed} tracks`
    });
  } catch (error) {
    console.error('Sync combined playlist error:', error);
    res.status(500).json({ error: 'Failed to sync combined playlist' });
  }
});

export default router;
