import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { MemberUploadGuard, positiveId, read, requireUser } from './access.js';
import { parseArticle } from './article-document.js';
import { coverMaxBytes, type CoverUpload, validateCover } from './publication-cover.js';
import { discardDraft, listPublications, publicationCover, saveArticle, saveNewsletter, setSubscription, viewArticle, viewNewsletter } from './publications.js';

const receiveCover = FileInterceptor('cover', {
  limits: { fileSize: coverMaxBytes + 1, fieldSize: 190_000, fields: 6, parts: 8, files: 1 }
});
const imageFields = { coverAlt: z.string().trim().max(240).default(''), coverAction: z.enum(['keep','remove']).default('keep') };
const articleFields = z.object({
  title: z.string().trim().max(160).default(''), body: z.unknown(), mode: z.enum(['draft', 'publish']),
  newsletterId: positiveId.optional(), ...imageFields
});
const newsletterFields = z.object({
  title: z.string().trim().min(1).max(100), description: z.string().trim().min(1).max(800),
  cadence: z.enum(['Weekly', 'Every two weeks', 'Monthly', 'Occasional']), ...imageFields
});

function articleInput(body: unknown, file?: CoverUpload) {
  const fields = read(articleFields, body);
  return { ...fields, ...parseArticle(fields.body), cover: validateCover(file), removeCover: fields.coverAction === 'remove' && !file };
}
function newsletterInput(body: unknown, file?: CoverUpload) {
  const fields = read(newsletterFields, body);
  return { ...fields, cover: validateCover(file), removeCover: fields.coverAction === 'remove' && !file };
}

@Controller('api/publications')
export class PublicationsController {
  @Get()
  async list(@Req() request: Request) {
    return listPublications((await requireUser(request)).id);
  }

  @Get('articles/:id')
  async article(@Req() request: Request, @Param('id') id: string) {
    return viewArticle((await requireUser(request)).id, read(positiveId, id));
  }

  @Post('articles')
  @UseGuards(MemberUploadGuard)
  @UseInterceptors(receiveCover)
  async newArticle(@Req() request: Request, @Body() body: unknown, @UploadedFile() file?: CoverUpload) {
    return saveArticle((await requireUser(request)).id, articleInput(body, file));
  }

  @Patch('articles/:id')
  @UseGuards(MemberUploadGuard)
  @UseInterceptors(receiveCover)
  async updateArticle(@Req() request: Request, @Param('id') id: string, @Body() body: unknown, @UploadedFile() file?: CoverUpload) {
    return saveArticle((await requireUser(request)).id, articleInput(body, file), read(positiveId, id));
  }

  @Delete('articles/:id')
  async deleteDraft(@Req() request: Request, @Param('id') id: string) {
    await discardDraft((await requireUser(request)).id, read(positiveId, id));
    return { ok: true };
  }

  @Get('newsletters/:id')
  async newsletter(@Req() request: Request, @Param('id') id: string) {
    return viewNewsletter((await requireUser(request)).id, read(positiveId, id));
  }

  @Post('newsletters')
  @UseGuards(MemberUploadGuard)
  @UseInterceptors(receiveCover)
  async newNewsletter(@Req() request: Request, @Body() body: unknown, @UploadedFile() file?: CoverUpload) {
    return saveNewsletter((await requireUser(request)).id, newsletterInput(body, file));
  }

  @Patch('newsletters/:id')
  @UseGuards(MemberUploadGuard)
  @UseInterceptors(receiveCover)
  async updateNewsletter(@Req() request: Request, @Param('id') id: string, @Body() body: unknown, @UploadedFile() file?: CoverUpload) {
    return saveNewsletter((await requireUser(request)).id, newsletterInput(body, file), read(positiveId, id));
  }

  @Post('newsletters/:id/subscription')
  async subscription(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const member = await requireUser(request);
    const { subscribed } = read(z.object({ subscribed: z.boolean() }), body);
    await setSubscription(member.id, read(positiveId, id), subscribed);
    return { ok: true };
  }

  @Get(':kind/:id/cover')
  async cover(@Req() request: Request, @Param('kind') kind: string, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const member = await requireUser(request);
    const item = read(z.enum(['articles', 'newsletters']), kind);
    const file = await publicationCover(member.id, item === 'articles' ? 'article' : 'newsletter', read(positiveId, id));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.cover, { type: file.cover_type });
  }
}
