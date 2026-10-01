import { Router } from 'express';
import { SpotifyService } from '../services/spotifyService';
import { spotifyConfig } from '../config/spotify';
import db from '../db/database';
import crypto from 'crypto';

const router = Router();

// Store state tokens temporarily (in production, use Redis)
const stateTokens = new Map<string, number>();

router.get('/login', (req, res) => {
  // Generate random state for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');
  stateTokens.set(state, Date.now());

  // Clean up old state tokens (older than 10 minutes)
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, timestamp] of stateTokens.entries()) {
    if (timestamp < tenMinutesAgo) {
      stateTokens.delete(key);
    }
  }

  const authUrl = SpotifyService.getAuthorizationUrl(
    spotifyConfig.clientId,
    spotifyConfig.redirectUri,
    spotifyConfig.scopes,
    state
  );

  res.json({ authUrl });
});

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error) {
    return res.redirect(`${frontendUrl}?error=${error}`);
  }

  if (!code || !state) {
    return res.redirect(`${frontendUrl}?error=missing_params`);
  }

  // Verify state token
  if (!stateTokens.has(state as string)) {
    return res.redirect(`${frontendUrl}?error=invalid_state`);
  }
  stateTokens.delete(state as string);

  try {
    // Exchange code for access token
    const tokenData = await SpotifyService.exchangeCodeForToken(
      code as string,
      spotifyConfig.clientId,
      spotifyConfig.clientSecret,
      spotifyConfig.redirectUri
    );

    // Get user profile
    const spotifyService = new SpotifyService(tokenData.access_token);
    const user = await spotifyService.getCurrentUser();

    // Store tokens in database
    const now = Date.now();
    const expiresAt = now + (tokenData.expires_in * 1000);

    db.prepare(`
      INSERT OR REPLACE INTO user_sessions (user_id, access_token, refresh_token, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      tokenData.access_token,
      tokenData.refresh_token,
      expiresAt,
      now,
      now
    );

    // Initialize shuffle config for new users
    db.prepare(`
      INSERT OR IGNORE INTO shuffle_config (user_id)
      VALUES (?)
    `).run(user.id);

    // Store user ID in session
    req.session.userId = user.id;

    // Redirect to frontend
    res.redirect(`${frontendUrl}?auth=success`);
  } catch (error) {
    console.error('Callback error:', error);
    res.redirect(`${frontendUrl}?error=auth_failed`);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

router.get('/me', async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const userSession = db.prepare('SELECT * FROM user_sessions WHERE user_id = ?').get(userId) as any;

    if (!userSession) {
      return res.status(401).json({ error: 'Session not found' });
    }

    const spotifyService = new SpotifyService(userSession.access_token);
    const user = await spotifyService.getCurrentUser();

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Get access token for Web Playback SDK
router.get('/token', async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const userSession = db.prepare('SELECT * FROM user_sessions WHERE user_id = ?').get(userId) as any;

    if (!userSession) {
      return res.status(401).json({ error: 'Session not found' });
    }

    // Check if token is expired and refresh if needed
    const now = Date.now();
    if (userSession.expires_at < now) {
      const tokenData = await SpotifyService.refreshAccessToken(
        userSession.refresh_token,
        spotifyConfig.clientId,
        spotifyConfig.clientSecret
      );

      const newExpiresAt = now + (tokenData.expires_in * 1000);

      db.prepare(`
        UPDATE user_sessions
        SET access_token = ?, expires_at = ?, updated_at = ?
        WHERE user_id = ?
      `).run(tokenData.access_token, newExpiresAt, now, userId);

      return res.json({ access_token: tokenData.access_token });
    }

    res.json({ access_token: userSession.access_token });
  } catch (error) {
    console.error('Get token error:', error);
    res.status(500).json({ error: 'Failed to get access token' });
  }
});

export default router;
