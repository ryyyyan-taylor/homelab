import axios from 'axios';
import type {
  SpotifyUser,
  SpotifyTrack,
  SpotifyPlaylist,
  SearchResults,
  SavedTrack,
  PlaylistTrack,
  SpotifyAlbum,
  SpotifyArtist
} from '@/types/spotify';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true
});

// Request interceptor for logging
api.interceptors.request.use(
  (config) => {
    console.log(`[API REQUEST] ${config.method?.toUpperCase()} ${config.url}`, {
      params: config.params,
      data: config.data
    });
    return config;
  },
  (error) => {
    console.error('[API REQUEST ERROR]', error);
    return Promise.reject(error);
  }
);

// Response interceptor for logging
api.interceptors.response.use(
  (response) => {
    console.log(`[API RESPONSE] ${response.config.method?.toUpperCase()} ${response.config.url}`, {
      status: response.status,
      data: response.data
    });
    return response;
  },
  (error) => {
    console.error(`[API ERROR] ${error.config?.method?.toUpperCase()} ${error.config?.url}`, {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
    return Promise.reject(error);
  }
);

// ============ AUTH ============
export const authApi = {
  login: async () => {
    const { data } = await api.get<{ authUrl: string }>('/auth/login');
    return data;
  },

  logout: async () => {
    const { data } = await api.post('/auth/logout');
    return data;
  },

  getCurrentUser: async () => {
    const { data } = await api.get<SpotifyUser>('/auth/me');
    return data;
  },

  getAccessToken: async () => {
    const { data } = await api.get<{ access_token: string }>('/auth/token');
    return data.access_token;
  }
};

// ============ SEARCH ============
export const searchApi = {
  search: async (query: string, types: string | string[] = ['track', 'album', 'artist', 'playlist'], limit: number = 20) => {
    const typeStr = Array.isArray(types) ? types.join(',') : types;
    const { data } = await api.get<SearchResults>('/search', {
      params: { q: query, type: typeStr, limit }
    });
    return data;
  }
};

// ============ PLAYLISTS ============
export const playlistApi = {
  getUserPlaylists: async (limit: number = 50, offset: number = 0) => {
    const { data } = await api.get<{ items: SpotifyPlaylist[]; total: number }>('/playlists', {
      params: { limit, offset }
    });
    return data;
  },

  getPlaylist: async (id: string) => {
    const { data } = await api.get<SpotifyPlaylist>(`/playlists/${id}`);
    return data;
  },

  getPlaylistTracks: async (id: string, limit: number = 100, offset: number = 0) => {
    const { data } = await api.get<{ items: PlaylistTrack[]; total: number }>(`/playlists/${id}/tracks`, {
      params: { limit, offset }
    });
    return data;
  },

  createPlaylist: async (name: string, description?: string, isPublic: boolean = true) => {
    const { data } = await api.post<SpotifyPlaylist>('/playlists', {
      name,
      description,
      public: isPublic
    });
    return data;
  },

  updatePlaylist: async (id: string, name?: string, description?: string, isPublic?: boolean) => {
    const { data } = await api.put(`/playlists/${id}`, {
      name,
      description,
      public: isPublic
    });
    return data;
  },

  addTracks: async (id: string, uris: string[], position?: number) => {
    const { data } = await api.post(`/playlists/${id}/tracks`, { uris, position });
    return data;
  },

  removeTracks: async (id: string, uris: string[]) => {
    const { data } = await api.delete(`/playlists/${id}/tracks`, { data: { uris } });
    return data;
  },

  reorderTracks: async (id: string, rangeStart: number, insertBefore: number, rangeLength: number = 1) => {
    const { data } = await api.put(`/playlists/${id}/tracks/reorder`, {
      range_start: rangeStart,
      insert_before: insertBefore,
      range_length: rangeLength
    });
    return data;
  }
};

// ============ LIBRARY ============
export const libraryApi = {
  getSavedTracks: async (limit: number = 50, offset: number = 0) => {
    const { data } = await api.get<{ items: SavedTrack[]; total: number }>('/library/tracks', {
      params: { limit, offset }
    });
    return data;
  },

  saveTracks: async (ids: string[]) => {
    const { data } = await api.put('/library/tracks', { ids });
    return data;
  },

  removeTracks: async (ids: string[]) => {
    const { data } = await api.delete('/library/tracks', { data: { ids } });
    return data;
  },

  checkSavedTracks: async (ids: string[]) => {
    const { data } = await api.get<boolean[]>('/library/tracks/contains', {
      params: { ids: ids.join(',') }
    });
    return data;
  },

  getSavedAlbums: async (limit: number = 50, offset: number = 0) => {
    const { data } = await api.get<{ items: { added_at: string; album: SpotifyAlbum }[]; total: number }>('/library/albums', {
      params: { limit, offset }
    });
    return data;
  },

  saveAlbums: async (ids: string[]) => {
    const { data } = await api.put('/library/albums', { ids });
    return data;
  },

  removeAlbums: async (ids: string[]) => {
    const { data } = await api.delete('/library/albums', { data: { ids } });
    return data;
  },

  getFollowedArtists: async (limit: number = 50) => {
    const { data } = await api.get<{ artists: { items: SpotifyArtist[]; total: number } }>('/library/artists', {
      params: { limit }
    });
    return data;
  }
};

// ============ ARTISTS ============
export const artistApi = {
  getArtist: async (id: string) => {
    const { data } = await api.get<SpotifyArtist>(`/artists/${id}`);
    return data;
  },

  getArtistTopTracks: async (id: string, market: string = 'US') => {
    const { data } = await api.get<{ tracks: SpotifyTrack[] }>(`/artists/${id}/top-tracks`, {
      params: { market }
    });
    return data;
  },

  getArtistAlbums: async (id: string, limit: number = 50, offset: number = 0) => {
    const { data } = await api.get<{ items: SpotifyAlbum[]; total: number }>(`/artists/${id}/albums`, {
      params: { limit, offset }
    });
    return data;
  },

  // Detect artist playlists (playlists named after artists)
  detectArtistPlaylists: async () => {
    const { data } = await api.get('/artists/playlists/detect');
    return data;
  },

  // Sync all artist playlists with two-way sync
  syncAll: async () => {
    const { data } = await api.post('/artists/sync/all');
    return data;
  }
};

// ============ DOWNLOADS ============
export const downloadApi = {
  // Check if download functionality is available
  checkStatus: async () => {
    const { data } = await api.get<{ available: boolean; version?: string; message?: string }>('/downloads/status');
    return data;
  },

  // Get download progress
  getProgress: async (playlistId: string) => {
    const { data } = await api.get<{
      status: 'not_started' | 'downloading' | 'zipping' | 'complete' | 'error';
      progress: number;
      message: string;
      error?: string;
    }>(`/downloads/playlist/${playlistId}/progress`);
    return data;
  },

  // Start playlist download in background
  startDownload: async (playlistId: string) => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
      playlistId: string;
    }>(`/downloads/playlist/${playlistId}`);
    return data;
  },

  // Download the completed file
  downloadFile: (playlistId: string) => {
    // Use window.open for direct browser download to avoid Cloudflare tunnel timeouts
    window.open(`/api/downloads/playlist/${playlistId}/file`, '_blank');
  },

  // Clean download cache
  cleanCache: async () => {
    const { data } = await api.post<{
      success: boolean;
      deletedCount: number;
      freedBytes: number;
      freedMB: string;
    }>('/downloads/clean-cache');
    return data;
  }
};

// ============ COMBINED PLAYLIST ============
export const combinedApi = {
  // Get combined playlist configuration and tracked artists
  getConfig: async () => {
    const { data } = await api.get<{
      playlist: { playlist_id: string; playlist_name: string; updated_at: number } | null;
      artists: Array<{ artist_id: string; artist_name: string; added_at: number }>;
    }>('/combined/config');
    return data;
  },

  // Set combined playlist
  setConfig: async (playlistId: string, playlistName: string) => {
    const { data } = await api.post('/combined/config', {
      playlistId,
      playlistName
    });
    return data;
  },

  // Add artist to tracked artists
  addArtist: async (artistId: string, artistName: string) => {
    const { data } = await api.post('/combined/artists', {
      artistId,
      artistName
    });
    return data;
  },

  // Remove artist from tracked artists
  removeArtist: async (artistId: string) => {
    const { data } = await api.delete(`/combined/artists/${artistId}`);
    return data;
  },

  // Sync combined playlist
  sync: async () => {
    const { data } = await api.post<{
      success: boolean;
      added: number;
      message: string;
    }>('/combined/sync');
    return data;
  }
};

export default api;
