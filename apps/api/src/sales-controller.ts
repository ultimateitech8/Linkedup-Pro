import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { positiveId, read, requireUser } from './access.js';
import { accountFilters, leadFilters, searchSalesAccounts, searchSalesLeads } from './sales-search.js';
import {
  exportSalesCsv, leadUpdate, listName, removeSalesList, salesWorkspace, saveSalesList,
  setSalesListItem, setSavedAccount, setSavedLead, updateSavedLead, watchSavedAccount
} from './sales.js';

const person = z.string().trim().min(1).max(128);
const toggle = z.object({ active: z.boolean() });

@Controller('api/sales')
export class SalesController {
  @Get('leads')
  async leads(@Req() request: Request, @Query() filters: unknown) {
    return searchSalesLeads((await requireUser(request)).id, read(leadFilters, filters));
  }

  @Get('accounts')
  async accounts(@Req() request: Request, @Query() filters: unknown) {
    return searchSalesAccounts((await requireUser(request)).id, read(accountFilters, filters));
  }

  @Get('workspace')
  async workspace(@Req() request: Request) {
    return salesWorkspace((await requireUser(request)).id);
  }

  @Put('leads/:id')
  async saveLead(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return setSavedLead((await requireUser(request)).id, read(person, id), read(toggle, body).active);
  }

  @Patch('leads/:id')
  async updateLead(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return updateSavedLead((await requireUser(request)).id, read(person, id), read(leadUpdate, body));
  }

  @Put('accounts/:id')
  async saveAccount(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return setSavedAccount((await requireUser(request)).id, read(positiveId, id), read(toggle, body).active);
  }

  @Patch('accounts/:id')
  async watchAccount(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return watchSavedAccount((await requireUser(request)).id, read(positiveId, id), read(toggle, body).active);
  }

  @Post('lists')
  async createList(@Req() request: Request, @Body() body: unknown) {
    return saveSalesList((await requireUser(request)).id, read(listName, body).name);
  }

  @Patch('lists/:id')
  async updateList(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    return saveSalesList((await requireUser(request)).id, read(listName, body).name, read(positiveId, id));
  }

  @Delete('lists/:id')
  async deleteList(@Req() request: Request, @Param('id') id: string) {
    return removeSalesList((await requireUser(request)).id, read(positiveId, id));
  }

  @Put('lists/:id/leads/:lead')
  async listLead(@Req() request: Request, @Param('id') id: string, @Param('lead') lead: string, @Body() body: unknown) {
    return setSalesListItem((await requireUser(request)).id, read(positiveId, id), 'lead', read(person, lead), read(toggle, body).active);
  }

  @Put('lists/:id/accounts/:account')
  async listAccount(@Req() request: Request, @Param('id') id: string, @Param('account') account: string, @Body() body: unknown) {
    return setSalesListItem((await requireUser(request)).id, read(positiveId, id), 'account', read(positiveId, account), read(toggle, body).active);
  }

  @Get('export')
  async export(@Req() request: Request, @Query('list') raw: unknown, @Res() response: Response) {
    const user = await requireUser(request);
    const id = read(positiveId.optional(), raw);
    const csv = await exportSalesCsv(user.id, id);
    response.setHeader('Content-Disposition', `attachment; filename="linkedup-sales${id ? '-list-' + id : ''}.csv"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type('text/csv').send(csv);
  }
}
