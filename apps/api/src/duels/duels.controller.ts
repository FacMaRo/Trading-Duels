import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { JwtPayload, TradeInput } from '@trading-duels/shared';
import { ALL_ASSETS } from '@trading-duels/shared';
import { DuelsService } from './duels.service';
import { SpectatorBetsService } from '../spectator/spectator-bets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

class TradeDto implements TradeInput {
  @IsString()
  asset!: (typeof ALL_ASSETS)[number];

  @IsEnum(['LONG', 'SHORT'] as const)
  side!: 'LONG' | 'SHORT';

  @IsEnum(['MARKET', 'LIMIT'] as const)
  orderType!: 'MARKET' | 'LIMIT';

  @IsOptional()
  @IsNumber()
  entryPrice?: number;

  @IsNumber()
  stopLoss!: number;

  @IsOptional()
  @IsNumber()
  takeProfit?: number | null;

  @IsNumber()
  @Min(0.01)
  riskPct!: number;
}

class OpenTradeBody {
  @ValidateNested()
  @Type(() => TradeDto)
  trade!: TradeDto;
}

class RaiseBody {
  @IsNumber()
  @Min(0.01)
  newStake!: number;
}

class RaiseRespondBody {
  @IsEnum(['ACCEPT', 'REJECT', 'RE_RAISE'] as const)
  action!: 'ACCEPT' | 'REJECT' | 'RE_RAISE';

  @IsOptional()
  @IsNumber()
  newStake?: number;
}

@Controller('duels')
@UseGuards(JwtAuthGuard)
export class DuelsController {
  constructor(
    private readonly duels: DuelsService,
    private readonly spectatorBets: SpectatorBetsService,
  ) {}

  @Get()
  listMine(@CurrentUser() user: JwtPayload) {
    return this.duels.listMyDuels(user.sub);
  }

  /** Duelos en vivo (público, lectura) — debe declararse antes de :id */
  @Public()
  @Get('live')
  listLive() {
    return this.spectatorBets.listLiveDuels();
  }

  /** Snapshot para jugador, espectador autenticado o visitante anónimo */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async getOne(
    @Param('id') id: string,
    @CurrentUser() user?: JwtPayload | null,
  ) {
    return this.duels.getSpectatorOrPlayerSnapshot(id, user?.sub ?? null);
  }

  @Post(':id/ready')
  async ready(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const duel = await this.duels.markReady(id, user.sub);
    return this.duels.toSnapshot(duel);
  }

  @Post(':id/trades')
  openTrade(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: OpenTradeBody,
  ) {
    return this.duels.openTrade(id, user.sub, body.trade);
  }

  @Post(':id/trades/:tradeId/close')
  closeTrade(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
  ) {
    return this.duels.closeTrade(id, user.sub, tradeId);
  }

  @Post(':id/trades/:tradeId/cancel')
  cancelTrade(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
  ) {
    return this.duels.cancelTrade(id, user.sub, tradeId);
  }

  @Post(':id/raises')
  proposeRaise(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: RaiseBody,
  ) {
    return this.duels.proposeRaise(id, user.sub, body.newStake);
  }

  @Post(':id/raises/:raiseId/respond')
  respondRaise(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('raiseId') raiseId: string,
    @Body() body: RaiseRespondBody,
  ) {
    return this.duels.respondRaise(
      id,
      user.sub,
      raiseId,
      body.action,
      body.newStake,
    );
  }
}
