import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { patchNestJsSwagger } from 'nestjs-zod';

export const OPENAPI_PATH = 'docs';

// nestjs-zod enriches the spec with Zod DTO schemas, but its patch depends on
// @nestjs/swagger internals that some versions no longer expose. The spec still
// generates without it, so a failure here must not stop the app from booting.
export function patchSwaggerForZod(): void {
  try {
    patchNestJsSwagger();
  } catch {
    Logger.warn('Zod OpenAPI patch unavailable; request schemas will be less detailed.', 'OpenAPI');
  }
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Zeyoo API')
    .setDescription('Zeyoo backend public and internal API.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(OPENAPI_PATH, app, buildOpenApiDocument(app));
}
