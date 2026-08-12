import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsNumber, IsString, Min } from 'class-validator';
import type { JwtPayload } from '@trading-duels/shared';
import { SpectatorBetsService } from './spectator-bets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

class CreateBetDto {
  @IsString()
  pickUserId!: string;

  @IsNumber()
  @Min(1)
  amount!: number;
}

@Controller('duels')
@UseGuards(JwtAuthGuard)
export class SpectatorController {
  constructor(private readonly bets: SpectatorBetsService) {}

  /** Listado de apuestas P2P — lectura pública */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':duelId/bets')
  listBets(
    @Param('duelId') duelId: string,
    @CurrentUser() user?: JwtPayload | null,
  ) {
    return this.bets.listBets(duelId, user?.sub);
  }

  @Post(':duelId/bets')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('duelId') duelId: string,
    @Body() dto: CreateBetDto,
  ) {
    return this.bets.createOffer({
      duelId,
      proposerId: user.sub,
      pickUserId: dto.pickUserId,
      amount: dto.amount,
    });
  }

  @Post(':duelId/bets/:betId/accept')
  accept(
    @CurrentUser() user: JwtPayload,
    @Param('duelId') duelId: string,
    @Param('betId') betId: string,
  ) {
    return this.bets.acceptOffer({
      duelId,
      betId,
      acceptorId: user.sub,
    });
  }

  @Post(':duelId/bets/:betId/cancel')
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('duelId') duelId: string,
    @Param('betId') betId: string,
  ) {
    return this.bets.cancelOffer({
      duelId,
      betId,
      userId: user.sub,
    });
  }
}
