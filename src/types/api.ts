export enum MessageType {
  NONE = 0,
  USER = 1,
  BOT = 2,
}

export enum MessageItemType {
  NONE = 0,
  TEXT = 1,
  IMAGE = 2,
  VOICE = 3,
  FILE = 4,
  VIDEO = 5,
}

export enum MessageState {
  NEW = 0,
  GENERATING = 1,
  FINISH = 2,
}

export enum TypingStatus {
  TYPING = 1,
  CANCEL = 2,
}

export enum UploadMediaType {
  IMAGE = 1,
  VIDEO = 2,
  FILE = 3,
  VOICE = 4,
}

export interface BaseInfo {
  channel_version: string;
}

export interface QrCodeResponse {
  ret: number;
  qrcode: string;
  qrcode_img_content: string;
}

export type QrCodeStatus = 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect';

export interface QrCodeStatusResponse {
  status: QrCodeStatus;
  ret?: number;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
  route_tag?: number;
}

export interface Credentials {
  botToken: string;
  botId: string;
  userId: string;
  baseUrl: string;
  routeTag?: number;
  savedAt: number;
  channelVersion?: string;
}

export interface LoginResult {
  qrcodeId: string;
  qrcodeUrl: string;
}

export interface RawTextItem {
  text: string;
}

export interface RawReferenceItem {
  title?: string;
  ref_body?: string;
}

export interface RawMediaDescriptor {
  encrypt_query_param?: string;
  encrypted_query_param?: string;
  aes_key?: string;
  full_url?: string;
  encrypt_type?: number;
}

export interface RawImageItem {
  aeskey?: string;
  media?: RawMediaDescriptor;
}

export interface RawVoiceItem {
  text?: string;
  media?: RawMediaDescriptor;
}

export interface RawFileItem {
  file_name?: string;
  len?: string;
  media?: RawMediaDescriptor;
}

export interface RawVideoItem {
  media?: RawMediaDescriptor;
  video_size?: number;
}

export interface RawMessageItem {
  type: MessageItemType;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  text_item?: RawTextItem;
  ref_msg_item?: RawReferenceItem;
  image_item?: RawImageItem;
  voice_item?: RawVoiceItem;
  file_item?: RawFileItem;
  video_item?: RawVideoItem;
}

export interface RawMessage {
  seq?: number;
  message_id: number | string;
  from_user_id: string;
  to_user_id: string;
  client_id?: string;
  create_time_ms: number;
  update_time_ms?: number;
  message_type: MessageType;
  message_state: MessageState;
  item_list: RawMessageItem[];
  context_token: string;
}

export interface GetUpdatesResponse {
  ret?: number;
  errcode?: number;
  sync_buf?: string;
  get_updates_buf?: string;
  msgs?: RawMessage[];
}

export interface TextMessageItem {
  type: MessageItemType.TEXT;
  text_item: {
    text: string;
  };
}

export interface ImageMessageItem {
  type: MessageItemType.IMAGE;
  image_item: {
    media?: RawMediaDescriptor;
    aeskey?: string;
    mid_size?: number;
  };
}

export interface FileMessageItem {
  type: MessageItemType.FILE;
  file_item: {
    file_name?: string;
    len?: string;
    media?: RawMediaDescriptor;
  };
}

export type SendableMessageItem = TextMessageItem | ImageMessageItem | FileMessageItem;

export interface SendMessageRequest {
  msg: {
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    message_type: MessageType.BOT;
    message_state: MessageState;
    item_list: SendableMessageItem[];
    context_token: string;
  };
  base_info: BaseInfo;
}

export interface GetConfigResponse {
  ret?: number;
  typing_ticket?: string;
}

export interface GetUploadUrlResponse {
  ret?: number;
  upload_url?: string;
  upload_param?: string;
  upload_full_url?: string;
}
