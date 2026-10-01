import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// Search for tracks, albums, artists, playlists
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const query = req.query.q as string;
    const types = (req.query.type as string)?.split(',') || ['track', 'album', 'artist', 'playlist'];
    const limit = parseInt(req.query.limit as string) || 20;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const results = await req.spotifyService!.search(query, types, limit);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
