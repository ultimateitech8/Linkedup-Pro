import { Body, Controller, Get, Header, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { positiveId, read, requireUser } from './access.js';
import { appOrigin } from './database.js';
import {
  changeAttendance, createEvent, editEvent, hostEvent, inviteToEvent,
  listEvents, moderateEventDiscussion, startEventDiscussion, viewEvent
} from './events.js';

const field = (max: number) => z.string().trim().min(1).max(max);
const eventFields = z.object({
  title: field(100), description: field(3000), category: z.enum(['Meetup', 'Webinar', 'Conference']),
  format: z.enum(['online', 'in-person']), startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }),
  venue: field(220).optional(), meetingUrl: z.url({ protocol: /^https$/ }).max(2048).optional()
});

function calendarText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n|\r/g, '\\n').replace(/[,;]/g, '\\$&');
}

function calendarTime(value: Date) {
  return value.toISOString().replace(/[^0-9TZ]/g, '').replace(/\d{3}Z$/, 'Z');
}

function foldLine(line: string) {
  let output = '';
  let width = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (width + size > 75) {
      output += '\r\n ';
      width = 1;
    }
    output += character;
    width += size;
  }
  return output;
}

@Controller('api/events')
export class EventsController {
  @Get()
  async list(@Req() request: Request) {
    return listEvents((await requireUser(request)).id);
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    return createEvent((await requireUser(request)).id, read(eventFields, body));
  }

  @Get(':id')
  async details(@Req() request: Request, @Param('id') id: string) {
    return viewEvent((await requireUser(request)).id, read(positiveId, id));
  }

  @Patch(':id')
  async edit(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    await editEvent((await requireUser(request)).id, read(positiveId, id), read(eventFields, body));
    return { ok: true };
  }

  @Post(':id/registration')
  async registration(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const member = await requireUser(request);
    const { action } = read(z.object({ action: z.enum(['register', 'withdraw', 'decline', 'check-in']) }), body);
    await changeAttendance(member.id, read(positiveId, id), action);
    return { ok: true };
  }

  @Post(':id/invites')
  async invite(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const member = await requireUser(request);
    const { memberId } = read(z.object({ memberId: field(128) }), body);
    await inviteToEvent(member, read(positiveId, id), memberId);
    return { ok: true };
  }

  @Post(':id/host')
  async host(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const member = await requireUser(request);
    const { action } = read(z.object({ action: z.enum(['cancel', 'start-live', 'end-live']) }), body);
    await hostEvent(member.id, read(positiveId, id), action);
    return { ok: true };
  }

  @Post(':id/posts')
  async post(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) {
    const member = await requireUser(request);
    const { topic, body: content } = read(z.object({ topic: field(140), body: field(3000) }), body);
    return startEventDiscussion(member.id, read(positiveId, id), topic, content);
  }

  @Post(':id/posts/:post')
  async moderate(@Req() request: Request, @Param('id') id: string, @Param('post') post: string, @Body() body: unknown) {
    const member = await requireUser(request);
    const { action } = read(z.object({ action: z.enum(['hide', 'restore']) }), body);
    await moderateEventDiscussion(member.id, read(positiveId, id), read(positiveId, post), action);
    return { ok: true };
  }

  @Get(':id/calendar')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async calendar(@Req() request: Request, @Param('id') value: string, @Res({ passthrough: true }) response: Response) {
    const member = await requireUser(request);
    const id = read(positiveId, value);
    const { event } = await viewEvent(member.id, id);
    response.setHeader('Content-Disposition', `attachment; filename="linkedup-event-${id}.ics"`);
    const url = `${appOrigin}/#events?event=${id}`;
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Linkedup Pro//Events//EN', 'BEGIN:VEVENT',
      `UID:linkedup-event-${id}@${new URL(appOrigin).host}`, `DTSTAMP:${calendarTime(new Date())}`,
      `DTSTART:${calendarTime(event.startsAt)}`, `DTEND:${calendarTime(event.endsAt)}`,
      `SUMMARY:${calendarText(event.title)}`, `DESCRIPTION:${calendarText(event.description)}`,
      `LOCATION:${calendarText(event.venue || 'Online')}`, `URL:${url}`,
      `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR', ''
    ].map(foldLine).join('\r\n');
  }
}
