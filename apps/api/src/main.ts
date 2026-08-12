import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { getCorsOrigins } from './common/cors-origins';

const RAILWAY_WEB_ORIGIN = 'https://web-production-38a05.up.railway.app';

/**
 * Hard CORS middleware — runs on raw Express BEFORE Nest routes/guards.
 * Always reflects Origin (or falls back to production web origin).
 * OPTIONS → 204 immediately.
 */
function hardCorsMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestOrigin =
    typeof req.headers.origin === 'string' && req.headers.origin.length > 0
      ? req.headers.origin
      : RAILWAY_WEB_ORIGIN;

  // Reflect request Origin so browser accepts credentialed or non-credentialed calls
  res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept, Origin, X-Requested-With',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');

  // Brief debug log (production + local) — confirm preflight hits the API
  console.log(
    `[cors] ${req.method} ${req.originalUrl || req.url} origin=${req.headers.origin ?? '(none)'} → ACAO=${requestOrigin}`,
  );

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: true,
  });

  // 1) FIRST middleware on raw Express — before Nest routing
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(hardCorsMiddleware);

  // 2) Nest enableCors: reflect any Origin (unblock demo); credentials true
  //    Allowlist kept for logging only — do not reject Railway web.
  app.enableCors({
    origin: true, // reflect request Origin
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
    optionsSuccessStatus: 204,
    preflightContinue: false,
    maxAge: 86400,
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

  // Railway public networking injects PORT — must bind that port on 0.0.0.0
  const port = Number(process.env.PORT) || 8080;
  await app.listen(port, '0.0.0.0');

  console.log(`API listening on 0.0.0.0:${port}`);
  console.log(
    `   CORS: origin:true (reflect) · hard OPTIONS middleware · known origins: ${getCorsOrigins().join(', ')}`,
  );
}

bootstrap();
