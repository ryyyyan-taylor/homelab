import { NavLink } from 'react-router-dom';
import { Library, Users, Settings, ListMusic } from 'lucide-react';

export function Sidebar() {
  const navItems = [
    { to: '/', icon: Library, label: 'Library' },
    { to: '/artists', icon: Users, label: 'Artist Manager' },
    { to: '/combined', icon: ListMusic, label: 'Combined' },
    { to: '/settings', icon: Settings, label: 'Settings' }
  ];

  return (
    <aside className="w-64 bg-spotify-black border-r border-spotify-gray-200 flex flex-col">
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-spotify-gray-300 text-white'
                  : 'text-spotify-gray-100 hover:text-white hover:bg-spotify-gray-400'
              }`
            }
          >
            <item.icon size={24} />
            <span className="font-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
