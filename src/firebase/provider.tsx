
'use client';

import React, { createContext, useContext, ReactNode, useMemo, useState } from 'react';

/**
 * STANDALONE PROVIDER
 * This replaces the Firebase logic with a local state provider
 * so the app can be used in VS Code without any Firebase dependencies.
 */

export interface FirebaseContextState {
  areServicesAvailable: boolean;
  firebaseApp: any;
  firestore: any;
  auth: any;
  user: { uid: string; displayName: string | null; email: string | null } | null;
  isUserLoading: boolean;
  userError: any;
}

export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

export const FirebaseProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user] = useState({ 
    uid: 'local-user', 
    displayName: 'Local Creator',
    email: 'local@example.com' 
  });

  const contextValue = useMemo(() => ({
    areServicesAvailable: true,
    firebaseApp: {},
    firestore: {},
    auth: {},
    user,
    isUserLoading: false,
    userError: null,
  }), [user]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider.');
  }
  return context;
};

export const useAuth = () => ({});
export const useFirestore = () => ({});
export const useFirebaseApp = () => ({});
export const useUser = () => {
  const { user, isUserLoading, userError } = useFirebase();
  return { user, isUserLoading, userError };
};

export function useMemoFirebase<T>(factory: () => T, deps: React.DependencyList): T {
  return React.useMemo(factory, deps);
}
