import { Link, useLocation } from "react-router-dom";
import { Wallet } from "@phosphor-icons/react";
import { useAuth } from "../context/AuthContext";

function truncateAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function Nav() {
  const { isAuthenticated, walletAddress, connectWallet, disconnect, authError } =
    useAuth();
  const location = useLocation();
  const isLanding = location.pathname === "/";

  return (
    <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-3xl">
      <div className="glass-panel rounded-full px-5 py-3 flex items-center justify-between">
        <Link to="/" className="group flex items-center gap-2.5">
          <img
            src="/brand/hodl-logo.png"
            alt="HODL Token Club"
            className="w-7 h-7 rounded-full ring-1 ring-white/10 object-cover transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105"
          />
          <span className="text-sm font-semibold tracking-tight text-white leading-tight">
            HODL Artwork Generator
          </span>
        </Link>

        <div className="flex items-center gap-4">
          {authError && (
            <span
              className="hidden sm:block max-w-[200px] truncate text-xs text-red-400"
              title={authError}
            >
              {authError}
            </span>
          )}
          {isAuthenticated && !isLanding && (
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
              className="group flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
            >
              <span className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <Wallet size={14} weight="light" />
              </span>
              {truncateAddress(walletAddress)}
            </button>
          ) : (
            <button
              onClick={connectWallet}
              className="group flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
            >
              Connect Wallet
              <span className="w-6 h-6 rounded-full bg-black/10 flex items-center justify-center group-hover:translate-x-0.5 group-hover:-translate-y-px transition-transform duration-300">
                <Wallet size={14} weight="bold" />
              </span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
