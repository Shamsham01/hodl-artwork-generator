import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useGetAccountInfo } from "@multiversx/sdk-dapp/out/react/account/useGetAccountInfo";
import { useGetLoginInfo } from "@multiversx/sdk-dapp/out/react/loginInfo/useGetLoginInfo";
import { getAccountProvider } from "@multiversx/sdk-dapp/out/providers/helpers/accountProvider";
import { supabase, loginWithNativeAuth } from "../lib/supabase";
import { initWalletConnect, openWalletConnect } from "../utils/walletConnect";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const { account } = useGetAccountInfo();
  const loginInfo = useGetLoginInfo();
  const nativeAuthToken = loginInfo?.tokenLogin?.nativeAuthToken;

  useEffect(() => {
    initWalletConnect();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    setProfile(data);
  }

  useEffect(() => {
    if (account?.address && nativeAuthToken && !user) {
      handleNativeAuth(nativeAuthToken);
    }
  }, [account?.address, nativeAuthToken, user]);

  const handleNativeAuth = async (token) => {
    try {
      setAuthError(null);
      const data = await loginWithNativeAuth(token);
      if (data.user) setUser(data.user);
      if (data.wallet_address) {
        setProfile({ wallet_address: data.wallet_address });
      }
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const connectWallet = useCallback(() => {
    openWalletConnect();
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await getAccountProvider()?.logout();
    } catch {}
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const value = {
    user,
    profile,
    walletAddress: profile?.wallet_address || account?.address,
    loading,
    authError,
    connectWallet,
    disconnect,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
