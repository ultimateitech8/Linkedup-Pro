import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { positiveId, read, requireUser } from './access.js';
import { changeMembership, createGroup, listGroups, moderateDiscussion, reviewMember, startDiscussion, viewGroup } from './groups.js';

const field = (max: number) => z.string().trim().min(1).max(max);
const createFields = z.object({ name: field(80), description: field(700), industry: field(60), visibility: z.enum(['public', 'private']) });

@Controller('api/groups')
export class GroupsController {
  @Get()
  async list(@Req() request: Request) {
    return listGroups((await requireUser(request)).id);
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    return createGroup((await requireUser(request)).id, read(createFields, body));
  }

  @Get(':id')
  async details(@Req() request: Request, @Param('id') id: string) {
    return viewGroup((await requireUser(request)).id, read(positiveId, id));
  }

  @Post(':id/membership')
  async membership(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { action } = read(z.object({ action: z.enum(['join', 'leave']) }), body);
    await changeMembership(user, read(positiveId, id), action);
    return { ok: true };
  }

  @Post(':id/members/:member')
  async members(@Req() request: Request, @Param('id') id: string, @Param('member') member: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { action } = read(z.object({ action: z.enum(['invite', 'approve', 'decline', 'promote', 'demote', 'transfer', 'remove']) }), body);
    await reviewMember(user, read(positiveId, id), read(field(128), member), action);
    return { ok: true };
  }

  @Post(':id/posts')
  async post(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { topic, body: content } = read(z.object({ topic: field(140), body: field(3000) }), body);
    return startDiscussion(user.id, read(positiveId, id), topic, content);
  }

  @Post(':id/posts/:post')
  async moderate(@Req() request: Request, @Param('id') id: string, @Param('post') post: string, @Body() body: unknown) {
    const user = await requireUser(request);
    const { action } = read(z.object({ action: z.enum(['hide', 'restore']) }), body);
    await moderateDiscussion(user.id, read(positiveId, id), read(positiveId, post), action);
    return { ok: true };
  }
}
