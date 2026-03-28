import { DEFAULT_BASE_URL, DEFAULT_TIMEOUTS } from '../constants.js';
import { AuthError } from '../errors.js';
import { ILinkHttpClient } from '../http/client.js';
import type { Credentials, LoginResult, QrCodeResponse, QrCodeStatusResponse } from '../types/api.js';

export interface QrLoginOptions {
  maxRefreshes?: number;
  onScanned?: () => void;
  onQrcode?: (url: string) => void;
}

export class QrCodeLogin {
  private readonly http: ILinkHttpClient;
  private readonly maxRefreshes: number;
  readonly onScanned?: () => void;
  readonly onQrcode?: (url: string) => void;

  constructor(http?: ILinkHttpClient, options: QrLoginOptions = {}) {
    this.http = http ?? new ILinkHttpClient({ baseUrl: DEFAULT_BASE_URL });
    this.maxRefreshes = options.maxRefreshes ?? 3;
    this.onScanned = options.onScanned;
    this.onQrcode = options.onQrcode;
  }

  async createLogin(): Promise<LoginResult> {
    const response = await this.http.get<QrCodeResponse>('ilink/bot/get_bot_qrcode?bot_type=3');
    const result = {
      qrcodeId: response.qrcode,
      qrcodeUrl: response.qrcode_img_content,
    };
    this.onQrcode?.(result.qrcodeUrl);
    return result;
  }

  async waitForLogin(loginResult?: LoginResult): Promise<Credentials> {
    let current = loginResult ?? (await this.createLogin());
    let refreshCount = 0;

    while (refreshCount <= this.maxRefreshes) {
      const credentials = await this.pollUntilResolved(current.qrcodeId);
      if (credentials) {
        return credentials;
      }
      refreshCount += 1;
      if (refreshCount > this.maxRefreshes) {
        break;
      }
      current = await this.createLogin();
    }

    throw new AuthError('QR code expired too many times');
  }

  private async pollUntilResolved(qrcodeId: string): Promise<Credentials | null> {
    for (;;) {
      const response = await this.http.get<QrCodeStatusResponse>(
        `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeId)}`,
        DEFAULT_TIMEOUTS.loginPoll,
      );

      switch (response.status) {
        case 'wait':
          continue;
        case 'scaned':
          this.onScanned?.();
          continue;
        case 'scaned_but_redirect':
          if (response.redirect_host) {
            this.http.setBaseUrl(`https://${response.redirect_host}`);
          }
          continue;
        case 'expired':
          return null;
        case 'confirmed':
          return this.toCredentials(response);
        default:
          throw new AuthError(`Unexpected QR code status: ${String(response.status)}`);
      }
    }
  }

  private toCredentials(response: QrCodeStatusResponse): Credentials {
    if (!response.bot_token || !response.ilink_bot_id || !response.ilink_user_id || !response.baseurl) {
      throw new AuthError('Confirmed response missing credentials');
    }

    return {
      botToken: response.bot_token,
      botId: response.ilink_bot_id,
      userId: response.ilink_user_id,
      baseUrl: response.baseurl,
      routeTag: response.route_tag,
      savedAt: Date.now(),
    };
  }
}
