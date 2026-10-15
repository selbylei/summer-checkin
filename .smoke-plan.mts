import './server/env';
import { prisma } from './server/db';
const v = await prisma.postVariant.findFirst({ where: { status: 'DRAFT' }, select: { id: true, platform: true } });
console.log(v ? JSON.stringify(v) : 'none');
await prisma.$disconnect();
