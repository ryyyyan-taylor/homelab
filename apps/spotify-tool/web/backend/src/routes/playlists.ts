import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// Get user's playlists
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const playlists = await req.spotifyService!.getUserPlaylists(limit, offset);
    res.json(playlists);
  } catch (error) {
    console.error('Get playlists error:', error);
    res.status(500).json({ error: 'Failed to get playlists' });
  }
});

// Get a specific playlist
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const playlist = await req.spotifyService!.getPlaylist(req.params.id);
    res.json(playlist);
  } catch (error) {
    console.error('Get playlist error:', error);
    res.status(500).json({ error: 'Failed to get playlist' });
  }
});

// Get playlist tracks
router.get('/:id/tracks', async (req: AuthenticatedRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const tracks = await req.spotifyService!.getPlaylistTracks(req.params.id, limit, offset);
    res.json(tracks);
  } catch (error) {
    console.error('Get playlist tracks error:', error);
    res.status(500).json({ error: 'Failed to get playlist tracks' });
  }
});

// Create a new playlist
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { name, description, public: isPublic } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Playlist name is required' });
    }

    const playlist = await req.spotifyService!.createPlaylist(
      req.userId!,
      name,
      description,
      isPublic !== false
    );

    res.json(playlist);
  } catch (error) {
    console.error('Create playlist error:', error);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

// Update playlist details
router.put('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const { name, description, public: isPublic } = req.body;

    await req.spotifyService!.updatePlaylist(
      req.params.id,
      name,
      description,
      isPublic
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update playlist error:', error);
    res.status(500).json({ error: 'Failed to update playlist' });
  }
});

// Add tracks to playlist
router.post('/:id/tracks', async (req: AuthenticatedRequest, res) => {
  try {
    const { uris, position } = req.body;

    if (!uris || !Array.isArray(uris)) {
      return res.status(400).json({ error: 'URIs array is required' });
    }

    const result = await req.spotifyService!.addTracksToPlaylist(
      req.params.id,
      uris,
      position
    );

    res.json(result);
  } catch (error) {
    console.error('Add tracks error:', error);
    res.status(500).json({ error: 'Failed to add tracks to playlist' });
  }
});

// Remove tracks from playlist
router.delete('/:id/tracks', async (req: AuthenticatedRequest, res) => {
  try {
    const { uris } = req.body;

    if (!uris || !Array.isArray(uris)) {
      return res.status(400).json({ error: 'URIs array is required' });
    }

    const result = await req.spotifyService!.removeTracksFromPlaylist(
      req.params.id,
      uris
    );

    res.json(result);
  } catch (error) {
    console.error('Remove tracks error:', error);
    res.status(500).json({ error: 'Failed to remove tracks from playlist' });
  }
});

// Reorder tracks in playlist
router.put('/:id/tracks/reorder', async (req: AuthenticatedRequest, res) => {
  try {
    const { range_start, insert_before, range_length } = req.body;

    if (range_start === undefined || insert_before === undefined) {
      return res.status(400).json({ error: 'range_start and insert_before are required' });
    }

    const result = await req.spotifyService!.reorderPlaylistTracks(
      req.params.id,
      range_start,
      insert_before,
      range_length
    );

    res.json(result);
  } catch (error) {
    console.error('Reorder tracks error:', error);
    res.status(500).json({ error: 'Failed to reorder tracks' });
  }
});

export default router;
