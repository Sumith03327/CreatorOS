
'use client';

/**
 * STANDALONE UPDATES MOCK
 */
import { setDoc, addDoc, updateDoc, deleteDoc } from './index';

export function setDocumentNonBlocking(docRef: any, data: any, options: any) {
  setDoc(docRef, data, options);
}

export function addDocumentNonBlocking(colRef: any, data: any) {
  return addDoc(colRef, data);
}

export function updateDocumentNonBlocking(docRef: any, data: any) {
  updateDoc(docRef, data);
}

export function deleteDocumentNonBlocking(docRef: any) {
  deleteDoc(docRef);
}
