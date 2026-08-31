// Shared by both transports so the caller (chat) never has to know which one ran.
// Lives in its own file because the invoker and the CAP client both depend on it.

export interface FmInvocationResponse {
  status: number;
  data: unknown;
}

// Carries a message already worded for the transport that failed. A 401 means
// "SAP rejected the backend user" on a direct call but "XSUAA rejected the client
// credentials" through the CAP facade, and reporting the wrong one sends whoever
// is debugging to the wrong system.
export class FmInvocationError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'FmInvocationError';
  }
}
