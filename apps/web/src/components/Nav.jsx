import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Wallet } from "@phosphor-icons/react";
import { useAuth } from "../context/AuthContext";

function truncateAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const SCROLL_COLLAPSE = 80;
const SCROLL_EXPAND = 48;

export default function Nav() {
  const { isAuthenticated, walletAddress, connectWallet, disconnect, authError } =
    useAuth();
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(false);
  }, [location.pathname]);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      setCollapsed((prev) => {
        if (y <= SCROLL_EXPAND) return false;
        if (y >= SCROLL_COLLAPSE) return true;
        return prev;
      });
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setCollapsed(false);
  }

  return (
    <nav
      className={`fixed z-50 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        collapsed
          ? "top-4 right-4 left-auto translate-x-0 w-auto max-w-none"
          : "top-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-3xl"
      }`}
    >
      <div
        className={`glass-panel flex items-center transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          collapsed
            ? "rounded-2xl px-2 py-2 gap-1.5 shadow-lg shadow-black/20"
            : "rounded-full px-5 py-3 justify-between"
        }`}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={scrollToTop}
            className="group flex items-center p-1 rounded-xl hover:bg-white/5 transition-colors"
            title="Back to top"
            aria-label="Back to top"
          >
            <img
              src="/brand/hodl-logo.png"
              alt="HODL"
              className="w-9 h-9 rounded-full ring-1 ring-white/10 object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </button>
        ) : (
          <Link to="/" className="group flex items-center gap-2.5 min-w-0">
            <img
              src="/brand/hodl-logo.png"
              alt="HODL Token Club"
              className="w-7 h-7 shrink-0 rounded-full ring-1 ring-white/10 object-cover transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105"
            />
            <span className="text-sm font-semibold tracking-tight text-white leading-tight truncate">
              HODL Artwork Generator
            </span>
          </Link>
        )}

        <div
          className={`flex items-center transition-all duration-500 ${
            collapsed ? "gap-1" : "gap-4"
          }`}
        >
          {!collapsed && authError && (
            <span
              className="hidden sm:block max-w-[200px] truncate text-xs text-red-400"
              title={authError}
            >
              {authError}
            </span>
          )}
          {!collapsed && isAuthenticated && !isLanding && (
            <Link
              to="/dashboard"
              className="text-sm text-zinc-400 hover:text-white transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
            >
              Projects
            </Link>
          )}

          {isAuthenticated ? (
            <button
              onClick={disconnect}
              className={`group flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${
                collapsed ? "p-2" : "gap-2 px-4 py-2"
              }`}
              title={collapsed ? truncateAddress(walletAddress) : undefined}
            >
              <span
                className={`rounded-full bg-emerald-500/20 flex items-center justify-center ${
                  collapsed ? "w-7 h-7" : "w-6 h-6"
                }`}
              >
                <Wallet size={collapsed ? 16 : 14} weight="light" />
              </span>
              {!collapsed && truncateAddress(walletAddress)}
            </button>
          ) : (
            <button
              onClick={connectWallet}
              className={`group flex items-center rounded-full bg-emerald-500 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${
                collapsed ? "p-2.5" : "gap-2 px-4 py-2"
              }`}
              title={collapsed ? "Connect Wallet" : undefined}
            >
              {!collapsed && "Connect Wallet"}
              <span
                className={`rounded-full bg-black/10 flex items-center justify-center group-hover:translate-x-0.5 group-hover:-translate-y-px transition-transform duration-300 ${
                  collapsed ? "w-6 h-6" : "w-6 h-6"
                }`}
              >
                <Wallet size={14} weight="bold" />
              </span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
