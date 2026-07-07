
'use client';

/**
 * STANDALONE ERROR MOCK
 * Provides a serializable error object without Firebase Auth dependencies.
 */

type SecurityRuleContext = {
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write';
  requestResourceData?: any;
};

export class FirestorePermissionError extends Error {
  public readonly request: any;

  constructor(context: SecurityRuleContext) {
    const requestObject = {
      auth: { uid: 'local-user' },
      method: context.operation,
      path: context.path,
      resource: context.requestResourceData ? { data: context.requestResourceData } : undefined,
    };
    super(`Permission denied for local operation: ${JSON.stringify(requestObject)}`);
    this.name = 'LocalFsError';
    this.request = requestObject;
  }
}
