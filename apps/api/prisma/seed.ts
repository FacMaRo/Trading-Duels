import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('password123', 12);

  const alice = await prisma.user.upsert({
    where: { email: 'alice@duels.local' },
    update: {},
    create: {
      email: 'alice@duels.local',
      username: 'alice',
      displayName: 'Alice Trader',
      passwordHash,
      elo: 1050,
      wallet: {
        create: { balance: 500, lockedBalance: 0 },
      },
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@duels.local' },
    update: {},
    create: {
      email: 'bob@duels.local',
      username: 'bob',
      displayName: 'Bob Scalper',
      passwordHash,
      elo: 980,
      wallet: {
        create: { balance: 500, lockedBalance: 0 },
      },
    },
  });

  console.log('Seed OK:', { alice: alice.username, bob: bob.username });
  console.log('Password for both: password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
