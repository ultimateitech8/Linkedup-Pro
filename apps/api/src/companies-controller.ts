import { Body, Controller, Delete, Get, Param, Patch, PayloadTooLargeException, Post, Req, Res, StreamableFile, UploadedFiles,
  UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { MemberUploadGuard, positiveId, read, requireUser } from './access.js';
import {
  addCompanyUpdate, changeCompanyMembership, companyImage, createCompany, decideCompanyMembership, editCompany,
  listCompanies, moderateCompanyUpdate, removeCompanyPage, saveCompanyPage, setFollow, viewCompany
} from './companies.js';
import { coverMaxBytes, validateCover, type CoverUpload } from './publication-cover.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).default('');
const url = z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(2048).refine((value) => {
  const parsed = new URL(value);
  return !parsed.username && !parsed.password;
}, 'Use a public web address.')]).default('');
const companyFields = z.object({
  name: text(100), description: text(2400), industry: text(80), size: text(40), headquarters: text(120),
  locations: optional(900).transform((value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(120)).max(12)),
  workplace: z.enum(['On-site','Hybrid','Remote','Varies by role']), website: url, culture: optional(3000),
  ctaLabel: optional(40), ctaUrl: url,
  logoAlt: optional(240), bannerAlt: optional(240),
  logoAction: z.enum(['keep','remove']).default('keep'), bannerAction: z.enum(['keep','remove']).default('keep')
}).refine((fields) => Boolean(fields.ctaLabel) === Boolean(fields.ctaUrl), 'Provide both a button label and a link, or leave both blank.');
const pageFields = z.object({ kind: z.enum(['Product','Showcase']), title: text(100), description: text(2000), url });
type BrandFiles = { logo?: CoverUpload[]; banner?: CoverUpload[] };
const branding = FileFieldsInterceptor([{ name: 'logo', maxCount: 1 }, { name: 'banner', maxCount: 1 }], {
  limits: { fileSize: coverMaxBytes + 1, fieldSize: 12_000, fields: 16, parts: 19, files: 2 }
});

function companyInput(body: unknown, files?: BrandFiles) {
  const fields = read(companyFields, body);
  if (files?.logo?.[0] && files.logo[0].buffer.length > 2 * 1024 * 1024) throw new PayloadTooLargeException('Choose a logo up to 2 MB.');
  const logo = validateCover(files?.logo?.[0]);
  const banner = validateCover(files?.banner?.[0]);
  return { ...fields, logo: { file: logo, alt: fields.logoAlt, remove: fields.logoAction === 'remove' && !logo },
    banner: { file: banner, alt: fields.bannerAlt, remove: fields.bannerAction === 'remove' && !banner } };
}

@Controller('api/companies')
export class CompaniesController {
  @Get()
  async list(@Req() request: Request) {
    return listCompanies((await requireUser(request)).id);
  }

  @Post()
  @UseGuards(MemberUploadGuard)
  @UseInterceptors(branding)
  async create(@Req() request: Request, @Body() body: unknown, @UploadedFiles() files?: BrandFiles) {
    return createCompany((await requireUser(request)).id, companyInput(body, files));
  }

  @Get(':id')
  async details(@Req() request: Request, @Param('id') id: string) {
    return viewCompany((await requireUser(request)).id, read(positiveId, id));
  }

  @Patch(':id')
  @UseGuards(MemberUploadGuard)
  @UseInterceptors(branding)
  async edit(@Req() request: Request, @Param('id') id: string, @Body() body: unknown, @UploadedFiles() files?: BrandFiles) {
    return editCompany((await requireUser(request)).id, read(positiveId, id), companyInput(body, files));
  }

  @Get(':id/media/:kind')
  async media(@Req() request: Request, @Param('id') id: string, @Param('kind') kind: string, @Res({ passthrough: true }) response: Response) {
    await requireUser(request);
    const file = await companyImage(read(positiveId, id), read(z.enum(['logo','banner']), kind));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.content, { type: file.mime });
  }

  @Post(':id/follow')
  async follow(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { active } = read(z.object({ active: z.boolean() }), body);
    await setFollow(user.id, read(positiveId, id), active);
    return { ok: true };
  }

  @Post(':id/membership')
  async membership(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { join } = read(z.object({ join: z.boolean() }), body);
    await changeCompanyMembership(user, read(positiveId, id), join);
    return { ok: true };
  }

  @Post(':id/members/:member')
  async review(@Req() request: Request, @Param('id') id: string, @Param('member') member: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { action } = read(z.object({ action: z.enum(['approve','decline','promote','demote','transfer','remove']) }), body);
    await decideCompanyMembership(user.id, read(positiveId, id), read(text(128), member), action);
    return { ok: true };
  }

  @Post(':id/updates')
  async update(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const fields = read(z.object({ body: text(3000), notifyEmployees: z.boolean().default(false) }), body);
    await addCompanyUpdate(user.id, read(positiveId, id), fields.body, fields.notifyEmployees);
    return { ok: true };
  }

  @Post(':id/updates/:post')
  async moderate(@Req() request: Request, @Param('id') id: string, @Param('post') post: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { hide } = read(z.object({ hide: z.boolean() }), body);
    await moderateCompanyUpdate(user.id, read(positiveId, id), read(positiveId, post), hide);
    return { ok: true };
  }

  @Post(':id/pages')
  async createPage(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    return saveCompanyPage(user.id, read(positiveId, id), read(pageFields, body));
  }

  @Patch(':id/pages/:page')
  async updatePage(@Req() request: Request, @Param('id') id: string, @Param('page') page: string, @Body() body: unknown) {
    const user = await requireUser(request);
    return saveCompanyPage(user.id, read(positiveId, id), read(pageFields, body), read(positiveId, page));
  }

  @Delete(':id/pages/:page')
  async deletePage(@Req() request: Request, @Param('id') id: string, @Param('page') page: string) {
    const user = await requireUser(request);
    await removeCompanyPage(user.id, read(positiveId, id), read(positiveId, page));
    return { ok: true };
  }
}
