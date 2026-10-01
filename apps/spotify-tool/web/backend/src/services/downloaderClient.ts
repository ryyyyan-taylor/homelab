import axios from 'axios';
import { serverConfig } from '../config/spotify';

const downloader = axios.create({
  baseURL: serverConfig.downloaderUrl,
  timeout: 10_000
});

export interface DownloadProgress {
  status: 'not_started' | 'downloading' | 'zipping' | 'complete' | 'error';
  progress: number;
  message: string;
  error?: string;
  zipName?: string;
}

export const downloaderClient = {
  async checkStatus(): Promise<{ available: boolean; version?: string; message?: string }> {
    try {
      const { data } = await downloader.get('/status');
      return data;
    } catch {
      return { available: false, message: 'Downloader service unreachable' };
    }
  },

  async startDownload(playlistId: string, playlistUrl: string, playlistName: string) {
    const { data } = await downloader.post(`/download/${playlistId}`, { playlistUrl, playlistName });
    return data;
  },

  async getProgress(playlistId: string): Promise<DownloadProgress> {
    const { data } = await downloader.get(`/download/${playlistId}/progress`);
    return data;
  },

  // Returns a readable stream of the zip so the route can pipe it straight through.
  async streamFile(playlistId: string) {
    return downloader.get(`/download/${playlistId}/file`, { responseType: 'stream' });
  },

  async cleanCache() {
    const { data } = await downloader.post('/clean-cache');
    return data;
  }
};
