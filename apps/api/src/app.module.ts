import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { MarketModule } from './market/market.module';
import { MissionsModule } from './missions/missions.module';
import { BrModule } from './br/br.module';
import { ReferralsModule } from './referrals/referrals.module';
import { HealthController } from './health.controller';

/**
 * Producto actual: Battle Royale only.
 * Módulos 1v1 (duels/matchmaking/spectator) desactivados del bootstrap.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    WalletModule,
    MarketModule,
    MissionsModule,
    BrModule,
    ReferralsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
