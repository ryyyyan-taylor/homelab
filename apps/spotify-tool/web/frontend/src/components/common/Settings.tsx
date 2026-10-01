import { useState } from 'react';
import { authApi, downloadApi } from '@/services/api';
import { useAuthStore } from '@/stores/useAuthStore';
import { LogOut, Trash2 } from 'lucide-react';

export function Settings() {
  const { logout } = useAuthStore();
  const [cleaningCache, setCleaningCache] = useState(false);
  const [cacheResult, setCacheResult] = useState<string | null>(null);

  const handleLogout = async () => {
    try {
      await authApi.logout();
      logout();
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleCleanCache = async () => {
    setCleaningCache(true);
    setCacheResult(null);
    try {
      const result = await downloadApi.cleanCache();
      setCacheResult(`Cleaned ${result.deletedCount} items, freed ${result.freedMB} MB`);
    } catch (error) {
      console.error('Clean cache error:', error);
      setCacheResult('Failed to clean cache');
    } finally {
      setCleaningCache(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-6">Settings</h1>

        {/* Account */}
        <div className="bg-spotify-gray-300 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-white mb-4">Account</h2>
          <button
            onClick={handleLogout}
            className="btn-secondary flex items-center space-x-2"
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>

        {/* Storage */}
        <div className="bg-spotify-gray-300 rounded-lg p-6 mt-6">
          <h2 className="text-xl font-semibold text-white mb-4">Storage</h2>
          <p className="text-spotify-gray-100 mb-4 text-sm">
            Clean up temporary files from playlist downloads.
          </p>
          <button
            onClick={handleCleanCache}
            disabled={cleaningCache}
            className="btn-secondary flex items-center space-x-2"
          >
            <Trash2 size={18} />
            <span>{cleaningCache ? 'Cleaning...' : 'Clean Download Cache'}</span>
          </button>
          {cacheResult && (
            <p className="text-spotify-gray-100 mt-3 text-sm">{cacheResult}</p>
          )}
        </div>

        {/* About */}
        <div className="bg-spotify-gray-300 rounded-lg p-6 mt-6">
          <h2 className="text-xl font-semibold text-white mb-4">About</h2>
          <p className="text-spotify-gray-100 mb-4">
            Spotify Playlist & Library Manager helps you organize your music with artist-specific playlists,
            combined playlists, and intelligent two-way sync between playlists and liked songs.
          </p>
          <div className="text-spotify-gray-100 text-sm space-y-2">
            <div className="flex justify-between">
              <span>Version:</span>
              <span className="text-white">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span>Backend:</span>
              <span className="text-white">Node.js + Express</span>
            </div>
            <div className="flex justify-between">
              <span>Frontend:</span>
              <span className="text-white">React + TypeScript</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
