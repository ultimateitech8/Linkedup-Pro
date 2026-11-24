import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { positiveId, read, requireUser } from './access.js';
import {
  bookmarkCourse, certificateDetail, certificateVisibility, completeLesson, courseDetail, courseInput, enroll,
  learningCatalog, pathInput, publishCourse, publishPath, saveCourse, searchCourses, visibleCertificates
} from './learning.js';

const toggle = z.object({ active: z.boolean() });
const answer = z.object({ answer: z.number().int().min(0).max(2).optional() });

@Controller('api/learning')
export class LearningController {
  @Get('catalog')
  async catalog(@Req() request: Request) {
    return learningCatalog(await requireUser(request));
  }

  @Get('search')
  async search(@Req() request: Request, @Query('q') query: unknown) {
    await requireUser(request);
    return searchCourses(read(z.string().trim().max(120).default(''), query));
  }

  @Get('courses/:id')
  async course(@Req() request: Request, @Param('id') id: string) {
    return courseDetail(await requireUser(request), read(positiveId, id));
  }

  @Post('courses')
  async draft(@Req() request: Request, @Body() body: unknown) {
    return saveCourse(await requireUser(request), read(courseInput, body));
  }

  @Patch('courses/:id')
  async edit(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return saveCourse(await requireUser(request), read(courseInput, body), read(positiveId, id));
  }

  @Post('courses/:id/publish')
  async publish(@Req() request: Request, @Param('id') id: string) {
    return publishCourse(await requireUser(request), read(positiveId, id));
  }

  @Post('paths')
  async path(@Req() request: Request, @Body() body: unknown) {
    return publishPath(await requireUser(request), read(pathInput, body));
  }

  @Post('courses/:id/enroll')
  async join(@Req() request: Request, @Param('id') id: string) {
    const user = await requireUser(request);
    return enroll(user.id, read(positiveId, id));
  }

  @Post('courses/:id/bookmark')
  async bookmark(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    return bookmarkCourse(user.id, read(positiveId, id), read(toggle, body).active);
  }

  @Post('courses/:id/lessons/:number/complete')
  async complete(@Req() request: Request, @Param('id') id: string, @Param('number') number: string, @Body() body: unknown) {
    const user = await requireUser(request);
    return completeLesson(user.id, read(positiveId, id), read(positiveId, number), read(answer, body).answer);
  }

  @Get('certificates/profile/:profile')
  async profile(@Req() request: Request, @Param('profile') profile: string) {
    await requireUser(request);
    return visibleCertificates(read(z.string().min(1).max(128), profile));
  }

  @Get('certificates/:id')
  async certificate(@Req() request: Request, @Param('id') id: string) {
    const user = await requireUser(request);
    return certificateDetail(user.id, read(z.uuid(), id));
  }

  @Patch('certificates/:id')
  async visibility(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await requireUser(request);
    return certificateVisibility(user.id, read(z.uuid(), id), read(toggle, body).active);
  }
}
