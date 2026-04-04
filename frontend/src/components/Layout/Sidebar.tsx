import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, FolderOpen, ChevronRight, Zap } from 'lucide-react';

const navItems = [
  { label: 'Projects', icon: LayoutDashboard, href: '/' },
];

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-60 bg-purple-deep flex flex-col shrink-0 h-screen sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <div className="w-8 h-8 bg-purple-mid rounded-lg flex items-center justify-center">
          <Zap size={16} className="text-white" />
        </div>
        <div>
          <div className="text-white font-semibold text-sm leading-tight">Functional</div>
          <div className="text-purple-light text-xs leading-tight">Accelerator</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <p className="section-title text-white/30 px-2 mb-3">Workspace</p>
        {navItems.map(({ label, icon: Icon, href }) => {
          const isActive = location.pathname === href || (href !== '/' && location.pathname.startsWith(href));
          return (
            <Link
              key={href}
              to={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Version */}
      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-white/30 text-xs">MVP v1.0</p>
      </div>
    </aside>
  );
}
