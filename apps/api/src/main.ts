import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { getCorsOrigins } from './common/cors-origins';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const origins = getCorsOrigins();
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  // Railway sets PORT; fall back to API_PORT / 3001 for local
  const port =
    Number(process.env.PORT) ||
    config.get<number>('API_PORT') ||
    3001;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Trading Duels API → http://0.0.0.0:${port}/api`);
  console.log(`   CORS origins: ${origins.join(', ')}`);
}

bootstrap();
