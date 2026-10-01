import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { libraryApi, playlistApi, combinedApi } from '@/services/api';
import { Music, ListMusic, ListPlus, UserPlus, FolderPlus } from 'lucide-react';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { ContextMenu, MenuItem } from '../common/ContextMenu';
import type { SpotifyTrack } from '@/types/spotify';

export function LibraryView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'tracks' | 'playlists'>('tracks');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: SpotifyTrack } | null>(null);

  const {
    data: savedTracksData,
    isLoading: tracksLoading,
    fetchNextPage: fetchNextTracks,
    hasNextPage: hasNextTracks,
    isFetchingNextPage: isFetchingNextTracks
  } = useInfiniteQuery({
    queryKey: ['savedTracks'],
    queryFn: ({ pageParam = 0 }) => libraryApi.getSavedTracks(50, pageParam),
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce((acc, page) => acc + page.items.length, 0);
      return totalFetched < lastPage.total ? totalFetched : undefined;
    },
    enabled: activeTab === 'tracks',
    initialPageParam: 0
  });

  const {
    data: playlistsData,
    isLoading: playlistsLoading,
    fetchNextPage: fetchNextPlaylists,
    hasNextPage: hasNextPlaylists,
    isFetchingNextPage: isFetchingNextPlaylists
  } = useInfiniteQuery({
    queryKey: ['playlists'],
    queryFn: ({ pageParam = 0 }) => playlistApi.getUserPlaylists(50, pageParam),
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce((acc, page) => acc + page.items.length, 0);
      return totalFetched < lastPage.total ? totalFetched : undefined;
    },
    enabled: activeTab === 'playlists',
    initialPageParam: 0
  });

  const tracksLoadMoreRef = useInfiniteScroll({
    hasMore: hasNextTracks ?? false,
    isLoading: isFetchingNextTracks,
    onLoadMore: () => fetchNextTracks()
  });

  const playlistsLoadMoreRef = useInfiniteScroll({
    hasMore: hasNextPlaylists ?? false,
    isLoading: isFetchingNextPlaylists,
    onLoadMore: () => fetchNextPlaylists()
  });

  const savedTracks = savedTracksData?.pages.flatMap(page => page.items) ?? [];
  const playlists = playlistsData?.pages.flatMap(page => page.items) ?? [];

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
    }
  });

  // Mutation for adding artist to combined playlist
  const addArtistMutation = useMutation({
    mutationFn: ({ artistId, artistName }: { artistId: string; artistName: string }) => {
      console.log('[LibraryView] Starting addArtist mutation:', { artistId, artistName });
      return combinedApi.addArtist(artistId, artistName);
    },
    onSuccess: (data, variables) => {
      console.log('[LibraryView] addArtist SUCCESS:', { data, variables });
      queryClient.invalidateQueries({ queryKey: ['combinedConfig'] });
      console.log(`✅ Added ${variables.artistName} to tracked artists`);
    },
    onError: (error, variables) => {
      console.error('[LibraryView] addArtist ERROR:', { error, variables });
      console.error('❌ Failed to add artist:', error);
    }
  });

  // Mutation for creating artist playlist
  const createArtistPlaylistMutation = useMutation({
    mutationFn: async ({ artistId, artistName }: { artistId: string; artistName: string }) => {
      // Create playlist with artist name and #artist tag
      const playlist = await playlistApi.createPlaylist(
        artistName,
        `#artist ${artistName}`,
        true
      );
      return { playlist, artistId, artistName };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      console.log(`Created playlist for ${data.artistName}`);
    }
  });

  const handleTrackClick = (e: React.MouseEvent, track: SpotifyTrack) => {
    e.preventDefault();
    console.log('[LibraryView] Click detected on track:', track.name, 'by', track.artists?.map(a => a.name).join(', '));
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      track
    });
  };

  const buildContextMenuItems = (track: SpotifyTrack): MenuItem[] => {
    console.log('[LibraryView] Building context menu items for track:', track.name);
    console.log('[LibraryView] Track artists:', track.artists);
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
      console.log('[LibraryView] Creating Track artist submenu with artists:', track.artists.map(a => ({ id: a.id, name: a.name })));
      const artistSubmenuItems = track.artists.map(artist => {
        const artistId = artist.id;
        const artistName = artist.name;
        console.log('[LibraryView] Creating submenu item for artist:', { artistId, artistName });
        return {
          label: artistName,
          onClick: () => {
            console.log('[LibraryView] Context menu clicked - Track artist:', { artistId, artistName });
            addArtistMutation.mutate({
              artistId,
              artistName
            });
          }
        };
      });
      console.log('[LibraryView] Created artist submenu items:', artistSubmenuItems.map(item => ({ label: item.label, hasOnClick: !!item.onClick })));
      items.push({
        label: 'Track artist in Combined',
        icon: <UserPlus size={16} />,
        submenu: artistSubmenuItems
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
          }
        }))
      });
    }

    return items;
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="text-3xl font-bold text-white mb-6">Your Library</h1>

      {/* Tabs */}
      <div className="flex space-x-4 border-b border-spotify-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('tracks')}
          className={`pb-2 px-1 flex items-center space-x-2 ${
            activeTab === 'tracks'
              ? 'text-white border-b-2 border-spotify-green'
              : 'text-spotify-gray-100'
          }`}
        >
          <Music size={20} />
          <span>Liked Songs</span>
        </button>
        <button
          onClick={() => setActiveTab('playlists')}
          className={`pb-2 px-1 flex items-center space-x-2 ${
            activeTab === 'playlists'
              ? 'text-white border-b-2 border-spotify-green'
              : 'text-spotify-gray-100'
          }`}
        >
          <ListMusic size={20} />
          <span>Playlists</span>
        </button>
      </div>

      {/* Content */}
      {activeTab === 'tracks' && (
        <div>
          {tracksLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="space-y-2">
              {savedTracks.map((item, index) => (
                <div
                  key={item.track.id}
                  className="flex items-center space-x-3 p-2 hover:bg-spotify-gray-300 rounded group cursor-pointer"
                  onClick={(e) => handleTrackClick(e, item.track)}
                >
                  <span className="text-spotify-gray-100 w-8 text-right">{index + 1}</span>
                  {item.track.album.images[0] && (
                    <img
                      src={item.track.album.images[0].url}
                      alt={item.track.album.name}
                      className="w-10 h-10 rounded"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white truncate">{item.track.name}</div>
                    <div className="text-spotify-gray-100 text-sm truncate">
                      {item.track.artists.map((a) => a.name).join(', ')}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={tracksLoadMoreRef} className="h-4 flex items-center justify-center">
                {isFetchingNextTracks && <LoadingSpinner size="sm" />}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'playlists' && (
        <div>
          {playlistsLoading ? (
            <LoadingSpinner />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {playlists.map((playlist) => (
                  <div
                    key={playlist.id}
                    className="card cursor-pointer"
                    onClick={() => navigate(`/playlist/${playlist.id}`)}
                  >
                    {playlist.images[0] ? (
                      <img
                        src={playlist.images[0].url}
                        alt={playlist.name}
                        className="w-full aspect-square object-cover rounded mb-3"
                      />
                    ) : (
                      <div className="w-full aspect-square bg-spotify-gray-200 rounded mb-3 flex items-center justify-center">
                        <ListMusic size={48} className="text-spotify-gray-100" />
                      </div>
                    )}
                    <h3 className="text-white font-semibold truncate">{playlist.name}</h3>
                    <p className="text-spotify-gray-100 text-sm truncate">
                      {playlist.tracks.total} tracks
                    </p>
                  </div>
                ))}
              </div>
              <div ref={playlistsLoadMoreRef} className="h-4 flex items-center justify-center mt-4">
                {isFetchingNextPlaylists && <LoadingSpinner size="sm" />}
              </div>
            </>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems(contextMenu.track)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
