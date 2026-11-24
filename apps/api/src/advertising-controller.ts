import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, StreamableFile,
  UploadedFile, UseGuards, UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { MemberUploadGuard, positiveId, read, requireUser } from './access.js';
import {
  adCampaignImage, adCampaignLeads, adCampaignReport, adSourcePosts, advertisingWorkspace,
  campaignAction, campaignInput, changeAdCampaign, deleteAdDraft, saveAdCampaign
} from './advertising.js';
import { claimFeedAd, clickFeedAd, deliveredAdImage, submitAdLead } from './ad-delivery.js';
import { coverMaxBytes, validateCover, type Cover, type CoverUpload } from './publication-cover.js';

const creativeUpload = FileInterceptor('image', { limits: { fileSize: coverMaxBytes + 1, fieldSize: 24000, fields: 1, files: 1, parts: 3 } });
const uuid = z.uuid();
const leadConsent = z.object({ consent: z.literal(true), message: z.string().trim().max(500).default('') });

function parseCampaign(payload: unknown) {
  if (typeof payload !== 'string') throw new BadRequestException('Campaign details are required.');
  let parsed: unknown;
  try { parsed = JSON.parse(payload); }
  catch { throw new BadRequestException('The campaign details could not be read.'); }
  return read(campaignInput, parsed);
}

function creativeFile(file: Cover, response: Response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return new StreamableFile(file.content, { type: file.mime });
}

@Controller('api/advertising')
export class AdvertisingController {
  @Get('workspace')
  async workspace(@Req() request: Request) {
    return advertisingWorkspace((await requireUser(request)).id);
  }

  @Get('companies/:id/posts')
  async posts(@Req() request: Request, @Param('id') id: string) {
    return adSourcePosts((await requireUser(request)).id, read(positiveId, id));
  }

  @Post('campaigns')
  @UseGuards(MemberUploadGuard)
  @UseInterceptors(creativeUpload)
  async create(@Req() request: Request, @Body('payload') payload: unknown, @UploadedFile() file?: CoverUpload) {
    return saveAdCampaign((await requireUser(request)).id, parseCampaign(payload), validateCover(file));
  }

  @Patch('campaigns/:id')
  @UseGuards(MemberUploadGuard)
  @UseInterceptors(creativeUpload)
  async edit(@Req() request: Request, @Param('id') id: string, @Body('payload') payload: unknown, @UploadedFile() file?: CoverUpload) {
    return saveAdCampaign((await requireUser(request)).id, parseCampaign(payload), validateCover(file), read(positiveId, id));
  }

  @Get('campaigns/:id')
  async report(@Req() request: Request, @Param('id') id: string) {
    return adCampaignReport((await requireUser(request)).id, read(positiveId, id));
  }

  @Get('campaigns/:id/leads')
  async leads(@Req() request: Request, @Param('id') id: string, @Query('offset') offset: unknown) {
    return adCampaignLeads((await requireUser(request)).id, read(positiveId, id), read(z.coerce.number().int().min(0).max(1000000).default(0), offset));
  }

  @Get('campaigns/:id/image')
  async image(@Req() request: Request, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    return creativeFile(await adCampaignImage((await requireUser(request)).id, read(positiveId, id)), response);
  }

  @Post('campaigns/:id/state')
  async state(@Req() request: Request, @Param('id') id: string, @Body('action') action: unknown) {
    return changeAdCampaign((await requireUser(request)).id, read(positiveId, id), read(campaignAction, action));
  }

  @Delete('campaigns/:id')
  async discard(@Req() request: Request, @Param('id') id: string) {
    return deleteAdDraft((await requireUser(request)).id, read(positiveId, id));
  }

  @Post('feed/claim')
  async claim(@Req() request: Request) {
    return claimFeedAd((await requireUser(request)).id);
  }

  @Get('deliveries/:id/image')
  async deliveryImage(@Req() request: Request, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    return creativeFile(await deliveredAdImage((await requireUser(request)).id, read(uuid, id)), response);
  }

  @Post('deliveries/:id/click')
  async click(@Req() request: Request, @Param('id') id: string) {
    return clickFeedAd((await requireUser(request)).id, read(uuid, id));
  }

  @Post('deliveries/:id/lead')
  async lead(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    return submitAdLead(user, read(uuid, id), read(leadConsent, body).message);
  }
}
