import { Module } from '@nestjs/common';
import { AuthPlatformModule } from '@platform/auth';
import { AppConfigModule } from '@platform/config/app-config.module';
import { PrismaModule } from '@platform/database/prisma.module';
import { HealthModule } from '@platform/health/health.module';
import { IamModule } from '@modules/iam/iam.public';

@Module({
  imports: [AppConfigModule, PrismaModule, AuthPlatformModule, HealthModule, IamModule],
})
export class AppModule {}
