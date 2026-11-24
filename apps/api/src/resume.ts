import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export const resumeMaxBytes = 5 * 1024 * 1024;

export type ResumeUpload = { originalname: string; mimetype: string; buffer: Buffer };

export function validateResume(file: ResumeUpload) {
  if (file.buffer.length > resumeMaxBytes) throw new PayloadTooLargeException('Choose a PDF that is 5 MB or smaller.');
  const filename = Array.from((file.originalname.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '').trim());
  const name = filename.join('');
  const isPdf = name.toLowerCase().endsWith('.pdf')
    && ['application/pdf', 'application/octet-stream'].includes(file.mimetype)
    && /^%PDF-\d\.\d/.test(file.buffer.subarray(0, 8).toString('ascii'))
    && file.buffer.subarray(-1024).includes('%%EOF');
  if (!isPdf) throw new BadRequestException('Choose a valid PDF résumé.');
  return { filename: filename.slice(0, -4).slice(0, 116).join('') + '.pdf', content: file.buffer };
}

export function resumeDisposition(filename: string) {
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) =>
    '%' + character.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="resume.pdf"; filename*=UTF-8''${encoded}`;
}
