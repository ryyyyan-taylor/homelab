import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// ============ TRACKS ============
// Get saved tracks (liked songs)
router.get('/tracks', async (req: AuthenticatedRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const tracks = await req.spotifyService!.getSavedTracks(limit, offset);
    res.json(tracks);
  } catch (error) {
    console.error('Get saved tracks error:', error);
    res.status(500).json({ error: 'Failed to get saved tracks' });
  }
});

// Save tracks
router.put('/tracks', async (req: AuthenticatedRequest, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'IDs array is required' });
    }

    await req.spotifyService!.saveTracks(ids);
    res.json({ success: true });
  } catch (error) {
    console.error('Save tracks error:', error);
    res.status(500).json({ error: 'Failed to save tracks' });
  }
});

// Remove saved tracks
router.delete('/tracks', async (req: AuthenticatedRequest, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'IDs array is required' });
    }

    await req.spotifyService!.removeSavedTracks(ids);
    res.json({ success: true });
  } catch (error) {
    console.error('Remove saved tracks error:', error);
    res.status(500).json({ error: 'Failed to remove saved tracks' });
  }
});

// Check if tracks are saved
router.get('/tracks/contains', async (req: AuthenticatedRequest, res) => {
  try {
    const ids = (req.query.ids as string)?.split(',');

    if (!ids || ids.length === 0) {
      return res.status(400).json({ error: 'IDs parameter is required' });
    }

    const result = await req.spotifyService!.checkSavedTracks(ids);
    res.json(result);
  } catch (error) {
    console.error('Check saved tracks error:', error);
    res.status(500).json({ error: 'Failed to check saved tracks' });
  }
});

// ============ ALBUMS ============
// Get saved albums
router.get('/albums', async (req: AuthenticatedRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const albums = await req.spotifyService!.getSavedAlbums(limit, offset);
    res.json(albums);
  } catch (error) {
    console.error('Get saved albums error:', error);
    res.status(500).json({ error: 'Failed to get saved albums' });
  }
});

// Save albums
router.put('/albums', async (req: AuthenticatedRequest, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'IDs array is required' });
    }

    await req.spotifyService!.saveAlbums(ids);
    res.json({ success: true });
  } catch (error) {
    console.error('Save albums error:', error);
    res.status(500).json({ error: 'Failed to save albums' });
  }
});

// Remove saved albums
router.delete('/albums', async (req: AuthenticatedRequest, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'IDs array is required' });
    }

    await req.spotifyService!.removeSavedAlbums(ids);
    res.json({ success: true });
  } catch (error) {
    console.error('Remove saved albums error:', error);
    res.status(500).json({ error: 'Failed to remove saved albums' });
  }
});

// ============ ARTISTS ============
// Get followed artists
router.get('/artists', async (req: AuthenticatedRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    const artists = await req.spotifyService!.getFollowedArtists(limit);
    res.json(artists);
  } catch (error) {
    console.error('Get followed artists error:', error);
    res.status(500).json({ error: 'Failed to get followed artists' });
  }
});

export default router;
