# Trading Duels — MVP

Plataforma de **duelos de trading 1vs1** en tiempo real. Gana quien obtiene el mayor **R-múltiplo**. La plataforma se queda con el **10% del pot** final.

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | Next.js 14 (App Router) · TypeScript · Tailwind · componentes estilo Shadcn |
| Gráficos | Lightweight Charts |
| Backend | NestJS · TypeScript |
| DB | PostgreSQL · Prisma |
| Realtime | Socket.io |
| Auth | JWT (bcrypt + Passport) |

## Estructura del monorepo

```
trading-duels/
├── apps/
│   ├── api/          # NestJS + Prisma + Socket.io
│   └── web/          # Next.js frontend
├── packages/
│   └── shared/       # Tipos, constantes y motor de duelos (lógica pura)
├── docker-compose.yml
└── package.json      # npm workspaces
```

## Modelos de base de datos

- **User** / **Session** — cuentas, ELO, W/L/D  
- **Wallet** / **WalletTransaction** — balance, locked, depósitos/retiros/stakes  
- **Duel** — modos, fases, pot, scores, timers  
- **Trade** — market/limit, SL/TP, R-múltiplo, PnL  
- **StakeRaise** — subidas de apuesta con timeout 40s  
- **MatchmakingTicket** — cola ELO suave  
- **OpenChallenge** — desafíos sin revelar ELO  
- **PriceSnapshot** — histórico opcional  

## Modos

| Modo | Prep | Desarrollo | Trades | Riesgo máx. | Raises |
|------|------|------------|--------|-------------|--------|
| Blitz | 2 min | 8 min | 2 | 3% | 2 |
| Normal | 5 min | 15 min | 3 | 4% | 3 |
| Slow | 30 min | 2 h | 5 | 5% | 5 |

## Motor de duelos

Lógica compartida en `@trading-duels/shared` + orquestación en `DuelEngineService`:

1. **Estados:** `WAITING → MATCHED → PREPARATION → DEVELOPMENT → SETTLING → COMPLETED|DRAW`
2. **Timers** de fase con recuperación tras restart  
3. **Trades:** validación de riesgo/max trades, market entry, limit activation, SL/TP hits  
4. **R-múltiplo:** `(pnl distance) / (risk distance)` · limit no activada = **0R**  
5. **Cierre al tiempo:** posiciones abiertas a mercado  
6. **Desempate:** mayor R → mayor profit absoluto  
7. **Raises:** solo en DEVELOPMENT, >10% stake, 40s para aceptar/rechazar/re-subir  

## Requisitos

- Node.js ≥ 20  
- Docker (PostgreSQL) o PostgreSQL local  
- npm  

## Setup

```bash
# 1. Clonar / entrar al proyecto
cd ~/trading-duels   # o C:\Users\<user>\trading-duels

# 2. Instalar dependencias del monorepo
npm install

# 3. Build del paquete shared
npm run build:shared

# 4. Base de datos
docker compose up -d

# 5. Variables de entorno (ya hay .env de ejemplo en apps/api)
# DATABASE_URL, JWT_SECRET, etc.

# 6. Prisma
npm run db:push
# o: npm run db:migrate

# 7. Desarrollo (API :3001 + Web :3000)
npm run dev
```

### Solo API / solo Web

```bash
npm run dev:api
npm run dev:web
```

## Flujo de prueba rápida

1. Abre http://localhost:3000  
2. Registra dos usuarios (dos navegadores / incógnito)  
3. Deposita fondos en **Wallet** (mín. $10)  
4. En **Lobby**, crea matchmaking o desafío con el mismo stake  
5. Confirma ready → prep → trading  
6. Abre trades con SL (TP opcional)  
7. Al terminar el tiempo se liquida y se paga el premio (−10% fee)  

## API principal

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registro |
| POST | `/api/auth/login` | Login JWT |
| GET | `/api/auth/me` | Usuario + wallet |
| GET/POST | `/api/wallet` | Balance / deposit / withdraw |
| POST | `/api/matchmaking/queue` | Entrar cola |
| GET/POST | `/api/matchmaking/challenges` | Desafíos abiertos |
| GET | `/api/duels/:id` | Estado del duelo |
| POST | `/api/duels/:id/trades` | Abrir trade |
| GET | `/api/leaderboard?mode=GLOBAL\|BLITZ\|NORMAL\|SLOW` | Ranking (ELO + stats) |
| GET | `/api/profile/:username` | Perfil público |
| GET | `/api/users/:id` | Perfil público por id |
| GET | `/api/missions` | Misiones + progreso del usuario |
| GET | `/api/missions/pool` | Pozo y tope diario |
| POST | `/api/missions/claim` | Reclamar recompensa `{ missionType }` |
| GET | `/api/duels/live` | Duelos en vivo (espectar) |
| GET | `/api/duels/:id` | Snapshot jugador o espectador |
| GET/POST | `/api/duels/:id/bets` | Listar / crear oferta P2P |
| POST | `/api/duels/:id/bets/:betId/accept` | Aceptar oferta (lado contrario) |
| POST | `/api/duels/:id/bets/:betId/cancel` | Cancelar oferta abierta |

### Espectador + apuestas P2P

- Entrar a `/duel/:id?spectate=1` o desde **Duelos en vivo** en el Lobby
- Solo lectura: gráfico, scoreboard, trades (sin operar ni raises)
- Ofertas: eliges Player A/B + monto → se bloquea saldo
- Aceptar = lado contrario, mismo monto, ambos bloqueados
- Al terminar: acertante recibe pot − 10% fee; empate/cancel → reembolso
- Jugadores del duelo **no** pueden apostar como espectadores

### Misiones

| Misión | Stake mín. | Objetivo | Recompensa |
|--------|------------|----------|------------|
| 6 victorias del día | $3 | 6 wins / día UTC | $1.50 |
| 18 victorias semanales | $3 | 18 wins / semana ISO | $6 |
| Racha de 5 | $3 | 5 wins seguidas | $2 (máx. 1/3 días) |
| 35 victorias del mes | $5 | 35 wins / mes | $25–$60 del **Pozo** |

- **Tope diario** misiones pequeñas: $300 global → se pausan hasta el día siguiente  
- **Pozo:** 10% de cada comisión de plataforma; si &lt; $25 la misión grande se muestra pausada  
- UI: `/missions`
| WS | `/duels` | Estado, trades, precios en vivo |
| WS | `/matchmaking` | Cola y challenges |

### Leaderboard y perfiles

- **UI:** `/leaderboard` · `/profile/[username]`
- **Ranks por ELO:** Novice → Contender → Specialist → Expert → Elite → Master → Legend
- **Global:** orden por ELO (desempate wins)
- **Por modo:** jugadores con duelos en ese modo, orden por ELO + wins/WR del modo
- **Avg R:** promedio de R-múltiplo en duelos finalizados
- Links desde nav (Ranking), header (avatar → perfil), arena (nombres), lobby (creadores de desafíos)

## Activos

Forex: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF  
Índices: NAS100, US30, SPX500  
Metales: XAUUSD  
Crypto: BTCUSD, ETHUSD  

### Feed de precios — Twelve Data

El backend se conecta a **Twelve Data** (WebSocket + REST):

| Variable | Descripción |
|----------|-------------|
| `TWELVE_DATA_API_KEY` | API key personal (requerida para precios reales) |

**Cómo obtener la key (gratis):**

1. Regístrate en [twelvedata.com/register](https://twelvedata.com/register)
2. Copia la key en [Account → API Keys](https://twelvedata.com/account/api-keys)
3. Pégala en `apps/api/.env`:

```env
TWELVE_DATA_API_KEY=tu_api_key_aqui
```

4. Reinicia el API (`npm run dev:api`)

Sin key, el servicio usa **mock random walk** (útil para desarrollo offline).

**Arquitectura del feed:**

- `TwelveDataClient` — WS `wss://ws.twelvedata.com/v1/quotes/price`
- `TwelveDataRest` — `/time_series` (velas) y `/price` (bootstrap)
- `MarketService` — caché bid/ask/mid, refcount de símbolos, listeners
- Suscripción **bajo demanda**: chart (`market:subscribe`) + trades abiertos
- El motor de duelos consume `getTick()` / listeners para fills limit, SL/TP y R
- Socket.io emite `price:tick` a rooms `price:{ASSET}`

**Mapeo de símbolos:**

| Interno | Twelve Data |
|---------|-------------|
| EURUSD… | EUR/USD … |
| XAUUSD | XAU/USD |
| BTCUSD / ETHUSD | BTC/USD / ETH/USD |
| NAS100 / US30 / SPX500 | NDX / DJI / SPX |

**Límites free tier:** ~8 créditos WS concurrentes. Solo se suscriben activos con demanda (gráfico o trade vivo).

Estado del feed: `GET /api/market/status`

## Notas de producción

- Cambiar `JWT_SECRET` y secrets  
- Integrar pasarela de pagos real  
- Plan Twelve Data acorde al nº de símbolos concurrentes  
- Rate limiting, anti-cheat, auditoría de fills  
- Tests unitarios del motor en `packages/shared`  

---

Hecho con NestJS + Next.js · MVP listo para iterar.
