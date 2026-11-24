import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { positiveId, read, requireUser } from './access.js';
import { aiRequest, generateAi } from './ai.js';
import { aiAvailability } from './ai-provider.js';
import { jobSkillReport } from './job-skills.js';

@Controller('api/ai')
export class AiController {
  @Get('status')
  async status(@Req() request: Request) {
    return aiAvailability((await requireUser(request)).id);
  }

  @Get('jobs/:id/fit')
  async fit(@Req() request: Request, @Param('id') id: string) {
    return jobSkillReport((await requireUser(request)).id, read(positiveId, id));
  }

  @Post('generate')
  async generate(@Req() request: Request, @Body() body: unknown) {
    const user = await requireUser(request);
    return generateAi(user.id, read(aiRequest, body));
  }
}
