import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/useAuthStore';
import { authApi } from './services/api';
import { Login } from './components/common/Login';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { Sidebar } from './components/common/Sidebar';
import { Settings } from './components/common/Settings';
import { SearchBar } from './components/search/SearchBar';
import { LibraryView } from './components/library/LibraryView';
import { ArtistManager } from './components/playlists/ArtistManager';
import { PlaylistDetail } from './components/playlists/PlaylistDetail';
import { CombinedPlaylist } from './components/playlists/CombinedPlaylist';

function App() {
  const { user, isAuthenticated, isLoading, setUser, setIsLoading } = useAuthStore();

  // Check authentication on mount
  useEffect(() => {
    authApi
      .getCurrentUser()
      .then((user) => {
        setUser(user);
        setIsLoading(false);
      })
      .catch(() => {
        setUser(null);
        setIsLoading(false);
      });
  }, [setUser, setIsLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-spotify-black">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <div className="h-screen flex flex-col bg-spotify-black">
      {/* Header */}
      <header className="bg-spotify-gray-400 border-b border-spotify-gray-200 p-4">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Spotify Client</h1>
          <SearchBar />
          <div className="flex items-center space-x-4">
            {user && (
              <div className="flex items-center space-x-2">
                {user.images?.[0] && (
                  <img
                    src={user.images[0].url}
                    alt={user.display_name}
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <span className="text-white">{user.display_name}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar */}
        <Sidebar />

        {/* Content */}
        <main className="flex-1 overflow-hidden bg-spotify-gray-400 flex flex-col">
          <Routes>
            <Route path="/" element={<LibraryView />} />
            <Route path="/playlist/:id" element={<PlaylistDetail />} />
            <Route path="/artists" element={<ArtistManager />} />
            <Route path="/combined" element={<CombinedPlaylist />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
