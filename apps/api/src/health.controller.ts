import { Controller, Get } from '@nestjs/common';

/**
 * Health check for Railway / load balancers.
 * Global prefix is `api` → public path is GET /api/health (not /api/api/health).
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { ok: true };
  }
}
