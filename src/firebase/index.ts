
'use client';

/**
 * STANDALONE FIREBASE MOCK
 * Provides non-functional mocks for Firestore/Auth to prevent import errors.
 * All persistence is now handled via localStorage.
 */

export * from './provider';

export function initializeFirebase() {
  return {
    firebaseApp: {},
    auth: {
      onAuthStateChanged: (cb: any) => {
        cb({ uid: 'local-user', displayName: 'Local Creator' });
        return () => {};
      }
    },
    firestore: {}
  };
}

export const doc = (...args: any[]) => ({ path: args.join('/') });
export const collection = (...args: any[]) => ({ path: args.join('/') });
export const query = (ref: any, ...args: any[]) => ref;
export const orderBy = (field: string, direction?: string) => ({ type: 'orderBy', field, direction });
export const limit = (n: number) => ({ type: 'limit', n });
export const serverTimestamp = () => new Date().toISOString();
export const Timestamp = {
  now: () => ({ 
    toMillis: () => Date.now(), 
    toDate: () => new Date(),
    toISOString: () => new Date().toISOString()
  })
};

// LocalStorage based mocks
export async function getDoc(docRef: any) {
  const data = localStorage.getItem(`fs_${docRef.path}`);
  return {
    exists: () => !!data,
    data: () => data ? JSON.parse(data) : null,
    id: docRef.path.split('/').pop(),
  };
}

export async function getDocs(queryRef: any) {
  const results: any[] = [];
  const prefix = `fs_${queryRef.path}/`;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      results.push({
        data: () => JSON.parse(localStorage.getItem(key)!),
        id: key.split('/').pop(),
      });
    }
  }
  return {
    docs: results,
    empty: results.length === 0
  };
}

export async function setDoc(docRef: any, data: any, options?: any) {
  const key = `fs_${docRef.path}`;
  const existing = options?.merge ? JSON.parse(localStorage.getItem(key) || '{}') : {};
  localStorage.setItem(key, JSON.stringify({ ...existing, ...data, updatedAt: new Date().toISOString() }));
}

export async function addDoc(colRef: any, data: any) {
  const id = Math.random().toString(36).substring(7);
  const key = `fs_${colRef.path}/${id}`;
  localStorage.setItem(key, JSON.stringify({ ...data, id, createdAt: new Date().toISOString() }));
  return { id };
}

export async function updateDoc(docRef: any, data: any) {
  const key = `fs_${docRef.path}`;
  const existing = JSON.parse(localStorage.getItem(key) || '{}');
  localStorage.setItem(key, JSON.stringify({ ...existing, ...data }));
}

export async function deleteDoc(docRef: any) {
  localStorage.removeItem(`fs_${docRef.path}`);
}

export function initiateAnonymousSignIn() {}
export function initiateEmailSignUp() {}
export function initiateEmailSignIn() {}
export function setDocumentNonBlocking() {}
export function updateDocumentNonBlocking() {}
export function deleteDocumentNonBlocking() {}
export function addDocumentNonBlocking() {}
