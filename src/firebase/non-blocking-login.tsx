
'use client';

/**
 * STANDALONE LOGIN MOCK
 */

export function initiateAnonymousSignIn(authInstance: any): void {
  console.log('Local anonymous sign-in initiated');
}

export function initiateEmailSignUp(authInstance: any, email: string, password: string): void {
  console.log('Local email sign-up initiated');
}

export function initiateEmailSignIn(authInstance: any, email: string, password: string): void {
  console.log('Local email sign-in initiated');
}
