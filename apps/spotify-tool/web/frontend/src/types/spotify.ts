export interface SpotifyImage {
  url: string;
  height: number;
  width: number;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
  external_urls: {
    spotify: string;
  };
  images?: SpotifyImage[];
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  uri: string;
  images: SpotifyImage[];
  artists: SpotifyArtist[];
  release_date: string;
  total_tracks: number;
  external_urls: {
    spotify: string;
  };
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  explicit: boolean;
  external_urls: {
    spotify: string;
  };
  is_local: boolean;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  description: string;
  images: SpotifyImage[];
  owner: {
    id: string;
    display_name: string;
  };
  tracks: {
    total: number;
  };
  public: boolean;
  collaborative: boolean;
  external_urls: {
    spotify: string;
  };
}

export interface SpotifyUser {
  id: string;
  display_name: string;
  email: string;
  images: SpotifyImage[];
  product: string;
  country: string;
  external_urls: {
    spotify: string;
  };
}

export interface SpotifyDevice {
  id: string;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number;
}

export interface SpotifyPlaybackState {
  device: SpotifyDevice;
  repeat_state: 'off' | 'track' | 'context';
  shuffle_state: boolean;
  context: {
    type: string;
    uri: string;
  } | null;
  timestamp: number;
  progress_ms: number;
  is_playing: boolean;
  item: SpotifyTrack | null;
}

export interface SavedTrack {
  added_at: string;
  track: SpotifyTrack;
}

export interface PlaylistTrack {
  added_at: string;
  track: SpotifyTrack;
  added_by: {
    id: string;
  };
}

export interface SearchResults {
  tracks?: {
    items: SpotifyTrack[];
    total: number;
  };
  albums?: {
    items: SpotifyAlbum[];
    total: number;
  };
  artists?: {
    items: SpotifyArtist[];
    total: number;
  };
  playlists?: {
    items: SpotifyPlaylist[];
    total: number;
  };
}

export type ShuffleMethod = 'pure-random' | 'smart' | 'discovery';

export interface ShuffleConfig {
  avoid_recent_tracks: number;
  balance_artists: boolean;
  shuffle_method: ShuffleMethod;
  prioritize_less_played: boolean;
}

export interface ArtistPlaylistMapping {
  user_id: string;
  artist_name: string;
  playlist_id: string;
  playlist_name: string;
  auto_sync: boolean;
  last_synced: number | null;
}
