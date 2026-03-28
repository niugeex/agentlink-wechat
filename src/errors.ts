export class ILinkError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class AuthError extends ILinkError {}
export class NetworkError extends ILinkError {
  readonly isTimeout: boolean;

  constructor(message: string, code?: number, options?: ErrorOptions & { isTimeout?: boolean }) {
    super(message, code, options);
    this.isTimeout = options?.isTimeout ?? false;
  }
}
export class ProtocolError extends ILinkError {}
export class MediaError extends ILinkError {}
