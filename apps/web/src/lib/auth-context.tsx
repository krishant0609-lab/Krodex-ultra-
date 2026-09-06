'use client';

import React, { createContext, useContext } from 'react';

interface User {
  id: string;
  email: string;
  name?: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
});

export function useSupabaseAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // TODO: wire to real Supabase session
  const [user] = React.useState<User | null>(null);
  const [loading] = React.useState(false);

  const signIn = async (_email: string, _password: string) => {
    console.warn('[AuthContext] signIn not yet wired to Supabase');
  };

  const signUp = async (_email: string, _password: string) => {
    console.warn('[AuthContext] signUp not yet wired to Supabase');
  };

  const signOut = async () => {
    console.warn('[AuthContext] signOut not yet wired to Supabase');
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
