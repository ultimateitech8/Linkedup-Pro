import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { positiveId, read, requireUser } from './access.js';
import { campaignAnalytics, companyAnalytics, hiringAnalytics, personalAnalytics, type AnalyticsDays } from './analytics.js';
import { recordPostImpression, recordProfileView, recordSearchAppearances } from './analytics-events.js';

const id = z.string().trim().min(1).max(128);
const searchInput = z.object({ query: z.string().trim().min(1).max(240), results: z.array(id).min(1).max(3) });
const period = z.enum(['7', '30', '90']).default('30').transform((value) => Number(value) as AnalyticsDays);

@Controller('api/analytics')
export class AnalyticsController {
  @Get('personal')
  async personal(@Req() request: Request, @Query('days') days: unknown) {
    return personalAnalytics((await requireUser(request)).id, read(period, days));
  }

  @Get('companies')
  async companies(@Req() request: Request, @Query('days') days: unknown) {
    return companyAnalytics((await requireUser(request)).id, read(period, days));
  }

  @Get('hiring')
  async hiring(@Req() request: Request, @Query('days') days: unknown) {
    return hiringAnalytics((await requireUser(request)).id, read(period, days));
  }

  @Get('campaigns')
  async campaigns(@Req() request: Request, @Query('days') days: unknown) {
    return campaignAnalytics((await requireUser(request)).id, read(period, days));
  }

  @Post('events/profile')
  async profile(@Req() request: Request, @Body('id') target: unknown) {
    await recordProfileView((await requireUser(request)).id, read(id, target));
    return { ok: true };
  }

  @Post('events/search')
  async search(@Req() request: Request, @Body() payload: unknown) {
    const viewer = await requireUser(request);
    const fields = read(searchInput, payload);
    await recordSearchAppearances(viewer.id, fields.query, fields.results);
    return { ok: true };
  }

  @Post('events/post')
  async post(@Req() request: Request, @Body('id') postId: unknown) {
    await recordPostImpression((await requireUser(request)).id, read(positiveId, postId));
    return { ok: true };
  }
}
