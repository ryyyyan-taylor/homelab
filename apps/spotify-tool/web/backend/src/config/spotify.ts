import dotenv from 'dotenv';

dotenv.config();

export const spotifyConfig = {
  clientId: process.env.SPOTIFY_CLIENT_ID!,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI!,
  scopes: [
    'user-read-email',
    'user-read-private',
    'user-library-read',
    'user-library-modify',
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-public',
    'playlist-modify-private',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'user-read-recently-played',
    'streaming',
    'user-top-read'
  ].join(' ')
};

export const serverConfig = {
  port: parseInt(process.env.PORT || '3010'),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET!,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  dbPath: process.env.DB_PATH || './data/spotify-client.db',
  downloaderUrl: process.env.DOWNLOADER_URL || 'http://downloader:8000'
};
