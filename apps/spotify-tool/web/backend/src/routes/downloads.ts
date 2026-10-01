import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { downloaderClient } from '../services/downloaderClient';

const router = Router();

router.use(requireAuth);

// Get download progress
router.get('/playlist/:id/progress', async (req: AuthenticatedRequest, res) => {
  const progress = await downloaderClient.getProgress(req.params.id);
  res.json(progress);
});

// Start playlist download in background (downloader service does the work)
router.post('/playlist/:id', async (req: AuthenticatedRequest, res) => {
  const playlistId = req.params.id;

  try {
    const existing = await downloaderClient.getProgress(playlistId);
    if (existing.status === 'downloading' || existing.status === 'zipping') {
      return res.json({
        success: true,
        message: 'Download already in progress',
        status: existing.status
      });
    }

    const playlistData = await req.spotifyService!.getPlaylist(playlistId);
    const playlistUrl = `https://open.spotify.com/playlist/${playlistId}`;

    const result = await downloaderClient.startDownload(playlistId, playlistUrl, playlistData.name);

    res.json({
      success: true,
      message: result.message || 'Download started',
      playlistId
    });
  } catch (error) {
    console.error('Playlist download error:', error);
    res.status(500).json({
      error: 'Failed to start download',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Download the completed zip file — proxied straight through from the downloader service
router.get('/playlist/:id/file', async (req: AuthenticatedRequest, res) => {
  const playlistId = req.params.id;

  try {
    const progress = await downloaderClient.getProgress(playlistId);
    if (progress.status !== 'complete') {
      return res.status(400).json({ error: 'Download not complete', status: progress.status });
    }

    const upstream = await downloaderClient.streamFile(playlistId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${progress.zipName || 'playlist.zip'}"`
    );
    upstream.data.pipe(res);
  } catch (error) {
    console.error('File download error:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

// Get download status/availability
router.get('/status', async (req: AuthenticatedRequest, res) => {
  const status = await downloaderClient.checkStatus();
  res.json(status);
});

// Clean download cache
router.post('/clean-cache', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await downloaderClient.cleanCache();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Clean cache error:', error);
    res.status(500).json({
      error: 'Failed to clean cache',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
