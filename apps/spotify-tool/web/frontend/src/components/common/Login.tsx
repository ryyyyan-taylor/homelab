import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/stores/useAuthStore';

export function Login() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setUser, setIsLoading } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for auth callback
    const authStatus = searchParams.get('auth');
    const errorParam = searchParams.get('error');

    if (authStatus === 'success') {
      // Fetch user info
      authApi
        .getCurrentUser()
        .then((user) => {
          setUser(user);
          setIsLoading(false);
          navigate('/');
        })
        .catch(() => {
          setError('Failed to get user info');
          setIsLoading(false);
        });
    } else if (errorParam) {
      setError(errorParam);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  }, [searchParams, setUser, setIsLoading, navigate]);

  const handleLogin = async () => {
    try {
      const { authUrl } = await authApi.login();
      window.location.href = authUrl;
    } catch (err) {
      setError('Failed to initiate login');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-spotify-gray-400 to-spotify-black">
      <div className="text-center space-y-8 max-w-md px-4">
        {/* Logo/Title */}
        <div>
          <h1 className="text-6xl font-bold text-white mb-2">Spotify</h1>
          <p className="text-xl text-spotify-gray-100">Custom Client</p>
        </div>

        {/* Features */}
        <div className="text-left space-y-3 bg-spotify-gray-300 p-6 rounded-lg">
          <h2 className="text-lg font-semibold text-white mb-4">Features:</h2>
          <div className="space-y-2 text-spotify-gray-100">
            <p className="flex items-start">
              <span className="text-spotify-green mr-2">✓</span>
              <span>True random shuffle - hear all your music</span>
            </p>
            <p className="flex items-start">
              <span className="text-spotify-green mr-2">✓</span>
              <span>Smart shuffle with artist balancing</span>
            </p>
            <p className="flex items-start">
              <span className="text-spotify-green mr-2">✓</span>
              <span>Discovery mode - prioritize less-played tracks</span>
            </p>
            <p className="flex items-start">
              <span className="text-spotify-green mr-2">✓</span>
              <span>Artist playlist auto-sync</span>
            </p>
            <p className="flex items-start">
              <span className="text-spotify-green mr-2">✓</span>
              <span>Full playback control</span>
            </p>
          </div>
        </div>

        {/* Login Button */}
        <div className="space-y-4">
          <button onClick={handleLogin} className="btn-primary w-full py-4 text-lg">
            Login with Spotify
          </button>

          {error && (
            <div className="bg-red-900/30 border border-red-500 text-red-200 px-4 py-3 rounded">
              {error}
            </div>
          )}
        </div>

        {/* Info */}
        <p className="text-sm text-spotify-gray-100 mt-8">
          Requires Spotify Premium for playback
        </p>
      </div>
    </div>
  );
}
