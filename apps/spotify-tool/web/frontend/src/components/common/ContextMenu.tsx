import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  submenu?: MenuItem[];
  divider?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenuState, setSubmenuState] = useState<{ index: number; x: number; y: number } | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // Check if click is on any context menu (including submenus)
      const clickedOnMenu = (target as Element).closest('[data-context-menu]');

      if (clickedOnMenu) {
        console.log('[ContextMenu] Click on menu detected, not closing');
        return;
      }

      // Delay closing to allow submenu clicks to register
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }

      closeTimeoutRef.current = setTimeout(() => {
        if (menuRef.current && !menuRef.current.contains(target)) {
          console.log('[ContextMenu] Click outside detected, closing menu');
          onClose();
        }
      }, 100);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        console.log('[ContextMenu] Escape pressed, closing menu');
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, [onClose]);

  // Adjust position if menu goes off screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${viewportWidth - rect.width - 10}px`;
      }
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${viewportHeight - rect.height - 10}px`;
      }
    }
  }, [x, y]);

  const handleItemClick = (item: MenuItem) => {
    console.log('[ContextMenu] Item clicked:', item.label);
    if (item.onClick) {
      console.log('[ContextMenu] Executing onClick for:', item.label);
      item.onClick();
      onClose();
    } else {
      console.log('[ContextMenu] No onClick handler for:', item.label);
    }
  };

  const handleSubmenuHover = (index: number, event: React.MouseEvent<HTMLDivElement>) => {
    console.log('[ContextMenu] Submenu hover:', items[index]?.label);
    const rect = event.currentTarget.getBoundingClientRect();
    setSubmenuState({
      index,
      x: rect.right,
      y: rect.top
    });
  };

  return (
    <>
      <div
        ref={menuRef}
        data-context-menu="true"
        className="fixed bg-spotify-gray-300 rounded-md shadow-xl py-1 min-w-48 z-50 border border-spotify-gray-200"
        style={{ left: x, top: y }}
      >
        {items.map((item, index) => {
          if (item.divider) {
            return <div key={index} className="h-px bg-spotify-gray-200 my-1" />;
          }

          return (
            <div
              key={index}
              className="px-3 py-2 hover:bg-spotify-gray-400 cursor-pointer flex items-center justify-between text-white text-sm group"
              onClick={() => !item.submenu && handleItemClick(item)}
              onMouseEnter={(e) => item.submenu && handleSubmenuHover(index, e)}
            >
              <div className="flex items-center space-x-2">
                {item.icon && <span className="text-spotify-gray-100">{item.icon}</span>}
                <span>{item.label}</span>
              </div>
              {item.submenu && (
                <ChevronRight size={16} className="text-spotify-gray-100" />
              )}
            </div>
          );
        })}
      </div>

      {/* Submenu */}
      {submenuState !== null && items[submenuState.index]?.submenu && (
        <ContextMenu
          x={submenuState.x}
          y={submenuState.y}
          items={items[submenuState.index].submenu!}
          onClose={onClose}
        />
      )}
    </>
  );
}
