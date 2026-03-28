import type { Credentials } from './api.js';
import type { Message } from '../messaging/receiver.js';

export interface AgentLinkWechatEvents {
  message: (message: Message) => void | Promise<void>;
  login: (credentials: Credentials) => void;
  logout: (reason: string) => void;
  error: (error: Error) => void;
  qrcode: (url: string) => void;
  'qrcode:scanned': () => void;
}
