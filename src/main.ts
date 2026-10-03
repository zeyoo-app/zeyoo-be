import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { Env } from './platform/config/env.schema';
import { AllExceptionsFilter } from './platform/http/all-exceptions.filter';
import { patchSwaggerForZod, setupSwagger } from './platform/openapi/setup-swagger';

const API_PREFIX = 'v1';

async function bootstrap(): Promise<void> {
  patchSwaggerForZod();

  // rawBody is required so the Stripe webhook can verify the request signature.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  // The web app calls the API straight from the browser, so cross-origin requests
  // (and their preflights) must be allowed for the configured origins.
  const settings = app.get<ConfigService<Env, true>>(ConfigService);
  const origins = [
    settings.get('APP_WEB_URL', { infer: true }),
    ...settings.get('CORS_ORIGINS', { infer: true }).split(','),
  ]
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter((origin) => origin.length > 0);
  app.enableCors({ origin: origins, credentials: true });

  setupSwagger(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  Logger.log(`Zeyoo API listening on port ${port} (prefix /${API_PREFIX})`, 'Bootstrap');
}

void bootstrap();
