import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export const coverMaxBytes = 5 * 1024 * 1024;
export type CoverUpload = { buffer: Buffer };
export type Cover = { content: Buffer; mime: string };

export function validateCover(file?: CoverUpload) {
  if (!file) return undefined;
  const bytes = file.buffer;
  if (bytes.length > coverMaxBytes) throw new PayloadTooLargeException('Choose a cover image up to 5 MB.');
  const header = bytes.subarray(0, 12);
  let mime: string | undefined;
  if (bytes.length >= 20 && header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) mime = 'image/jpeg';
  else if (bytes.length >= 33 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
  else if (bytes.length >= 20 && header.subarray(0, 4).toString('ascii') === 'RIFF'
    && header.subarray(8, 12).toString('ascii') === 'WEBP' && header.readUInt32LE(4) + 8 === bytes.length) mime = 'image/webp';
  if (!mime) throw new BadRequestException('Choose a valid JPEG, PNG, or WebP cover image.');
  return { content: bytes, mime };
}
