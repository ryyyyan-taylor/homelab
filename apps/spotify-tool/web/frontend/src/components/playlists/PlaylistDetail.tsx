import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { playlistApi, downloadApi, combinedApi } from '@/services/api';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { ArrowLeft, Download, AlertCircle, ListPlus, UserPlus, FolderPlus } from 'lucide-react';
import { ContextMenu, MenuItem } from '../common/ContextMenu';
import type { SpotifyTrack } from '@/types/spotify';

export function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMessage, setDownloadMessage] = useState('');
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: SpotifyTrack } | null>(null);

  // Check if download is available
  const { data: downloadStatus } = useQuery({
    queryKey: ['downloadStatus'],
    queryFn: () => downloadApi.checkStatus()
  });

  const {
    data: tracksData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery({
    queryKey: ['playlistTracks', id],
    queryFn: ({ pageParam = 0 }) => playlistApi.getPlaylistTracks(id!, 100, pageParam),
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce((acc, page) => acc + page.items.length, 0);
      return totalFetched < lastPage.total ? totalFetched : undefined;
    },
    enabled: !!id,
    initialPageParam: 0
  });

  const loadMoreRef = useInfiniteScroll({
    hasMore: hasNextPage ?? false,
    isLoading: isFetchingNextPage,
    onLoadMore: () => fetchNextPage()
  });

  const tracks = tracksData?.pages.flatMap(page => page.items) ?? [];
  const total = tracksData?.pages[0]?.total ?? 0;

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
    mutationFn: ({ artistId, artistName }: { artistId: string; artistName: string }) =>
      combinedApi.addArtist(artistId, artistName),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['combinedConfig'] });
      console.log(`Added ${variables.artistName} to tracked artists`);
    },
    onError: (error) => {
      console.error('Failed to add artist:', error);
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

  // Cleanup progress interval on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  const handleDownload = async () => {
    if (!id) return;

    setIsDownloading(true);
    setDownloadError(null);
    setDownloadProgress(0);
    setDownloadMessage('Starting download...');

    try {
      // Start the download in background
      await downloadApi.startDownload(id);

      // Poll for progress
      progressIntervalRef.current = setInterval(async () => {
        try {
          const progress = await downloadApi.getProgress(id);
          setDownloadProgress(progress.progress);
          setDownloadMessage(progress.message);

          if (progress.status === 'error') {
            setDownloadError(progress.error || 'Download failed');
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
            }
            setIsDownloading(false);
          } else if (progress.status === 'complete') {
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
            }
            // Download the completed file
            try {
              await downloadApi.downloadFile(id);
              setDownloadMessage('Download complete!');
            } catch (error) {
              console.error('File download failed:', error);
              setDownloadError('Failed to download file');
            }
            setIsDownloading(false);
          }
        } catch (error) {
          console.error('Error fetching progress:', error);
        }
      }, 2000);

    } catch (error: any) {
      console.error('Download failed:', error);
      setDownloadError(
        error.response?.data?.message ||
        'Download failed. Please ensure spotdl is installed on the server.'
      );
      setIsDownloading(false);
    }
  };

  const handleTrackClick = (e: React.MouseEvent, track: SpotifyTrack) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      track
    });
  };

  const buildContextMenuItems = (track: SpotifyTrack): MenuItem[] => {
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
          }
        }))
      });
    }

    return items;
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
      <button
        onClick={() => navigate(-1)}
        className="flex items-center space-x-2 text-spotify-gray-100 hover:text-white mb-6"
      >
        <ArrowLeft size={20} />
        <span>Back</span>
      </button>

      <div className="flex items-start space-x-6 mb-8">
        <div className="text-white">
          <h1 className="text-4xl font-bold mb-2">Playlist</h1>
          <p className="text-spotify-gray-100">{total} tracks</p>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <div className="flex items-center space-x-4">
          <button
            onClick={handleDownload}
            disabled={isDownloading || !downloadStatus?.available}
            className="btn-primary flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDownloading ? (
              <>
                <LoadingSpinner size="sm" />
                <span>Downloading...</span>
              </>
            ) : (
              <>
                <Download size={20} />
                <span>Download as MP3</span>
              </>
            )}
          </button>

          {!downloadStatus?.available && (
            <div className="flex items-center space-x-2 text-yellow-500 text-sm">
              <AlertCircle size={16} />
              <span>Download not available - spotdl not installed</span>
            </div>
          )}
        </div>

        {isDownloading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-spotify-gray-100">
              <span>{downloadMessage}</span>
              <span>{downloadProgress}%</span>
            </div>
            <div className="w-full bg-spotify-gray-300 rounded-full h-2 overflow-hidden">
              <div
                className="bg-spotify-green h-full transition-all duration-300 ease-out"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          </div>
        )}

        {downloadError && (
          <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-red-400 text-sm">
            {downloadError}
          </div>
        )}
      </div>

      <div className="space-y-1">
        {tracks.map((item, index) => {
          if (!item.track) return null;

          return (
            <div
              key={`${item.track.id}-${index}`}
              className="flex items-center space-x-3 p-2 hover:bg-spotify-gray-300 rounded group cursor-pointer"
              onClick={(e) => handleTrackClick(e, item.track)}
            >
              <span className="text-spotify-gray-100 w-8 text-right">{index + 1}</span>
              {item.track.album?.images?.[0] && (
                <img
                  src={item.track.album.images[0].url}
                  alt={item.track.album.name}
                  className="w-10 h-10 rounded"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-white truncate">{item.track.name}</div>
                <div className="text-spotify-gray-100 text-sm truncate">
                  {item.track.artists?.map((a) => a.name).join(', ')}
                </div>
              </div>
              {item.track.album && (
                <div className="text-spotify-gray-100 text-sm truncate hidden md:block flex-1">
                  {item.track.album.name}
                </div>
              )}
              <div className="text-spotify-gray-100 text-sm">
                {item.track.duration_ms && formatDuration(item.track.duration_ms)}
              </div>
            </div>
          );
        })}
        <div ref={loadMoreRef} className="h-4 flex items-center justify-center">
          {isFetchingNextPage && <LoadingSpinner size="sm" />}
        </div>
      </div>

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

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
