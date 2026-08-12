import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  JwtPayload,
  ServerToClientEvents,
} from '@trading-duels/shared';
import { MatchmakingService } from './matchmaking.service';
import { DuelsGateway } from '../duels/duels.gateway';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents> & {
  data: { user?: JwtPayload };
};

@WebSocketGateway({
  cors: {
    // Keep in sync with apps/api/src/common/cors-origins.ts (HTTP + BrGateway)
    origin: (
      process.env.CORS_ORIGIN?.split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter(Boolean) ?? []
    ).concat([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://web-production-38a05.up.railway.app',
    ]),
    credentials: true,
  },
  namespace: '/matchmaking',
})
export class MatchmakingGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly matchmaking: MatchmakingService,
    private readonly duelsGateway: DuelsGateway,
  ) {}

  afterInit() {
    this.matchmaking.setMatchHandler(({ duelId, playerAId, playerBId }) => {
      this.duelsGateway.emitToUser(playerAId, 'matchmaking:matched', { duelId });
      this.duelsGateway.emitToUser(playerBId, 'matchmaking:matched', { duelId });
      // También por este namespace
      this.server.to(`user:${playerAId}`).emit('matchmaking:matched', { duelId });
      this.server.to(`user:${playerBId}`).emit('matchmaking:matched', { duelId });
      this.server.to(`user:${playerAId}`).emit('challenge:matched', { duelId });
      this.server.to(`user:${playerBId}`).emit('challenge:matched', { duelId });
    });
  }

  async handleConnection(client: AppSocket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers.authorization?.replace('Bearer ', '') ?? '');
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      client.data.user = payload;
      await client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('matchmaking:join')
  async onJoin(
    @ConnectedSocket() client: AppSocket,
    @MessageBody()
    body: {
      mode: 'BLITZ' | 'NORMAL' | 'SLOW';
      stake: number;
      asset: string;
      sessionWindow?: 'TOKYO' | 'LONDON' | 'NY';
    },
  ) {
    const user = client.data.user;
    if (!user) return;
    try {
      const result = await this.matchmaking.joinQueue({
        userId: user.sub,
        mode: body.mode,
        stake: body.stake,
        asset: body.asset,
        sessionWindow: body.sessionWindow,
      });
      if (result.status === 'MATCHED') {
        client.emit('matchmaking:matched', { duelId: result.duelId });
      } else {
        client.emit('matchmaking:queued', {
          position: 1,
          eloRange: result.eloRange,
        });
      }
    } catch (err) {
      client.emit('matchmaking:error', {
        message: err instanceof Error ? err.message : 'Error en matchmaking',
      });
    }
  }

  @SubscribeMessage('matchmaking:leave')
  async onLeave(@ConnectedSocket() client: AppSocket) {
    const user = client.data.user;
    if (!user) return;
    await this.matchmaking.leaveQueue(user.sub);
  }

  @SubscribeMessage('challenge:create')
  async onCreate(
    @ConnectedSocket() client: AppSocket,
    @MessageBody()
    body: {
      mode: 'BLITZ' | 'NORMAL' | 'SLOW';
      stake: number;
      asset: string;
      sessionWindow?: 'TOKYO' | 'LONDON' | 'NY';
    },
  ) {
    const user = client.data.user;
    if (!user) return;
    try {
      const challenge = await this.matchmaking.createChallenge({
        userId: user.sub,
        mode: body.mode,
        asset: body.asset,
        stake: body.stake,
        sessionWindow: body.sessionWindow,
      });
      client.emit('challenge:created', challenge);
      this.server.emit('challenge:list', await this.matchmaking.listChallenges());
    } catch (err) {
      client.emit('matchmaking:error', {
        message: err instanceof Error ? err.message : 'Error creando desafío',
      });
    }
  }

  @SubscribeMessage('challenge:accept')
  async onAccept(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { challengeId: string },
  ) {
    const user = client.data.user;
    if (!user) return;
    try {
      const { duelId } = await this.matchmaking.acceptChallenge(
        body.challengeId,
        user.sub,
      );
      client.emit('challenge:matched', { duelId });
    } catch (err) {
      client.emit('matchmaking:error', {
        message: err instanceof Error ? err.message : 'Error aceptando desafío',
      });
    }
  }

  @SubscribeMessage('challenge:cancel')
  async onCancel(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: { challengeId: string },
  ) {
    const user = client.data.user;
    if (!user) return;
    await this.matchmaking.cancelChallenge(body.challengeId, user.sub);
    this.server.emit('challenge:list', await this.matchmaking.listChallenges());
  }
}
