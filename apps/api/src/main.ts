import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import type { NextFunction, Request, Response } from 'express';
import { PlatformController } from './platform.js';
import { GroupsController } from './groups-controller.js';
import { EventsController } from './events-controller.js';
import { PublicationsController } from './publications-controller.js';
import { CompaniesController } from './companies-controller.js';
import { LearningController } from './learning-controller.js';
import { ServicesController } from './services-controller.js';
import { SalesController } from './sales-controller.js';
import { AdvertisingController } from './advertising-controller.js';
import { AnalyticsController } from './analytics-controller.js';
import { AiController } from './ai-controller.js';
import { auth, demoMode, migrate } from './database.js';
import { startEventReminders } from './events.js';
import { attachRealtime } from './realtime.js';
import { startSalesAlerts } from './sales-alerts.js';
import { seed } from './seed.js';

@Module({
  controllers: [PlatformController, GroupsController, EventsController, PublicationsController, CompaniesController,
    LearningController, ServicesController, SalesController, AdvertisingController, AnalyticsController, AiController]
})
class PlatformModule {}

async function main() {
  await migrate();
  if (demoMode) await seed();
  const app = await NestFactory.create(PlatformModule);
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  express.use('/api', (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  express.all('/api/auth/{*path}', toNodeHandler(auth));
  attachRealtime(app.getHttpServer());
  await app.listen(Number(process.env.API_PORT ?? 4000), '0.0.0.0');
  startEventReminders();
  startSalesAlerts();
}
main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
