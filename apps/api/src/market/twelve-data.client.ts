import { Logger } from '@nestjs/common';
import WebSocket from 'ws';

export interface TwelveDataPriceEvent {
  event: 'price';
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  timestamp: number; // unix seconds
  currency?: string;
  exchange?: string;
  type?: string;
  day_volume?: number;
}

export interface TwelveDataStatusEvent {
  event: string;
  status?: string;
  success?: unknown[];
  fails?: unknown[];
  message?: string;
}

export type TwelveDataMessage = TwelveDataPriceEvent | TwelveDataStatusEvent | Record<string, unknown>;

export type PriceEventHandler = (event: TwelveDataPriceEvent) => void;
export type StatusHandler = (event: TwelveDataStatusEvent) => void;

/**
 * Cliente WebSocket de Twelve Data (quotes/price).
 * Docs: wss://ws.twelvedata.com/v1/quotes/price?apikey=...
 */
export class TwelveDataClient {
  private readonly logger = new Logger(TwelveDataClient.name);
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private readonly subscribed = new Set<string>(); // Twelve Data symbols
  private onPrice: PriceEventHandler | null = null;
  private onStatus: StatusHandler | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly opts: {
      heartbeatMs?: number;
      maxReconnectMs?: number;
    } = {},
  ) {}

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get subscribedSymbols(): string[] {
    return [...this.subscribed];
  }

  setHandlers(handlers: {
    onPrice?: PriceEventHandler;
    onStatus?: StatusHandler;
  }) {
    this.onPrice = handlers.onPrice ?? null;
    this.onStatus = handlers.onStatus ?? null;
  }

  connect() {
    if (!this.apiKey) {
      this.logger.warn('Twelve Data API key ausente — no se conecta WS');
      return;
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.intentionalClose = false;
    const url = `wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(this.apiKey)}`;
    this.logger.log('Conectando a Twelve Data WebSocket…');

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.logger.log('Twelve Data WS conectado');
      this.reconnectAttempt = 0;
      this.startHeartbeat();
      // Re-suscribir símbolos activos
      if (this.subscribed.size > 0) {
        this.sendSubscribe([...this.subscribed]);
      }
    });

    this.ws.on('message', (raw) => {
      this.handleMessage(raw.toString());
    });

    this.ws.on('error', (err) => {
      this.logger.error(`Twelve Data WS error: ${err.message}`);
    });

    this.ws.on('close', (code, reason) => {
      this.stopHeartbeat();
      this.logger.warn(
        `Twelve Data WS cerrado (${code}) ${reason?.toString() || ''}`,
      );
      this.ws = null;
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    });
  }

  disconnect() {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  /**
   * Sincroniza el set de suscripciones con el set deseado.
   * Envía subscribe/unsubscribe diferenciales.
   */
  syncSubscriptions(desiredTdSymbols: string[]) {
    const desired = new Set(desiredTdSymbols.map((s) => s.trim()).filter(Boolean));
    const toAdd: string[] = [];
    const toRemove: string[] = [];

    for (const s of desired) {
      if (!this.subscribed.has(s)) toAdd.push(s);
    }
    for (const s of this.subscribed) {
      if (!desired.has(s)) toRemove.push(s);
    }

    if (toRemove.length) {
      this.sendUnsubscribe(toRemove);
      for (const s of toRemove) this.subscribed.delete(s);
    }
    if (toAdd.length) {
      for (const s of toAdd) this.subscribed.add(s);
      this.sendSubscribe(toAdd);
    }
  }

  subscribe(tdSymbols: string[]) {
    const next = new Set(this.subscribed);
    for (const s of tdSymbols) next.add(s);
    this.syncSubscriptions([...next]);
  }

  unsubscribe(tdSymbols: string[]) {
    const next = new Set(this.subscribed);
    for (const s of tdSymbols) next.delete(s);
    this.syncSubscriptions([...next]);
  }

  private sendSubscribe(symbols: string[]) {
    if (!symbols.length) return;
    this.send({
      action: 'subscribe',
      params: { symbols: symbols.join(',') },
    });
    this.logger.debug(`Subscribe: ${symbols.join(', ')}`);
  }

  private sendUnsubscribe(symbols: string[]) {
    if (!symbols.length) return;
    this.send({
      action: 'unsubscribe',
      params: { symbols: symbols.join(',') },
    });
    this.logger.debug(`Unsubscribe: ${symbols.join(', ')}`);
  }

  private send(payload: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Conectar y reintentar tras open (subscribed ya está en set)
      if (!this.ws) this.connect();
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    const ms = this.opts.heartbeatMs ?? 10_000;
    this.heartbeatTimer = setInterval(() => {
      this.send({ action: 'heartbeat' });
    }, ms);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const max = this.opts.maxReconnectMs ?? 60_000;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempt),
      max,
    );
    this.reconnectAttempt += 1;
    this.logger.log(`Reconectando Twelve Data en ${delay}ms…`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(raw: string) {
    let data: TwelveDataMessage;
    try {
      data = JSON.parse(raw) as TwelveDataMessage;
    } catch {
      this.logger.warn(`Mensaje no-JSON de Twelve Data: ${raw.slice(0, 120)}`);
      return;
    }

    const event = (data as { event?: string }).event;

    if (event === 'price') {
      const p = data as Record<string, unknown>;
      const price = Number(p.price);
      if (!Number.isFinite(price) || !p.symbol) return;

      const parsed: TwelveDataPriceEvent = {
        event: 'price',
        symbol: String(p.symbol),
        price,
        timestamp: Number(p.timestamp) || Math.floor(Date.now() / 1000),
        bid: p.bid != null ? Number(p.bid) : undefined,
        ask: p.ask != null ? Number(p.ask) : undefined,
        currency: p.currency != null ? String(p.currency) : undefined,
        exchange: p.exchange != null ? String(p.exchange) : undefined,
        type: p.type != null ? String(p.type) : undefined,
        day_volume: p.day_volume != null ? Number(p.day_volume) : undefined,
      };
      this.onPrice?.(parsed);
      return;
    }

    // status / subscribe-status / heartbeat / errors
    this.onStatus?.(data as TwelveDataStatusEvent);
    if (event === 'subscribe-status') {
      const st = data as TwelveDataStatusEvent;
      if (st.fails && Array.isArray(st.fails) && st.fails.length) {
        this.logger.warn(
          `Twelve Data subscribe fails: ${JSON.stringify(st.fails)}`,
        );
      } else {
        this.logger.log(
          `Twelve Data subscribe ok (${st.success?.length ?? 0} symbols)`,
        );
      }
    }
  }
}
