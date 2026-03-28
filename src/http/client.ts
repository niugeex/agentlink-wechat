import { DEFAULT_BASE_URL, DEFAULT_CLIENT_VERSION, DEFAULT_TIMEOUTS } from '../constants.js';
import { AuthError, NetworkError, ProtocolError } from '../errors.js';
import type { Credentials } from '../types/api.js';
import { createWechatUin } from '../utils/ids.js';

type HeaderMap = Record<string, string>;

export interface HttpClientOptions {
  baseUrl?: string;
  credentials?: Credentials | null;
  fetchImpl?: typeof fetch;
}

export class ILinkHttpClient {
  private readonly fetchImpl: typeof fetch;
  private baseUrl: string;
  private credentials: Credentials | null;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.credentials = options.credentials ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setCredentials(credentials: Credentials | null): void {
    this.credentials = credentials;
    if (credentials) {
      this.setBaseUrl(credentials.baseUrl);
    }
  }

  async get<T>(path: string, timeout: number = DEFAULT_TIMEOUTS.get): Promise<T> {
    return this.request<T>('GET', path, undefined, timeout, false);
  }

  async post<T>(path: string, body: object, timeout: number = DEFAULT_TIMEOUTS.defaultPost): Promise<T> {
    return this.request<T>('POST', path, body, timeout, true);
  }

  async upload(url: string, body: Buffer, headers: HeaderMap = {}, method: 'POST' | 'PUT' = 'POST'): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body,
      });
    } catch (error) {
      throw new NetworkError('Failed to upload media', undefined, { cause: error });
    }
  }

  async download(url: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, { method: 'GET' });
    } catch (error) {
      throw new NetworkError('Failed to download media', undefined, { cause: error });
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: object | undefined,
    timeout: number,
    withAuth: boolean,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const url = new URL(path.replace(/^\/+/, ''), `${this.baseUrl}/`);

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: this.buildHeaders(withAuth),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new NetworkError(`HTTP ${response.status} for ${url.pathname}`);
      }

      const data = (await response.json()) as { ret?: number; errcode?: number };
      const code = typeof data.ret === 'number' && data.ret !== 0 ? data.ret : data.errcode;
      if (typeof code === 'number' && code !== 0) {
        if (code === -14) {
          throw new AuthError('Session expired', code);
        }
        throw new ProtocolError(`iLink API returned error code ${code}`, code);
      }
      return data as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NetworkError(`Request timed out after ${timeout}ms`, undefined, { cause: error, isTimeout: true });
      }
      if (error instanceof AuthError || error instanceof ProtocolError || error instanceof NetworkError) {
        throw error;
      }
      throw new NetworkError(`Request failed: ${url.pathname}`, undefined, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(withAuth: boolean): HeaderMap {
    const headers: HeaderMap = {
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': DEFAULT_CLIENT_VERSION,
    };

    if (!withAuth) {
      return headers;
    }

    if (!this.credentials) {
      throw new AuthError('Missing credentials');
    }

    headers['Content-Type'] = 'application/json';
    headers.AuthorizationType = 'ilink_bot_token';
    headers.Authorization = `Bearer ${this.credentials.botToken}`;
    headers['X-WECHAT-UIN'] = createWechatUin();

    if (typeof this.credentials.routeTag === 'number') {
      headers.SKRouteTag = String(this.credentials.routeTag);
    }

    return headers;
  }
}
