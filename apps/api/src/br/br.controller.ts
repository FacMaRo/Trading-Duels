import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type JwtPayload } from '@trading-duels/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BrService } from './br.service';
import {
  JoinQueueDto,
  OpenTradeBody,
  UpdateLevelsDto,
} from './br.dto';

@Controller('br')
@UseGuards(JwtAuthGuard)
export class BrController {
  constructor(private readonly br: BrService) {}

  @Post('queue')
  join(@CurrentUser() user: JwtPayload, @Body() dto: JoinQueueDto) {
    return this.br.joinQueue(user.sub, dto.stake, dto.asset, {
      useFreeEntry: !!dto.useFreeEntry,
      useFreeEntryCredit: !!dto.useFreeEntryCredit,
      isDemo: false,
    });
  }

  /** DEMO queue — no stake, no real money */
  @Post('demo/queue')
  joinDemo(
    @CurrentUser() user: JwtPayload,
    @Body() body: { asset: string },
  ) {
    return this.br.joinQueue(user.sub, 0, body.asset, { isDemo: true });
  }

  @Post('queue/leave')
  leave(@CurrentUser() user: JwtPayload) {
    return this.br.leaveQueue(user.sub);
  }

  /** Weekly free-entry status (UTC) */
  @Get('free-entry')
  freeEntry(@CurrentUser() user: JwtPayload) {
    return this.br.getFreeEntryStatus(user.sub);
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.br.getMyActive(user.sub);
  }

  @Get('matches/:id')
  getMatch(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.br.getMatch(id, user.sub);
  }

  @Get('history')
  history(@CurrentUser() user: JwtPayload) {
    return this.br.getHistory(user.sub);
  }

  @Get('stats')
  stats(@CurrentUser() user: JwtPayload) {
    return this.br.getStats(user.sub);
  }

  @Get('matches/:id/chat')
  chatHistory(@Param('id') id: string) {
    return this.br.getChat(id);
  }

  @Post('matches/:id/chat')
  postChat(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { body: string },
  ) {
    return this.br.postChat(id, user.sub, body?.body ?? '');
  }

  @Post('matches/:id/trades')
  openTrade(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: OpenTradeBody,
  ) {
    return this.br.openTrade(id, user.sub, body.trade);
  }

  @Post('matches/:id/trades/:tradeId/close')
  closeTrade(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
  ) {
    return this.br.closeTrade(id, user.sub, tradeId);
  }

  @Post('matches/:id/trades/:tradeId/cancel')
  cancelTrade(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
  ) {
    return this.br.cancelTrade(id, user.sub, tradeId);
  }

  /** Edit SL / TP on open or pending trade */
  @Post('matches/:id/trades/:tradeId/levels')
  updateLevels(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('tradeId') tradeId: string,
    @Body() body: UpdateLevelsDto,
  ) {
    return this.br.updateTradeLevels(id, user.sub, tradeId, {
      stopLoss: body.stopLoss,
      takeProfit: body.takeProfit,
    });
  }

  /** DEMO only: force settlement now */
  @Post('matches/:id/force-end')
  forceEnd(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.br.forceEndDemo(id, user.sub);
  }
}
