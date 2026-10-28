const net = require('net');
const {PrismaClient} = require('@prisma/client');
require('@next/env').loadEnvConfig(process.cwd());
const url = process.env.DATABASE_URL || '(unset)';
let host='?',port=5432;
try{const u=new URL(url);host=u.hostname;port=Number(u.port||5432);console.log('DATABASE_URL ->', host, port, 'db='+u.pathname);}catch{console.log('DATABASE_URL raw:', url);}
const s = net.createConnection({host, port}, ()=>{console.log('TCP connect OK'); s.end();});
s.on('error', e=>console.log('TCP connect ERROR:', e.code, '-', e.message));
s.setTimeout(4000, ()=>{console.log('TCP timeout (no response)'); s.destroy();});
(async()=>{const p=new PrismaClient();try{const n=await p.$queryRawUnsafe('select version() as v');console.log('PRISMA query OK:', n);}catch(e){console.log('PRISMA ERROR:', String(e.message).split('\n').filter(Boolean)[0]);}finally{await p.$disconnect();}})();
