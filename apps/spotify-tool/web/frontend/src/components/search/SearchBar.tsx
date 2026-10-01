import { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { searchApi } from '@/services/api';
import type { SearchResults } from '@/types/spotify';
import { SearchResults as SearchResultsComponent } from './SearchResults';

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults(null);
      setShowResults(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await searchApi.search(searchQuery);
      setResults(data);
      setShowResults(true);
    } catch (error) {
      console.error('Search error:', error);
      setResults(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Debounced search
    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(value);
    }, 300);
  };

  const handleClear = () => {
    setQuery('');
    setResults(null);
    setShowResults(false);
  };

  return (
    <div className="relative w-full max-w-md">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-spotify-gray-100" size={20} />
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => results && setShowResults(true)}
          placeholder="Search for songs, artists, albums..."
          className="w-full pl-10 pr-10 py-2 bg-spotify-gray-400 text-white rounded-full border border-spotify-gray-200 focus:outline-none focus:border-white placeholder-spotify-gray-100"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-spotify-gray-100 hover:text-white"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && results && (
        <div className="absolute top-full mt-2 w-full bg-spotify-gray-300 rounded-lg shadow-xl max-h-96 overflow-y-auto z-50">
          <SearchResultsComponent results={results} onClose={() => setShowResults(false)} />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="absolute top-full mt-2 w-full bg-spotify-gray-300 rounded-lg shadow-xl p-4 text-center">
          <div className="text-spotify-gray-100">Searching...</div>
        </div>
      )}
    </div>
  );
}
