import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SearchResults as SearchResultsType, SpotifyArtist, SpotifyTrack } from '@/types/spotify';
import { playlistApi, combinedApi } from '@/services/api';
import { ContextMenu, MenuItem } from '../common/ContextMenu';
import { UserPlus, FolderPlus, ListPlus } from 'lucide-react';

interface Props {
  results: SearchResultsType;
  onClose: () => void;
}

export function SearchResults({ results, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [trackContextMenu, setTrackContextMenu] = useState<{ x: number; y: number; track: SpotifyTrack } | null>(null);
  const [artistContextMenu, setArtistContextMenu] = useState<{ x: number; y: number; artist: SpotifyArtist } | null>(null);

  // Fetch all playlists for context menu
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
    }
  });

  // Mutation for adding tracks to playlist
  const addToPlaylistMutation = useMutation({
    mutationFn: ({ playlistId, trackUri }: { playlistId: string; trackUri: string }) =>
      playlistApi.addTracks(playlistId, [trackUri]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlistTracks'] });
      console.log('✅ Track added to playlist');
      setTrackContextMenu(null);
    }
  });

  // Mutation for adding artist to combined playlist
  const addArtistMutation = useMutation({
    mutationFn: ({ artistId, artistName }: { artistId: string; artistName: string }) =>
      combinedApi.addArtist(artistId, artistName),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['combinedConfig'] });
      console.log(`✅ Added ${variables.artistName} to tracked artists`);
      setArtistContextMenu(null);
    }
  });

  // Mutation for creating artist playlist
  const createArtistPlaylistMutation = useMutation({
    mutationFn: async ({ artistId, artistName }: { artistId: string; artistName: string }) => {
      const playlist = await playlistApi.createPlaylist(
        artistName,
        `#artist ${artistName}`,
        true
      );
      return { playlist, artistId, artistName };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      console.log(`✅ Created playlist for ${data.artistName}`);
      setArtistContextMenu(null);
    }
  });

  const handleTrackClick = (e: React.MouseEvent, track: SpotifyTrack) => {
    e.preventDefault();
    setTrackContextMenu({
      x: e.clientX,
      y: e.clientY,
      track
    });
  };

  const handleArtistClick = (e: React.MouseEvent, artist: SpotifyArtist) => {
    e.preventDefault();
    setArtistContextMenu({
      x: e.clientX,
      y: e.clientY,
      artist
    });
  };

  const handlePlaylistClick = (playlistId: string) => {
    onClose();
    navigate(`/playlist/${playlistId}`);
  };

  const buildTrackContextMenuItems = (track: SpotifyTrack): MenuItem[] => {
    const items: MenuItem[] = [];

    // Add to playlist submenu
    if (allPlaylists && allPlaylists.length > 0) {
      items.push({
        label: 'Add to playlist',
        icon: <ListPlus size={16} />,
        submenu: allPlaylists.map(playlist => ({
          label: playlist.name,
          onClick: () => {
            addToPlaylistMutation.mutate({
              playlistId: playlist.id,
              trackUri: track.uri
            });
          }
        }))
      });
    }

    // Track artist(s) in Combined playlist
    if (track.artists && track.artists.length > 0) {
      items.push({
        label: 'Track artist in Combined',
        icon: <UserPlus size={16} />,
        submenu: track.artists.map(artist => ({
          label: artist.name,
          onClick: () => {
            addArtistMutation.mutate({
              artistId: artist.id,
              artistName: artist.name
            });
            setTrackContextMenu(null);
          }
        }))
      });

      // Create artist playlist
      items.push({
        label: 'Create Artist Playlist',
        icon: <FolderPlus size={16} />,
        submenu: track.artists.map(artist => ({
          label: artist.name,
          onClick: () => {
            createArtistPlaylistMutation.mutate({
              artistId: artist.id,
              artistName: artist.name
            });
            setTrackContextMenu(null);
          }
        }))
      });
    }

    return items;
  };

  const buildArtistContextMenuItems = (artist: SpotifyArtist): MenuItem[] => {
    return [
      {
        label: 'Track in Combined',
        icon: <UserPlus size={16} />,
        onClick: () => {
          addArtistMutation.mutate({
            artistId: artist.id,
            artistName: artist.name
          });
        }
      },
      {
        label: 'Create Artist Playlist',
        icon: <FolderPlus size={16} />,
        onClick: () => {
          createArtistPlaylistMutation.mutate({
            artistId: artist.id,
            artistName: artist.name
          });
        }
      }
    ];
  };
  const hasResults =
    (results.tracks?.items.length || 0) +
    (results.artists?.items.length || 0) +
    (results.playlists?.items.length || 0) >
    0;

  if (!hasResults) {
    return (
      <div className="p-4 text-center text-spotify-gray-100">
        No results found
      </div>
    );
  }

  return (
    <div className="p-2 space-y-4">
      {/* Tracks */}
      {results.tracks && results.tracks.items.length > 0 && (
        <div>
          <h3 className="text-white font-semibold px-2 mb-2">Tracks</h3>
          <div className="space-y-1">
            {results.tracks.items
              .filter((track) => track != null)
              .slice(0, 5)
              .map((track) => {
              const trackImage = track.album?.images?.[0];
              return (
                <div
                  key={track.id}
                  onClick={(e) => handleTrackClick(e, track)}
                  className="w-full flex items-center space-x-3 p-2 hover:bg-spotify-gray-200 rounded cursor-pointer"
                >
                  {trackImage && (
                    <img
                      src={trackImage.url}
                      alt={track.album?.name || track.name}
                      className="w-10 h-10 rounded"
                    />
                  )}
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-white text-sm truncate">{track.name}</div>
                    <div className="text-spotify-gray-100 text-xs truncate">
                      {track.artists?.map((a) => a.name).join(', ') || 'Unknown Artist'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Artists */}
      {results.artists && results.artists.items.length > 0 && (
        <div>
          <h3 className="text-white font-semibold px-2 mb-2">Artists</h3>
          <div className="space-y-1">
            {results.artists.items
              .filter((artist) => artist != null)
              .slice(0, 3)
              .map((artist) => {
              const artistImage = artist.images?.[0];
              return (
                <div
                  key={artist.id}
                  onClick={(e) => handleArtistClick(e, artist)}
                  className="flex items-center space-x-3 p-2 hover:bg-spotify-gray-200 rounded cursor-pointer"
                >
                  {artistImage && (
                    <img
                      src={artistImage.url}
                      alt={artist.name}
                      className="w-10 h-10 rounded-full"
                    />
                  )}
                  <div className="text-white text-sm">{artist.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Playlists */}
      {results.playlists && results.playlists.items.length > 0 && (
        <div>
          <h3 className="text-white font-semibold px-2 mb-2">Playlists</h3>
          <div className="space-y-1">
            {results.playlists.items
              .filter((playlist) => playlist != null)
              .slice(0, 3)
              .map((playlist) => {
                const playlistImage = playlist.images?.[0];
                return (
                  <div
                    key={playlist.id}
                    onClick={() => handlePlaylistClick(playlist.id)}
                    className="flex items-center space-x-3 p-2 hover:bg-spotify-gray-200 rounded cursor-pointer"
                  >
                    {playlistImage && (
                      <img
                        src={playlistImage.url}
                        alt={playlist.name}
                        className="w-10 h-10 rounded"
                      />
                    )}
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-white text-sm truncate">{playlist.name}</div>
                      <div className="text-spotify-gray-100 text-xs truncate">
                        {playlist.tracks?.total || 0} tracks
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Track Context Menu */}
      {trackContextMenu && (
        <ContextMenu
          x={trackContextMenu.x}
          y={trackContextMenu.y}
          items={buildTrackContextMenuItems(trackContextMenu.track)}
          onClose={() => setTrackContextMenu(null)}
        />
      )}

      {/* Artist Context Menu */}
      {artistContextMenu && (
        <ContextMenu
          x={artistContextMenu.x}
          y={artistContextMenu.y}
          items={buildArtistContextMenuItems(artistContextMenu.artist)}
          onClose={() => setArtistContextMenu(null)}
        />
      )}
    </div>
  );
}
