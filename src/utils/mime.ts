import { extname } from 'node:path';
import { UploadMediaType } from '../types/api.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);

export function getUploadMediaType(filePath: string): UploadMediaType {
  const extension = extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return UploadMediaType.IMAGE;
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return UploadMediaType.VIDEO;
  }
  return UploadMediaType.FILE;
}

export function getContentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  switch (extension) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.mp4':
      return 'video/mp4';
    case '.pdf':
      return 'application/pdf';
    case '.txt':
      return 'text/plain';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}
