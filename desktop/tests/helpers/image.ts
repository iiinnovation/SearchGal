import { crc32, deflateSync } from 'node:zlib';

/** A transparent geometric PNG, independent of user-provided character artwork. */
export function transparentFixturePng(): Buffer {
  const width = 369;
  const height = 544;
  const pixels = Buffer.alloc((1 + width * 4) * height);
  for (let y = 100; y < 520; y++) {
    for (let x = 90; x < 280; x++) {
      const offset = y * (1 + width * 4) + 1 + x * 4;
      pixels.set([60, 140, 170, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
