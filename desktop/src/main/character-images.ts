import type { BrowserWindow } from 'electron';
import { characterImageTypes, type CharacterImageFormat } from '../shared/character-images';

const invalidImage = '图片无法读取，请选择有效的 PNG、GIF 或 WebP 文件';

/** Check dimensions before asking Chromium to allocate decoded image frames. */
export function inspectCharacterImage(bytes: Buffer): { format: CharacterImageFormat; width: number; height: number } {
  let format: CharacterImageFormat;
  let width = 0;
  let height = 0;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    format = 'png';
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    format = 'gif';
    width = bytes.readUInt16LE(6);
    height = bytes.readUInt16LE(8);
  } else if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    format = 'webp';
    const end = bytes.readUInt32LE(4) + 8;
    if (end !== bytes.length) throw new Error(invalidImage);
    for (let offset = 12; offset + 8 <= end;) {
      const type = bytes.toString('ascii', offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (start + length > end) throw new Error(invalidImage);
      if (type === 'VP8X' && length >= 10) {
        width = bytes.readUIntLE(start + 4, 3) + 1;
        height = bytes.readUIntLE(start + 7, 3) + 1;
        break;
      }
      if (type === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
        const bits = bytes.readUInt32LE(start + 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
        break;
      }
      if (type === 'VP8 ' && length >= 10 && bytes.toString('hex', start + 3, start + 6) === '9d012a') {
        width = bytes.readUInt16LE(start + 6) & 0x3fff;
        height = bytes.readUInt16LE(start + 8) & 0x3fff;
        break;
      }
      offset = start + length + (length % 2);
    }
  } else throw new Error(invalidImage);
  if (!width || !height) throw new Error(invalidImage);
  if (width > 4096 || height > 4096) throw new Error('角色图片或动图不能超过 4096 × 4096 像素');
  return { format, width, height };
}

// This self-contained function runs in the existing sandboxed renderer.
// nativeImage does not decode GIF/WebP; Chromium's ImageDecoder preserves animation metadata.
async function decodeInRenderer(base64: string, type: string) {
  const data = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  const decoder = new ImageDecoder({ data, type, preferAnimation: true });
  try {
    await decoder.tracks.ready;
    const frameCount = decoder.tracks.selectedTrack?.frameCount;
    if (!frameCount) throw new Error('No image frames');
    const { image } = await decoder.decode({ frameIndex: 0 });
    try {
      const width = image.displayWidth;
      const height = image.displayHeight;
      const scale = Math.min(1, 720 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { width, height, frameCount, preview: canvas.toDataURL('image/png').slice('data:image/png;base64,'.length) };
    } finally { image.close(); }
  } finally { decoder.close(); }
}

export async function decodeCharacterImage(window: BrowserWindow, bytes: Buffer) {
  const metadata = inspectCharacterImage(bytes);
  try {
    const decoded: Awaited<ReturnType<typeof decodeInRenderer>> = await window.webContents.executeJavaScript(
      `(${decodeInRenderer.toString()})(${JSON.stringify(bytes.toString('base64'))}, ${JSON.stringify(characterImageTypes[metadata.format])})`,
    );
    if (decoded.width !== metadata.width || decoded.height !== metadata.height || !Number.isSafeInteger(decoded.frameCount) || decoded.frameCount < 1) throw new Error(invalidImage);
    return { ...metadata, frameCount: decoded.frameCount, preview: Buffer.from(decoded.preview, 'base64') };
  } catch { throw new Error(invalidImage); }
}
