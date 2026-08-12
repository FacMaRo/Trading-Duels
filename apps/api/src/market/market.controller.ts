import { Controller, Get, Param, Query } from '@nestjs/common';
import { MarketService } from './market.service';
import { Public } from '../common/decorators/public.decorator';
import { ALL_ASSETS, type AssetSymbol } from '@trading-duels/shared';

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Public()
  @Get('assets')
  listAssets() {
    return { assets: ALL_ASSETS };
  }

  @Public()
  @Get('status')
  status() {
    return this.market.getStatus();
  }

  /** Precios y velas públicos (gráficos para visitantes / espectadores) */
  @Public()
  @Get('prices')
  prices() {
    return this.market.getAllTicks();
  }

  @Public()
  @Get('prices/:asset')
  price(@Param('asset') asset: string) {
    return this.market.getTick(asset as AssetSymbol);
  }

  @Public()
  @Get('candles/:asset')
  async candles(
    @Param('asset') asset: string,
    @Query('tf') tf = '1m',
    @Query('count') count = '120',
  ) {
    return this.market.getCandles(
      asset as AssetSymbol,
      tf,
      Math.min(parseInt(count, 10) || 120, 500),
    );
  }
}
