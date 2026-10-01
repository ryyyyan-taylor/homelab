import express from 'express';
import cors from 'cors';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import path from 'path';
import { serverConfig } from './config/spotify';
import { initializeDatabase } from './db/database';

// Import routes
import authRoutes from './routes/auth';
import searchRoutes from './routes/search';
import playlistRoutes from './routes/playlists';
import libraryRoutes from './routes/library';
import artistRoutes from './routes/artists';
import downloadRoutes from './routes/downloads';
import combinedRoutes from './routes/combined';

const app = express();

// Initialize database
initializeDatabase();

// Traefik terminates TLS in front of this app; trust its X-Forwarded-* headers
// so express-session's secure cookie check and req.protocol are accurate.
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: serverConfig.frontendUrl,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session configuration
app.use(session({
  secret: serverConfig.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: serverConfig.nodeEnv === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// Extend session type
declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/artists', artistRoutes);
app.use('/api/downloads', downloadRoutes);
app.use('/api/combined', combinedRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve the built frontend (single-container deploy: this backend also
// hosts the SPA, so there's one image/pod instead of a separate frontend).
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: serverConfig.nodeEnv === 'development' ? err.message : undefined
  });
});

// Start server
const port = serverConfig.port;
const host = serverConfig.host;
app.listen(port, host, () => {
  console.log(`\n🎵 Spotify Client Backend`);
  console.log(`   Server running on http://${host}:${port}`);
  console.log(`   Environment: ${serverConfig.nodeEnv}`);
  console.log(`   Frontend URL: ${serverConfig.frontendUrl}\n`);
});
