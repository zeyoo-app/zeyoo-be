import { NestFactory } from '@nestjs/core';
import { patchNestJsSwagger } from 'nestjs-zod';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/platform/openapi/setup-swagger';

const OUTPUT_FILE = join(process.cwd(), 'openapi.json');

// Boots the app without a network listener purely to emit the OpenAPI spec,
// which is committed and consumed by the web/mobile client-SDK generators.
async function exportSpec(): Promise<void> {
  patchNestJsSwagger();
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = buildOpenApiDocument(app);
  writeFileSync(OUTPUT_FILE, JSON.stringify(document, null, 2));
  await app.close();
  console.log(`OpenAPI spec written to ${OUTPUT_FILE}`);
}

void exportSpec();
