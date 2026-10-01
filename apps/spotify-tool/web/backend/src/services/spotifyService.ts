import axios, { AxiosInstance } from 'axios';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS_BASE = 'https://accounts.spotify.com';

export class SpotifyService {
  private api: AxiosInstance;

  constructor(accessToken: string) {
    this.api = axios.create({
      baseURL: SPOTIFY_API_BASE,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  // ============ AUTHENTICATION ============
  static getAuthorizationUrl(clientId: string, redirectUri: string, scope: string, state: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scope,
      state: state
    });
    return `${SPOTIFY_ACCOUNTS_BASE}/authorize?${params.toString()}`;
  }

  static async exchangeCodeForToken(code: string, clientId: string, clientSecret: string, redirectUri: string) {
    const response = await axios.post(
      `${SPOTIFY_ACCOUNTS_BASE}/api/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      }),
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    return response.data;
  }

  static async refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string) {
    const response = await axios.post(
      `${SPOTIFY_ACCOUNTS_BASE}/api/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    return response.data;
  }

  // ============ USER ============
  async getCurrentUser() {
    const response = await this.api.get('/me');
    return response.data;
  }

  async getUserProfile(userId: string) {
    const response = await this.api.get(`/users/${userId}`);
    return response.data;
  }

  // ============ PLAYBACK ============
  async getPlaybackState() {
    const response = await this.api.get('/me/player');
    return response.data;
  }

  async getCurrentlyPlaying() {
    const response = await this.api.get('/me/player/currently-playing');
    return response.data;
  }

  async getRecentlyPlayed(limit: number = 50) {
    const response = await this.api.get('/me/player/recently-played', {
      params: { limit }
    });
    return response.data;
  }

  async startPlayback(deviceId?: string, contextUri?: string, uris?: string[], offset?: any) {
    const body: any = {};
    if (contextUri) body.context_uri = contextUri;
    if (uris) body.uris = uris;
    if (offset) body.offset = offset;

    const params = deviceId ? { device_id: deviceId } : {};
    const response = await this.api.put('/me/player/play', body, { params });
    return response.status === 204;
  }

  async pausePlayback(deviceId?: string) {
    const params = deviceId ? { device_id: deviceId } : {};
    const response = await this.api.put('/me/player/pause', {}, { params });
    return response.status === 204;
  }

  async skipToNext(deviceId?: string) {
    const params = deviceId ? { device_id: deviceId } : {};
    const response = await this.api.post('/me/player/next', {}, { params });
    return response.status === 204;
  }

  async skipToPrevious(deviceId?: string) {
    const params = deviceId ? { device_id: deviceId } : {};
    const response = await this.api.post('/me/player/previous', {}, { params });
    return response.status === 204;
  }

  async seek(positionMs: number, deviceId?: string) {
    const params: any = { position_ms: positionMs };
    if (deviceId) params.device_id = deviceId;
    const response = await this.api.put('/me/player/seek', {}, { params });
    return response.status === 204;
  }

  async setVolume(volumePercent: number, deviceId?: string) {
    const params: any = { volume_percent: volumePercent };
    if (deviceId) params.device_id = deviceId;
    const response = await this.api.put('/me/player/volume', {}, { params });
    return response.status === 204;
  }

  async setRepeatMode(state: 'track' | 'context' | 'off', deviceId?: string) {
    const params: any = { state };
    if (deviceId) params.device_id = deviceId;
    const response = await this.api.put('/me/player/repeat', {}, { params });
    return response.status === 204;
  }

  async setShuffle(state: boolean, deviceId?: string) {
    const params: any = { state };
    if (deviceId) params.device_id = deviceId;
    const response = await this.api.put('/me/player/shuffle', {}, { params });
    return response.status === 204;
  }

  async getAvailableDevices() {
    const response = await this.api.get('/me/player/devices');
    return response.data;
  }

  async transferPlayback(deviceIds: string[], play: boolean = false) {
    const response = await this.api.put('/me/player', {
      device_ids: deviceIds,
      play
    });
    return response.status === 204;
  }

  async addToQueue(uri: string, deviceId?: string) {
    const params: any = { uri };
    if (deviceId) params.device_id = deviceId;
    const response = await this.api.post('/me/player/queue', {}, { params });
    return response.status === 204;
  }

  // ============ SEARCH ============
  async search(query: string, types: string[] = ['track', 'album', 'artist', 'playlist'], limit: number = 20) {
    const response = await this.api.get('/search', {
      params: {
        q: query,
        type: types.join(','),
        limit
      }
    });
    return response.data;
  }

  // ============ PLAYLISTS ============
  async getUserPlaylists(limit: number = 50, offset: number = 0) {
    const response = await this.api.get('/me/playlists', {
      params: { limit, offset }
    });
    return response.data;
  }

  async getPlaylist(playlistId: string) {
    const response = await this.api.get(`/playlists/${playlistId}`);
    return response.data;
  }

  async getPlaylistTracks(playlistId: string, limit: number = 100, offset: number = 0) {
    const response = await this.api.get(`/playlists/${playlistId}/tracks`, {
      params: { limit, offset }
    });
    return response.data;
  }

  async createPlaylist(userId: string, name: string, description?: string, isPublic: boolean = true) {
    const response = await this.api.post(`/users/${userId}/playlists`, {
      name,
      description,
      public: isPublic
    });
    return response.data;
  }

  async updatePlaylist(playlistId: string, name?: string, description?: string, isPublic?: boolean) {
    const body: any = {};
    if (name) body.name = name;
    if (description !== undefined) body.description = description;
    if (isPublic !== undefined) body.public = isPublic;

    const response = await this.api.put(`/playlists/${playlistId}`, body);
    return response.status === 200;
  }

  async addTracksToPlaylist(playlistId: string, uris: string[], position?: number) {
    const body: any = { uris };
    if (position !== undefined) body.position = position;

    const response = await this.api.post(`/playlists/${playlistId}/tracks`, body);
    return response.data;
  }

  async removeTracksFromPlaylist(playlistId: string, uris: string[]) {
    const tracks = uris.map(uri => ({ uri }));
    const response = await this.api.delete(`/playlists/${playlistId}/tracks`, {
      data: { tracks }
    });
    return response.data;
  }

  async reorderPlaylistTracks(playlistId: string, rangeStart: number, insertBefore: number, rangeLength: number = 1) {
    const response = await this.api.put(`/playlists/${playlistId}/tracks`, {
      range_start: rangeStart,
      insert_before: insertBefore,
      range_length: rangeLength
    });
    return response.data;
  }

  // ============ LIBRARY ============
  async getSavedTracks(limit: number = 50, offset: number = 0) {
    const response = await this.api.get('/me/tracks', {
      params: { limit, offset }
    });
    return response.data;
  }

  async saveTracks(ids: string[]) {
    const response = await this.api.put('/me/tracks', { ids });
    return response.status === 200;
  }

  async removeSavedTracks(ids: string[]) {
    const response = await this.api.delete('/me/tracks', { data: { ids } });
    return response.status === 200;
  }

  async checkSavedTracks(ids: string[]) {
    const response = await this.api.get('/me/tracks/contains', {
      params: { ids: ids.join(',') }
    });
    return response.data;
  }

  async getSavedAlbums(limit: number = 50, offset: number = 0) {
    const response = await this.api.get('/me/albums', {
      params: { limit, offset }
    });
    return response.data;
  }

  async saveAlbums(ids: string[]) {
    const response = await this.api.put('/me/albums', { ids });
    return response.status === 200;
  }

  async removeSavedAlbums(ids: string[]) {
    const response = await this.api.delete('/me/albums', { data: { ids } });
    return response.status === 200;
  }

  // ============ ARTISTS ============
  async getArtist(artistId: string) {
    const response = await this.api.get(`/artists/${artistId}`);
    return response.data;
  }

  async getArtistTopTracks(artistId: string, market: string = 'US') {
    const response = await this.api.get(`/artists/${artistId}/top-tracks`, {
      params: { market }
    });
    return response.data;
  }

  async getArtistAlbums(artistId: string, limit: number = 50, offset: number = 0) {
    const response = await this.api.get(`/artists/${artistId}/albums`, {
      params: { limit, offset }
    });
    return response.data;
  }

  async getFollowedArtists(limit: number = 50) {
    const response = await this.api.get('/me/following', {
      params: { type: 'artist', limit }
    });
    return response.data;
  }

  // ============ ALBUMS ============
  async getAlbum(albumId: string) {
    const response = await this.api.get(`/albums/${albumId}`);
    return response.data;
  }

  async getAlbumTracks(albumId: string, limit: number = 50, offset: number = 0) {
    const response = await this.api.get(`/albums/${albumId}/tracks`, {
      params: { limit, offset }
    });
    return response.data;
  }

  // ============ TRACKS ============
  async getTrack(trackId: string) {
    const response = await this.api.get(`/tracks/${trackId}`);
    return response.data;
  }

  async getTracks(ids: string[]) {
    const response = await this.api.get('/tracks', {
      params: { ids: ids.join(',') }
    });
    return response.data;
  }

  // ============ RECOMMENDATIONS ============
  async getRecommendations(params: {
    seed_artists?: string[];
    seed_tracks?: string[];
    seed_genres?: string[];
    limit?: number;
    [key: string]: any;
  }) {
    const queryParams: any = { ...params };
    if (params.seed_artists) queryParams.seed_artists = params.seed_artists.join(',');
    if (params.seed_tracks) queryParams.seed_tracks = params.seed_tracks.join(',');
    if (params.seed_genres) queryParams.seed_genres = params.seed_genres.join(',');

    const response = await this.api.get('/recommendations', { params: queryParams });
    return response.data;
  }
}
