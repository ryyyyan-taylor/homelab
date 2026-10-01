import Database from 'better-sqlite3';
import { serverConfig } from '../config/spotify';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.dirname(serverConfig.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(serverConfig.dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Initialize database schema
export function initializeDatabase() {
  db.exec(`
    -- User sessions/tokens (for persistent login)
    CREATE TABLE IF NOT EXISTS user_sessions (
      user_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Combined playlist configuration
    CREATE TABLE IF NOT EXISTS combined_playlist (
      user_id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      playlist_name TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Artists tracked in combined playlist
    CREATE TABLE IF NOT EXISTS combined_playlist_artists (
      user_id TEXT NOT NULL,
      artist_id TEXT NOT NULL,
      artist_name TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, artist_id)
    );

    -- Shuffle configuration (for any shuffle settings)
    CREATE TABLE IF NOT EXISTS shuffle_config (
      user_id TEXT PRIMARY KEY
    );
  `);

  console.log('Database initialized successfully');
}

export default db;
