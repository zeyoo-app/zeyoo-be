import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { patchNestJsSwagger, ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { Env } from './platform/config/env.schema';
import { AllExceptionsFilter } from './platform/http/all-exceptions.filter';
import { setupSwagger } from './platform/openapi/setup-swagger';

const API_PREFIX = 'v1';

async function bootstrap(): Promise<void> {
  patchNestJsSwagger();

  // rawBody is required so the Stripe webhook can verify the request signature.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  setupSwagger(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  Logger.log(`Zeyoo API listening on port ${port} (prefix /${API_PREFIX})`, 'Bootstrap');
}

void bootstrap();
