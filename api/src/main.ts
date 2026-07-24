import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS_ORIGIN may list multiple allowed origins (comma-separated), e.g. the
  // canonical and trial Cloud Foundry routes.
  const corsOrigin = config.get<string>('corsOrigin') ?? '';
  const allowedOrigins = corsOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length > 1 ? allowedOrigins : (allowedOrigins[0] ?? corsOrigin),
    credentials: true,
  });

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
}
bootstrap();
