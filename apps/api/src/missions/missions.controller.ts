import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { JwtPayload, MissionTypeId } from '@trading-duels/shared';
import { MissionsService } from './missions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

class ClaimDto {
  @IsIn(['DAILY_WINS_6', 'WEEKLY_WINS_18', 'STREAK_5', 'MONTHLY_WINS_35'])
  missionType!: MissionTypeId;
}

@Controller('missions')
export class MissionsController {
  constructor(private readonly missions: MissionsService) {}

  /**
   * Catálogo + progreso.
   * - Con sesión: progreso real del usuario
   * - Sin sesión: catálogo público (canClaim = false)
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  overview(@CurrentUser() user?: JwtPayload | null) {
    if (user?.sub) return this.missions.getOverview(user.sub);
    return this.missions.getPublicOverview();
  }

  /** Estado del pozo y presupuesto diario de misiones pequeñas */
  @Public()
  @Get('pool')
  pool() {
    return this.missions.getPoolStatus();
  }

  @UseGuards(JwtAuthGuard)
  @Post('claim')
  claim(@CurrentUser() user: JwtPayload, @Body() dto: ClaimDto) {
    return this.missions.claim(user.sub, dto.missionType);
  }
}
