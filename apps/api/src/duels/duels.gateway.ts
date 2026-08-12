import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type {
  AssetSymbol,
  ClientToServerEvents,
  JwtPayload,
  ServerToClientEvents,
  TradeInput,
} from '@trading-duels/shared';
import { ALL_ASSETS } from '@trading-duels/shared';
import { DuelsService } from './duels.service';
import { DuelEngineService } from './duel-engine.service';
import { MarketService } from '../market/market.service';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents> & {
  data: {
    user?: JwtPayload;
    /** Activos con retain por este socket (chart) */
    marketAssets?: Set<string>;
  };
};

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  },
  namespace: '/duels',
})
export class DuelsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server<ClientToServerEvents, ServerToClientEvents>;

  private readonly logger = new Logger(DuelsGateway.name);
  private userSockets = new Map<string, Set<string>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly duels: DuelsService,
    private readonly engine: DuelEngineService,
    private readonly market: MarketService,
  ) {}

  afterInit() {
    this.engine.setEmitter((duelId, event, payload) => {
      this.server.to(`duel:${duelId}`).emit(event as keyof ServerToClientEvents, payload as never);
    });

    // Precios: room por activo + broadcast a rooms de duelo (clientes filtran por asset)
    this.market.subscribe((asset, tick) => {
      const payload = {
        asset,
        bid: tick.bid,
        ask: tick.ask,
        mid: tick.mid,
        ts: tick.ts,
      };
      this.server.to(`price:${asset}`).emit('price:tick', payload);
    });

    this.logger.log('DuelsGateway initialized');
  }

  async handleConnection(client: AppSocket) {
    client.data.marketAssets = new Set();
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers.authorization?.replace('Bearer ', '') ?? '');
      if (!token) {
        // Visitante anónimo: puede espectar y ver precios
        this.logger.debug(`WS guest connected (${client.id})`);
        return;
      }
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      client.data.user = payload;
      this.addUserSocket(payload.sub, client.id);
      this.logger.debug(`WS connected: ${payload.username} (${client.id})`);
    } catch {
      // Token inválido → seguir como guest (no desconectar)
      this.logger.debug(`WS guest (invalid token) (${client.id})`);
    }
  }

  handleDisconnect(client: AppSocket) {
    const userId = client.data.user?.sub;
    if (userId) this.removeUserSocket(userId, client.id);
    // Liberar demanda de market data del socket
    const assets = client.data.marketAssets;
    if (assets) {
      for (const a of assets) {
        this.market.releaseAsset(a);
      }
      assets.clear();
    }
  }

  @SubscribeMessage('duel:subscribe')
  async onSubscribe(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { duelId: string },
  ) {
    const user = client.data.user;
    // Sin sesión → espectador anónimo
    await this.joinDuelRoom(client, body.duelId, user?.sub ?? null, !user);
  }

  /** Entrar como espectador (lectura, también anónimo) */
  @SubscribeMessage('duel:spectate')
  async onSpectate(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { duelId: string },
  ) {
    await this.joinDuelRoom(
      client,
      body.duelId,
      client.data.user?.sub ?? null,
      true,
    );
  }

  private async joinDuelRoom(
    client: AppSocket,
    duelId: string,
    userId: string | null,
    asSpectator: boolean,
  ) {
    try {
      const snap = await this.duels.getSpectatorOrPlayerSnapshot(
        duelId,
        userId,
      );
      if (!asSpectator && snap.viewerRole === 'SPECTATOR') {
        // permitir de todos modos si solo miran
      }
      await client.join(`duel:${duelId}`);

      const duel = await this.duels.getDuelOrThrow(duelId);
      const openAssets = [
        ...new Set(
          [
            ...duel.trades
              .filter((t) => t.status === 'OPEN' || t.status === 'PENDING')
              .map((t) => t.asset),
            ...(duel.primaryAsset ? [duel.primaryAsset] : []),
          ].filter(Boolean),
        ),
      ];
      for (const asset of openAssets) {
        this.retainClientAsset(client, asset);
      }

      client.emit('duel:state', snap);
    } catch (err) {
      client.emit('duel:error', {
        message: err instanceof Error ? err.message : 'Error al suscribirse',
      });
    }
  }

  @SubscribeMessage('duel:unsubscribe')
  async onUnsubscribe(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { duelId: string },
  ) {
    await client.leave(`duel:${body.duelId}`);
  }

  /**
   * Cliente pide stream de un activo (gráfico).
   * Soporta body: { asset } o compat chart:timeframe con asset implícito vía trade panel.
   */
  @SubscribeMessage('market:subscribe')
  async onMarketSubscribe(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { asset: string },
  ) {
    // Público: visitantes/espectadores también reciben ticks del chart
    const asset = body?.asset?.toUpperCase();
    if (!asset || !(ALL_ASSETS as readonly string[]).includes(asset)) {
      client.emit('duel:error', { message: `Activo inválido: ${body?.asset}` });
      return;
    }
    this.retainClientAsset(client, asset);
    await client.join(`price:${asset}`);
    // Snapshot inmediato
    const tick = this.market.getTick(asset as AssetSymbol);
    client.emit('price:tick', {
      asset: tick.asset,
      bid: tick.bid,
      ask: tick.ask,
      mid: tick.mid,
      ts: tick.ts,
    });
  }

  @SubscribeMessage('market:unsubscribe')
  async onMarketUnsubscribe(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { asset: string },
  ) {
    const asset = body?.asset?.toUpperCase();
    if (!asset) return;
    this.releaseClientAsset(client, asset);
    await client.leave(`price:${asset}`);
  }

  @SubscribeMessage('chart:timeframe')
  async onChartTimeframe(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { duelId: string; timeframe: string; asset?: string },
  ) {
    // Preferencia de UI; si trae asset, asegurar suscripción
    if (body?.asset) {
      await this.onMarketSubscribe(client, { asset: body.asset });
    }
  }

  private retainClientAsset(client: AppSocket, asset: string) {
    if (!client.data.marketAssets) client.data.marketAssets = new Set();
    if (client.data.marketAssets.has(asset)) return;
    client.data.marketAssets.add(asset);
    this.market.retainAsset(asset);
  }

  private releaseClientAsset(client: AppSocket, asset: string) {
    if (!client.data.marketAssets?.has(asset)) return;
    client.data.marketAssets.delete(asset);
    this.market.releaseAsset(asset);
  }

  @SubscribeMessage('duel:ready')
  async onReady(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { duelId: string },
  ) {
    const user = client.data.user;
    if (!user) return;
    try {
      const duel = await this.duels.markReady(body.duelId, user.sub);
      const snapshot = this.duels.toSnapshot(duel);
      this.server.to(`duel:${body.duelId}`).emit('duel:state', snapshot);
    } catch (err) {
      client.emit('duel:error', {
        message: err instanceof Error ? err.message : 'Error',
      });
    }
  }

  @SubscribeMessage('trade:open')
  async onTradeOpen(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { duelId: string; trade: TradeInput },
  ) {
    const user = client.data.user;
    if (!user) return;
    try {
      await this.duels.openTrade(body.duelId, user.sub, body.trade);
      const duel = await this.duels.getDuelOrThrow(body.duelId);
      this.server
        .to(`duel:${body.duelId}`)
        .emit('duel:state', this.duels.toSnapshot(duel));
    } catch (err) {
      client.emit('duel:error', {
        message: err instanceof Error ? err.message : 'Error abriendo trade',
      });
    }
  }

  @SubscribeMessage('trade:close')
  async onTradeClose(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { duelId: string; tradeId: string },
  ) {
    const user = client.data.user;
    if (!user) return;
    try {
      await this.duels.closeTrade(body.duelId, user.sub, body.tradeId);
      const duel = await this.duels.getDuelOrThrow(body.duelId);
      this.server
        .to(`duel:${body.duelId}`)
        .emit('duel:state', this.duels.toSnapshot(duel));
    } catch (err) {
      client.emit('duel:error', {
        message: err instanceof Error ? err.message : 'Error cerrando trade',
      });
    }
  }

  @SubscribeMessage('trade:cancel')
  async onTradeCancel(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { duelId: string; tradeId: string },
  ) {
    const user = client.data.user;
    if (!user) return;
    try {
      await this.duels.cancelTrade(body.duelId, user.sub, body.tradeId);
      const duel = await this.duels.getDuelOrThrow(body.duelId);
      this.server
        .to(`duel:${body.duelId}`)
        .emit('duel:state', this.duels.toSnapshot(duel));
    } catch (err) {
      client.emit('duel:error', {
        message: err instanceof Error ? err.message : 'Error cancelando trade',
      });
    }
  }

  @SubscribeMessage('raise:propose')
  async onRaisePropose(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { duelId: string; newStake: number },
  ) {
    const user = client.data.user;
    if (!user) return;
    try {
      await this.duels.proposeRaise(body.duelId, user.sub, body.newStake);
      const duel = await this.duels.getDuelOrThrow(body.duelId);
      this.server
        .to(`duel:${body.duelId}`)
        .emit('duel:state', this.duels.toSnapshot(duel));
    } catch (err) {
      client.emit('duel:error', {
        message: err instanceof Error ? err.message : 'Error en subida',
      });
    }
  }

  @SubscribeMessage('duel:chat')
  async onChat(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { duelId: string; message: string },
  ) {
    const user = client.data.user;
    if (!user) return;
    const text = (body?.message ?? '').trim().slice(0, 280);
    if (!text || !body?.duelId) return;
    try {
      const duel = await this.duels.getDuelOrThrow(body.duelId);
      this.duels.assertParticipant(duel, user.sub);
      this.server.to(`duel:${body.duelId}`).emit('duel:chat_message', {
        duelId: body.duelId,
        userId: user.sub,
        username: user.username,
        message: text,
        ts: Date.now(),
      });
    } catch (err) {
      client.emit('duel:error', {
        message: err instanceof Error ? err.message : 'Error en chat',
      });
    }
  }

  @SubscribeMessage('raise:respond')
  async onRaiseRespond(
    @ConnectedSocket() client: AppSocket,
    @MessageBody()
    body: {
      duelId: string;
      raiseId: string;
      action: 'ACCEPT' | 'REJECT' | 'RE_RAISE';
      newStake?: number;
    },
  ) {
    const user = client.data.user;
    if (!user) return;
    try {
      await this.duels.respondRaise(
        body.duelId,
        user.sub,
        body.raiseId,
        body.action,
        body.newStake,
      );
      const duel = await this.duels.getDuelOrThrow(body.duelId);
      this.server
        .to(`duel:${body.duelId}`)
        .emit('duel:state', this.duels.toSnapshot(duel));
    } catch (err) {
      client.emit('duel:error', {
        message: err instanceof Error ? err.message : 'Error respondiendo subida',
      });
    }
  }

  private addUserSocket(userId: string, socketId: string) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socketId);
  }

  private removeUserSocket(userId: string, socketId: string) {
    const set = this.userSockets.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) this.userSockets.delete(userId);
  }

  /** Emitir a todos los sockets de un usuario (matchmaking) */
  emitToUser(userId: string, event: keyof ServerToClientEvents, payload: unknown) {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    for (const sid of sockets) {
      this.server.to(sid).emit(event, payload as never);
    }
  }
}
