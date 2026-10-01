import { Request, Response, NextFunction } from 'express';
import db from '../db/database';
import { SpotifyService } from '../services/spotifyService';
import { spotifyConfig } from '../config/spotify';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  spotifyService?: SpotifyService;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Get user's tokens from database
    const userSession = db.prepare('SELECT * FROM user_sessions WHERE user_id = ?').get(userId) as any;

    if (!userSession) {
      return res.status(401).json({ error: 'Session not found' });
    }

    // Check if token is expired
    const now = Date.now();
    if (userSession.expires_at < now) {
      // Refresh the token
      const tokenData = await SpotifyService.refreshAccessToken(
        userSession.refresh_token,
        spotifyConfig.clientId,
        spotifyConfig.clientSecret
      );

      const newExpiresAt = now + (tokenData.expires_in * 1000);

      // Update the token in database
      db.prepare(`
        UPDATE user_sessions
        SET access_token = ?, expires_at = ?, updated_at = ?
        WHERE user_id = ?
      `).run(tokenData.access_token, newExpiresAt, now, userId);

      // Attach the new spotify service to request
      req.spotifyService = new SpotifyService(tokenData.access_token);
    } else {
      // Token is still valid
      req.spotifyService = new SpotifyService(userSession.access_token);
    }

    req.userId = userId;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}
