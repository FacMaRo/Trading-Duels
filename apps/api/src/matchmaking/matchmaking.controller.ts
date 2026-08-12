import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsEnum, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ALL_ASSETS, type JwtPayload } from '@trading-duels/shared';
import { MatchmakingService } from './matchmaking.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

class QueueDto {
  @IsEnum(['BLITZ', 'NORMAL', 'SLOW'] as const)
  mode!: 'BLITZ' | 'NORMAL' | 'SLOW';

  @IsNumber()
  @Min(1)
  stake!: number;

  @IsString()
  @IsIn([...ALL_ASSETS])
  asset!: string;

  @IsOptional()
  @IsEnum(['TOKYO', 'LONDON', 'NY'] as const)
  sessionWindow?: 'TOKYO' | 'LONDON' | 'NY';
}

class ChallengeDto {
  @IsEnum(['BLITZ', 'NORMAL', 'SLOW'] as const)
  mode!: 'BLITZ' | 'NORMAL' | 'SLOW';

  @IsString()
  @IsIn([...ALL_ASSETS])
  asset!: string;

  @IsNumber()
  @Min(1)
  stake!: number;

  @IsOptional()
  @IsEnum(['TOKYO', 'LONDON', 'NY'] as const)
  sessionWindow?: 'TOKYO' | 'LONDON' | 'NY';
}

@Controller('matchmaking')
@UseGuards(JwtAuthGuard)
export class MatchmakingController {
  constructor(private readonly matchmaking: MatchmakingService) {}

  @Post('queue')
  join(@CurrentUser() user: JwtPayload, @Body() dto: QueueDto) {
    return this.matchmaking.joinQueue({
      userId: user.sub,
      mode: dto.mode,
      stake: dto.stake,
      asset: dto.asset,
      sessionWindow: dto.sessionWindow,
    });
  }

  @Post('queue/leave')
  leave(@CurrentUser() user: JwtPayload) {
    return this.matchmaking.leaveQueue(user.sub);
  }

  /** Lista de desafíos abiertos — pública (isMine solo si hay sesión) */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('challenges')
  listChallenges(@CurrentUser() user?: JwtPayload | null) {
    return this.matchmaking.listChallenges(user?.sub);
  }

  @Post('challenges')
  createChallenge(@CurrentUser() user: JwtPayload, @Body() dto: ChallengeDto) {
    return this.matchmaking.createChallenge({
      userId: user.sub,
      mode: dto.mode,
      asset: dto.asset,
      stake: dto.stake,
      sessionWindow: dto.sessionWindow,
    });
  }

  @Post('challenges/:id/accept')
  accept(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.matchmaking.acceptChallenge(id, user.sub);
  }

  @Post('challenges/:id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.matchmaking.cancelChallenge(id, user.sub);
  }
}
