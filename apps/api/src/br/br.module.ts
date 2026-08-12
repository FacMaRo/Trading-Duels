import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BrService } from './br.service';
import { BrController } from './br.controller';
import { BrGateway } from './br.gateway';
import { WalletModule } from '../wallet/wallet.module';
import { MarketModule } from '../market/market.module';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [
    WalletModule,
    MarketModule,
    ReferralsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'dev-secret-change-me',
      }),
    }),
  ],
  controllers: [BrController],
  providers: [BrService, BrGateway],
  exports: [BrService],
})
export class BrModule {}
