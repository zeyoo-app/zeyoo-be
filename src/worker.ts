import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Background-job entrypoint. Shares the application's dependency-injection
// context; BullMQ processors are registered by the modules that own them.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log('Zeyoo worker started', 'Worker');
}

void bootstrap();
