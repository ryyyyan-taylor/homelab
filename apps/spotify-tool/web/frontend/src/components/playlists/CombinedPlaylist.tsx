import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { combinedApi, playlistApi } from '@/services/api';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { RefreshCw, Trash2, Settings, CheckCircle, Music } from 'lucide-react';

export function CombinedPlaylist() {
  const queryClient = useQueryClient();
  const [isSelecting, setIsSelecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Get combined playlist configuration
  const { data: config, isLoading } = useQuery({
    queryKey: ['combinedConfig'],
    queryFn: () => combinedApi.getConfig()
  });

  // Get user's playlists for selection
  const { data: allPlaylists } = useQuery({
    queryKey: ['allPlaylists'],
    queryFn: async () => {
      let allItems = [];
      let offset = 0;
      const limit = 50;

      while (true) {
        const data = await playlistApi.getUserPlaylists(limit, offset);
        allItems.push(...data.items);

        if (data.items.length < limit) break;
        offset += limit;
      }

      return allItems;
    },
    enabled: isSelecting
  });

  // Mutation to set combined playlist
  const setPlaylistMutation = useMutation({
    mutationFn: ({ playlistId, playlistName }: { playlistId: string; playlistName: string }) =>
      combinedApi.setConfig(playlistId, playlistName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['combinedConfig'] });
      setIsSelecting(false);
    }
  });

  // Mutation to remove artist
  const removeArtistMutation = useMutation({
    mutationFn: (artistId: string) => combinedApi.removeArtist(artistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['combinedConfig'] });
    }
  });

  const handleSync = async () => {
    if (!config?.playlist) {
      setSyncMessage('Please select a playlist first');
      return;
    }

    setIsSyncing(true);
    setSyncMessage('Starting sync...');

    try {
      const result = await combinedApi.sync();
      setSyncMessage(result.message);
    } catch (error: any) {
      console.error('Sync error:', error);
      setSyncMessage(error.response?.data?.error || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSelectPlaylist = (playlistId: string, playlistName: string) => {
    setPlaylistMutation.mutate({ playlistId, playlistName });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Combined Playlist</h1>
        <p className="text-spotify-gray-100 mb-6">
          Automatically sync liked songs from tracked artists to a single playlist
        </p>

        {/* Current Playlist Configuration */}
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white flex items-center space-x-2">
              <Settings size={20} />
              <span>Playlist Configuration</span>
            </h2>
            <button
              onClick={() => setIsSelecting(!isSelecting)}
              className="btn-secondary text-sm"
            >
              {config?.playlist ? 'Change Playlist' : 'Select Playlist'}
            </button>
          </div>

          {config?.playlist ? (
            <div className="flex items-center space-x-3 p-3 bg-spotify-gray-400 rounded">
              <Music size={24} className="text-spotify-green" />
              <div>
                <div className="text-white font-medium">{config.playlist.playlist_name}</div>
                <div className="text-spotify-gray-100 text-sm">
                  Last updated: {new Date(config.playlist.updated_at).toLocaleString()}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-spotify-gray-100 text-center py-4">
              No playlist selected. Click "Select Playlist" to get started.
            </div>
          )}

          {isSelecting && allPlaylists && (
            <div className="mt-4 max-h-64 overflow-y-auto space-y-2">
              {allPlaylists.map((playlist) => (
                <button
                  key={playlist.id}
                  onClick={() => handleSelectPlaylist(playlist.id, playlist.name)}
                  className="w-full flex items-center space-x-3 p-3 hover:bg-spotify-gray-400 rounded text-left"
                >
                  {playlist.images[0] ? (
                    <img
                      src={playlist.images[0].url}
                      alt={playlist.name}
                      className="w-10 h-10 rounded"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-spotify-gray-200 rounded flex items-center justify-center">
                      <Music size={20} className="text-spotify-gray-100" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white truncate">{playlist.name}</div>
                    <div className="text-spotify-gray-100 text-sm">
                      {playlist.tracks.total} tracks
                    </div>
                  </div>
                  {config?.playlist?.playlist_id === playlist.id && (
                    <CheckCircle size={20} className="text-spotify-green" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sync Button */}
        {config?.playlist && (
          <div className="card mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-white font-medium mb-1">Sync Playlist</h3>
                <p className="text-spotify-gray-100 text-sm">
                  Add all liked songs from tracked artists to the combined playlist
                </p>
              </div>
              <button
                onClick={handleSync}
                disabled={isSyncing || !config.artists || config.artists.length === 0}
                className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSyncing ? (
                  <>
                    <LoadingSpinner size="sm" />
                    <span>Syncing...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={20} />
                    <span>Sync Now</span>
                  </>
                )}
              </button>
            </div>

            {syncMessage && (
              <div className="mt-4 p-3 bg-spotify-gray-400 rounded text-white text-sm">
                {syncMessage}
              </div>
            )}
          </div>
        )}

        {/* Tracked Artists */}
        <div className="card">
          <h2 className="text-xl font-semibold text-white mb-4">
            Tracked Artists ({config?.artists?.length || 0})
          </h2>

          {config?.artists && config.artists.length > 0 ? (
            <div className="space-y-2">
              {config.artists.map((artist) => (
                <div
                  key={artist.artist_id}
                  className="flex items-center justify-between p-3 hover:bg-spotify-gray-400 rounded group"
                >
                  <div>
                    <div className="text-white font-medium">{artist.artist_name}</div>
                    <div className="text-spotify-gray-100 text-sm">
                      Added {new Date(artist.added_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => removeArtistMutation.mutate(artist.artist_id)}
                    className="text-spotify-gray-100 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-spotify-gray-100 text-center py-8">
              <p className="mb-2">No artists tracked yet</p>
              <p className="text-sm">
                Right-click on any track and select "Track artist in Combined" to add artists
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
