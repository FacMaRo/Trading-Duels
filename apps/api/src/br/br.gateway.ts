import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type { JwtPayload } from '@trading-duels/shared';
import { ALL_ASSETS, type AssetSymbol } from '@trading-duels/shared';
import { BrService } from './br.service';
import { MarketService } from '../market/market.service';

type AppSocket = Socket & {
  data: {
    user?: JwtPayload;
    marketAssets?: Set<string>;
  };
};

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  },
  namespace: '/br',
})
export class BrGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(BrGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly br: BrService,
    private readonly market: MarketService,
  ) {}

  afterInit() {
    this.br.setEmitters(
      (matchId, event, payload) => {
        this.server.to(`br:${matchId}`).emit(event, payload);
      },
      (event, payload) => {
        this.server.emit(event, payload);
        // Also user-specific start
        if (
          event === 'br:you_started' &&
          payload &&
          typeof payload === 'object' &&
          'userId' in payload
        ) {
          const p = payload as { userId: string; matchId: string };
          this.server.to(`user:${p.userId}`).emit('br:you_started', p);
        }
      },
    );

    this.market.subscribe((asset, tick) => {
      this.server.to(`price:${asset}`).emit('price:tick', {
        asset,
        bid: tick.bid,
        ask: tick.ask,
        mid: tick.mid,
        ts: tick.ts,
      });
    });

    this.logger.log('BrGateway initialized');
  }

  async handleConnection(client: AppSocket) {
    client.data.marketAssets = new Set();
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers.authorization?.replace('Bearer ', '') ?? '');
      if (!token) return;
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      client.data.user = payload;
      await client.join(`user:${payload.sub}`);
    } catch {
      /* guest ok for prices */
    }
  }

  @SubscribeMessage('br:subscribe')
  async onSubscribe(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { matchId: string },
  ) {
    if (!body?.matchId) return;
    await client.join(`br:${body.matchId}`);
    const userId = client.data.user?.sub;
    try {
      const snap = await this.br.getMatch(body.matchId, userId);
      client.emit('br:state', snap);
      if (snap.asset) {
        await this.subscribePrice(client, snap.asset);
      }
    } catch (err) {
      client.emit('br:error', {
        message: err instanceof Error ? err.message : 'Error',
      });
    }
  }

  @SubscribeMessage('br:unsubscribe')
  async onUnsubscribe(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { matchId: string },
  ) {
    if (body?.matchId) await client.leave(`br:${body.matchId}`);
  }

  @SubscribeMessage('market:subscribe')
  async onMarketSubscribe(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { asset: string },
  ) {
    const asset = body?.asset?.toUpperCase();
    if (!asset || !(ALL_ASSETS as readonly string[]).includes(asset)) return;
    await this.subscribePrice(client, asset);
  }

  @SubscribeMessage('br:chat_history')
  async onChatHistory(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { matchId: string },
  ) {
    if (!body?.matchId) return;
    try {
      const msgs = await this.br.getChat(body.matchId);
      client.emit('br:chat_history', { matchId: body.matchId, messages: msgs });
    } catch (err) {
      client.emit('br:error', {
        message: err instanceof Error ? err.message : 'Error chat',
      });
    }
  }

  @SubscribeMessage('br:chat_send')
  async onChatSend(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { matchId: string; body: string },
  ) {
    const user = client.data.user;
    if (!user) {
      client.emit('br:error', { message: 'Iniciá sesión para chatear' });
      return;
    }
    try {
      await this.br.postChat(body.matchId, user.sub, body.body);
      // broadcast ya en service via emit
    } catch (err) {
      client.emit('br:error', {
        message: err instanceof Error ? err.message : 'Error al enviar',
      });
    }
  }

  private async subscribePrice(client: AppSocket, asset: string) {
    if (!client.data.marketAssets) client.data.marketAssets = new Set();
    if (!client.data.marketAssets.has(asset)) {
      this.market.retainAsset(asset);
      client.data.marketAssets.add(asset);
    }
    await client.join(`price:${asset}`);
    const tick = this.market.getTick(asset as AssetSymbol);
    client.emit('price:tick', {
      asset: tick.asset,
      bid: tick.bid,
      ask: tick.ask,
      mid: tick.mid,
      ts: tick.ts,
    });
  }
}
