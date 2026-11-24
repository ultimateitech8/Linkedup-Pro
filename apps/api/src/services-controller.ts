import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { positiveId, read, requireUser } from './access.js';
import { directoryInput, memberServicePage, offeringInput, providerDetail, providerInput, saveOffering, saveProvider, serviceDirectory, serviceSearch } from './services.js';
import {
  createServiceRequest, decideService, decisionInput, listServiceRequests, messageInput, messageService, newRequestInput,
  quoteInput, quoteService, reviewInput, reviewService, serviceRequestDetail
} from './service-requests.js';

@Controller('api/services')
export class ServicesController {
  @Get('directory')
  async directory(@Req() request: Request, @Query() query: unknown) {
    await requireUser(request);
    return serviceDirectory(read(directoryInput, query));
  }

  @Get('search')
  async search(@Req() request: Request, @Query('q') query: unknown) {
    await requireUser(request);
    return serviceSearch(read(z.string().trim().max(120).default(''), query));
  }

  @Get('member/:member')
  async member(@Req() request: Request, @Param('member') member: string) {
    await requireUser(request);
    return { provider: await memberServicePage(read(z.string().min(1).max(128), member)) };
  }

  @Get('providers/:id')
  async provider(@Req() request: Request, @Param('id') id: string) {
    return providerDetail((await requireUser(request)).id, read(positiveId, id));
  }

  @Get('manage')
  async manage(@Req() request: Request) {
    return { provider: await providerDetail((await requireUser(request)).id) };
  }

  @Put('manage')
  async savePage(@Req() request: Request, @Body() body: unknown) {
    return saveProvider((await requireUser(request)).id, read(providerInput, body));
  }

  @Post('listings')
  async listing(@Req() request: Request, @Body() body: unknown) {
    return saveOffering((await requireUser(request)).id, read(offeringInput, body));
  }

  @Patch('listings/:id')
  async editListing(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return saveOffering((await requireUser(request)).id, read(offeringInput, body), read(positiveId, id));
  }

  @Get('requests')
  async requests(@Req() request: Request) {
    return listServiceRequests((await requireUser(request)).id);
  }

  @Get('requests/:id')
  async request(@Req() request: Request, @Param('id') id: string) {
    return serviceRequestDetail((await requireUser(request)).id, read(positiveId, id));
  }

  @Post('providers/:id/requests')
  async openRequest(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return createServiceRequest(await requireUser(request), read(positiveId, id), read(newRequestInput, body));
  }

  @Post('requests/:id/proposal')
  async quote(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return quoteService(await requireUser(request), read(positiveId, id), read(quoteInput, body));
  }

  @Post('requests/:id/decision')
  async decide(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return decideService(await requireUser(request), read(positiveId, id), read(decisionInput, body));
  }

  @Post('requests/:id/messages')
  async message(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return messageService(await requireUser(request), read(positiveId, id), read(messageInput, body).body);
  }

  @Post('requests/:id/review')
  async review(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return reviewService(await requireUser(request), read(positiveId, id), read(reviewInput, body));
  }
}
