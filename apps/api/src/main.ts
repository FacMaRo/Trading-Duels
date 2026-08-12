import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import {
  getCorsOrigins,
  getHttpCorsOptions,
  isOriginAllowed,
  normalizeOrigin,
} from './common/cors-origins';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Let Nest/cors handle OPTIONS; do not block preflight
    bodyParser: true,
  });
  const config = app.get(ConfigService);

  // ── CORS (HTTP + preflight) ──────────────────────────────────────────────
  // Must run before guards / pipes so OPTIONS never hits JwtAuthGuard.
  const corsOptions = getHttpCorsOptions();
  app.enableCors(corsOptions);

  // Explicit preflight short-circuit: guarantees 204 + ACAO even if a proxy
  // or middleware mishandles Nest's built-in OPTIONS path.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && isOriginAllowed(origin)) {
      const reflected = normalizeOrigin(origin);
      res.setHeader('Access-Control-Allow-Origin', reflected);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Accept, Origin, X-Requested-With',
      );
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Railway sets PORT; fall back to API_PORT / 3001 for local
  const port =
    Number(process.env.PORT) || config.get<number>('API_PORT') || 3001;
  await app.listen(port, '0.0.0.0');

  const origins = getCorsOrigins();
  console.log(`🚀 Trading Duels API → http://0.0.0.0:${port}/api`);
  console.log(`   CORS origins: ${origins.join(', ')}`);
}

bootstrap();
