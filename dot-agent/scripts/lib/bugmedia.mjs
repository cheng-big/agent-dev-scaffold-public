import { closeSync, openSync, readSync } from 'node:fs';
import { extname } from 'node:path';

export const imageExtension = /\.(png|jpe?g|gif|webp)$/i;
export const videoExtension = /\.(mp4|mov|webm)$/i;

export function hasMediaHeader(file) {
  if (!imageExtension.test(file) && !videoExtension.test(file)) return false;
  const header = Buffer.alloc(16);
  const fd = openSync(file, 'r');
  try {
    if (readSync(fd, header, 0, header.length, 0) < header.length) return false;
  } finally {
    closeSync(fd);
  }
  switch (extname(file).toLowerCase()) {
    case '.png': return header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && header.toString('ascii', 12, 16) === 'IHDR';
    case '.jpg':
    case '.jpeg': return header.subarray(0, 3).toString('hex') === 'ffd8ff';
    case '.gif': return /^GIF8[79]a$/.test(header.toString('ascii', 0, 6));
    case '.webp': return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
    case '.mp4':
    case '.mov': return header.toString('ascii', 4, 8) === 'ftyp';
    case '.webm': return header.subarray(0, 4).toString('hex') === '1a45dfa3';
    default: return false;
  }
}
