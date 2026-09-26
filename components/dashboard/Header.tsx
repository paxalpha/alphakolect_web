"use client"
import { useState, useEffect, useRef } from "react";
import { HiBars3BottomRight, HiArrowRightOnRectangle, HiChevronDown, HiBell, HiMagnifyingGlass, HiXMark, HiSun, HiMoon, HiCog6Tooth, HiUser } from "react-icons/hi2";
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";

interface DashboardHeaderProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

const DashboardHeader = ({ isOpen, setIsOpen }: DashboardHeaderProps) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [userInitials, setUserInitials] = useState("OR");
  const [userName, setUserName] = useState("User");
  const [userEmail, setUserEmail] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Page title from pathname
  const getPageTitle = () => {
    const parts = pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || 'dashboard';
    return last.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        const name = user.businessName || user.fullName || "User";
        setUserName(name);
        setUserEmail(user.email || "");
        const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
        setUserInitials(initials);
      } catch (e) {
        console.error("Error parsing user data", e);
      }
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfileDropdown(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    // Detect if the current session is a staff/collaborator login
    const isCollaborator = !!localStorage.getItem('collaboratorToken');
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('merchantToken');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('collaboratorToken');
    localStorage.removeItem('staffPermissions');
    localStorage.removeItem('userRole');
    // Redirect collaborators/staff to their own login page
    window.location.href = isCollaborator ? '/collaborator/login' : '/login';
  };

  const toggleMenu = () => setIsOpen(!isOpen);

  // Fake notifications
  const notifications = [
    { id: 1, title: 'New collection received', desc: '₦12,500 from Customer #4182', time: '2m ago', unread: true },
    { id: 2, title: 'Subscription reminder', desc: 'Your plan renews in 5 days', time: '1h ago', unread: true },
    { id: 3, title: 'Agent added', desc: 'John Doe has been added as agent', time: '3h ago', unread: false },
  ];
  const unreadCount = notifications.filter(n => n.unread).length;

  return (
    <>
      {/* ─── Main Header Bar ─────────────────────────────────────────── */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 h-[60px] flex items-center justify-between px-4 md:px-6 transition-all duration-300 ${
          scrolled
            ? 'bg-white/95 backdrop-blur-md shadow-[0_2px_20px_rgba(78,55,251,0.08)] border-b border-gray-100'
            : 'bg-white border-b border-gray-100'
        }`}
      >
        {/* LEFT — Hamburger + Logo + Page title */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile hamburger */}
          <button
            onClick={toggleMenu}
            className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-[#4E37FB] transition-all"
            aria-label="Toggle menu"
          >
            {isOpen
              ? <HiXMark className="w-5 h-5" />
              : <HiBars3BottomRight className="w-5 h-5" />
            }
          </button>

          {/* Logo pill (desktop) */}
          <Link href="/dashboard" className="hidden lg:flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4E37FB] to-[#150E46] flex items-center justify-center shadow-md shadow-indigo-200 group-hover:scale-105 transition-transform">
              <span className="text-white text-[11px] font-extrabold tracking-tight">AK</span>
            </div>
            <span className="font-bold text-[15px] text-[#150E46] tracking-tight">AlphaKolect</span>
          </Link>

          {/* Divider (desktop) */}
          <div className="hidden lg:block w-px h-5 bg-gray-200 mx-1" />

          {/* Page breadcrumb */}
          <div className="hidden md:flex flex-col leading-none">
            <span className="text-[11px] text-gray-400 font-medium">Dashboard</span>
            <span className="text-[13px] font-semibold text-gray-800">{getPageTitle()}</span>
          </div>
        </div>

        {/* CENTER — Search bar (desktop) */}
        <div className="hidden md:flex items-center flex-1 max-w-[340px] mx-6">
          <div className="relative w-full group">
            <HiMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-[#4E37FB] transition-colors" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search customers, agents, reports…"
              className="w-full pl-9 pr-4 py-2 text-[13px] bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-[#4E37FB] focus:ring-2 focus:ring-[#4E37FB]/10 placeholder-gray-400 transition-all"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <HiXMark className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* RIGHT — Actions */}
        <div className="flex items-center gap-1.5">
          {/* Mobile search trigger */}
          <button
            className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-[#4E37FB] transition-all"
            onClick={() => setShowMobileSearch(true)}
          >
            <HiMagnifyingGlass className="w-5 h-5" />
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="hidden sm:flex p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-[#4E37FB] transition-all"
            title={isDarkMode ? 'Light mode' : 'Dark mode'}
          >
            {isDarkMode ? <HiSun className="w-5 h-5" /> : <HiMoon className="w-5 h-5" />}
          </button>

          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => { setShowNotifDropdown(v => !v); setShowProfileDropdown(false); }}
              className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-[#4E37FB] transition-all"
            >
              <HiBell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-[17px] h-[17px] bg-[#4E37FB] text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-sm">
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifDropdown && (
              <div className="absolute right-0 top-[calc(100%+8px)] w-80 bg-white rounded-2xl shadow-2xl shadow-gray-200/60 border border-gray-100 z-30 overflow-hidden animate-fade-in-up">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                  <span className="font-semibold text-[13px] text-gray-800">Notifications</span>
                  <span className="text-[11px] text-[#4E37FB] font-medium cursor-pointer hover:underline">Mark all read</span>
                </div>
                <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                  {notifications.map(n => (
                    <div key={n.id} className={`px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer flex gap-3 ${n.unread ? '' : 'opacity-60'}`}>
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.unread ? 'bg-[#4E37FB]' : 'bg-gray-300'}`} />
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-gray-800 truncate">{n.title}</p>
                        <p className="text-[11px] text-gray-500 truncate">{n.desc}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{n.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2.5 border-t border-gray-50 text-center">
                  <span className="text-[12px] text-[#4E37FB] font-medium cursor-pointer hover:underline">View all notifications</span>
                </div>
              </div>
            )}
          </div>

          {/* Vertical divider */}
          <div className="w-px h-6 bg-gray-200 mx-1" />

          {/* Profile */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => { setShowProfileDropdown(v => !v); setShowNotifDropdown(false); }}
              className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl hover:bg-gray-100 transition-all group"
            >
              {/* Avatar */}
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4E37FB] to-[#150E46] text-white text-[12px] font-bold flex items-center justify-center shadow-md shadow-indigo-100 group-hover:scale-105 transition-transform">
                {userInitials}
              </div>
              <div className="hidden sm:flex flex-col items-start leading-none">
                <span className="text-[12px] font-semibold text-gray-800 max-w-[100px] truncate">{userName}</span>
                <span className="text-[10px] text-gray-400">Merchant</span>
              </div>
              <HiChevronDown className={`hidden sm:block w-3.5 h-3.5 text-gray-400 transition-transform ${showProfileDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showProfileDropdown && (
              <div className="absolute right-0 top-[calc(100%+8px)] w-56 bg-white rounded-2xl shadow-2xl shadow-gray-200/60 border border-gray-100 z-30 overflow-hidden animate-fade-in-up">
                {/* User info card */}
                <div className="px-4 py-3 bg-gradient-to-br from-[#150E46] to-[#4E37FB] text-white">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-white/20 text-white text-[13px] font-bold flex items-center justify-center backdrop-blur-sm">
                      {userInitials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">{userName}</p>
                      <p className="text-[11px] text-white/70 truncate">{userEmail || 'Merchant Account'}</p>
                    </div>
                  </div>
                </div>

                {/* Menu items */}
                <div className="py-1.5">
                  <Link
                    href="/dashboard/settings"
                    onClick={() => setShowProfileDropdown(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-[#4E37FB] transition-colors"
                  >
                    <HiCog6Tooth className="w-4 h-4 text-gray-400" />
                    Settings
                  </Link>
                  <Link
                    href="/dashboard/subscription"
                    onClick={() => setShowProfileDropdown(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-[#4E37FB] transition-colors"
                  >
                    <HiUser className="w-4 h-4 text-gray-400" />
                    Subscription
                  </Link>

                  <div className="mx-3 my-1 h-px bg-gray-100" />

                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-[13px] text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <HiArrowRightOnRectangle className="w-4 h-4" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ─── Mobile Search Overlay ────────────────────────────────────── */}
      {showMobileSearch && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-start justify-center md:hidden">
          <div className="bg-white w-full px-4 py-3 flex items-center gap-3 shadow-xl border-b border-gray-100 animate-slide-in-top">
            <HiMagnifyingGlass className="w-5 h-5 text-gray-400 shrink-0" />
            <input
              type="text"
              placeholder="Search customers, agents, reports…"
              className="outline-none flex-1 text-[14px] placeholder-gray-400 text-gray-800"
              autoFocus
            />
            <button
              onClick={() => setShowMobileSearch(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
            >
              <HiXMark className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-fade-in-up { animation: fade-in-up 0.15s ease-out both; }
        @keyframes slide-in-top {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-in-top { animation: slide-in-top 0.15s ease-out both; }
      `}</style>
    </>
  );
};

export default DashboardHeader;
