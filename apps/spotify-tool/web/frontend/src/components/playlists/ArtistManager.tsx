import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { artistApi } from '@/services/api';
import { RefreshCw, Check, Music, Info } from 'lucide-react';
import { LoadingSpinner } from '../common/LoadingSpinner';

export function ArtistManager() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  // Detect artist playlists
  const { data: artistPlaylists, isLoading, refetch } = useQuery({
    queryKey: ['artistPlaylists'],
    queryFn: () => artistApi.detectArtistPlaylists()
  });

  // Sync function
  const handleSyncAll = async () => {
    setIsSyncing(true);
    setSyncResult(null);

    try {
      const result = await artistApi.syncAll();
      setSyncResult(result.results);
      // Refetch to get updated data
      await refetch();
    } catch (error) {
      console.error('Sync error:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Artist Playlist Manager</h1>
            <p className="text-spotify-gray-100">
              Manage artist playlists with two-way sync
            </p>
          </div>
          <button
            onClick={handleSyncAll}
            disabled={isSyncing || !artistPlaylists || artistPlaylists.length === 0}
            className="btn-primary flex items-center space-x-2"
          >
            <RefreshCw size={18} className={isSyncing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Syncing...' : 'Sync All'}</span>
          </button>
        </div>

        {/* Sync Result */}
        {syncResult && (
          <div className="bg-spotify-green/20 border border-spotify-green text-white rounded-lg p-4 mb-6">
            <div className="flex items-center space-x-2 mb-2">
              <Check size={20} />
              <span className="font-semibold">Sync Complete!</span>
            </div>
            <div className="text-sm space-y-1">
              {syncResult.artistPlaylists && (
                <p>
                  Detected {syncResult.artistPlaylists.detected} artist playlists, added {syncResult.artistPlaylists.added} tracks to {syncResult.artistPlaylists.updated.length} playlists
                </p>
              )}
              {syncResult.likedSongs && syncResult.likedSongs.removed > 0 && (
                <p className="text-yellow-300">
                  Two-way sync: Removed {syncResult.likedSongs.removed} tracks from liked songs
                </p>
              )}
              {syncResult.artistPlaylists && syncResult.artistPlaylists.updated.length > 0 && (
                <p className="mt-2">
                  <strong>Updated playlists:</strong> {syncResult.artistPlaylists.updated.join(', ')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="bg-spotify-gray-400/50 rounded-lg p-4 border border-spotify-gray-200 mb-6">
          <div className="flex items-start space-x-3">
            <Info size={20} className="text-spotify-green mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-white font-semibold mb-2">How It Works</h3>
              <ul className="text-spotify-gray-100 text-sm space-y-1">
                <li>• Create playlists with exact artist names (e.g., "Ghost", "Sleep Token")</li>
                <li>• The app automatically detects them by matching playlist names to Spotify artists</li>
                <li>• <strong>Liked songs → Playlists:</strong> When you sync, liked songs from these artists are added to their playlists</li>
                <li>• <strong>Two-way sync:</strong> If you remove a track from an artist playlist, it will also be removed from your liked songs</li>
                <li>• No manual configuration needed - just name your playlists after artists!</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Artist Playlists List */}
        {artistPlaylists && artistPlaylists.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-white mb-3">
              Detected Artist Playlists ({artistPlaylists.length})
            </h2>
            {artistPlaylists.map((playlist: any) => (
              <div
                key={playlist.playlist_id}
                className="bg-spotify-gray-300 rounded-lg p-4 flex items-center space-x-4"
              >
                {playlist.playlist_images && playlist.playlist_images[0] ? (
                  <img
                    src={playlist.playlist_images[0].url}
                    alt={playlist.playlist_name}
                    className="w-16 h-16 rounded"
                  />
                ) : (
                  <div className="w-16 h-16 rounded bg-spotify-gray-200 flex items-center justify-center">
                    <Music size={24} className="text-spotify-gray-100" />
                  </div>
                )}
                <div className="flex-1">
                  <h3 className="text-white font-medium text-lg">{playlist.artist_name}</h3>
                  <p className="text-spotify-gray-100 text-sm">
                    {playlist.track_count} tracks in playlist
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Music size={48} className="mx-auto text-spotify-gray-100 mb-4" />
            <p className="text-spotify-gray-100 mb-2 text-lg font-medium">No artist playlists detected</p>
            <p className="text-spotify-gray-100 text-sm max-w-md mx-auto">
              Create playlists with exact artist names (e.g., "Ghost", "Sleep Token") and they'll automatically appear here.
              The app matches playlist names to Spotify artists.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
