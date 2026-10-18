import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const token = process.env.LOCAL_REVIEW_TOKEN || randomBytes(24).toString('base64url');
const port = process.env.PORT || '3100';
console.log(`Local synthetic demo: http://127.0.0.1:${port}`);
console.log(`Reviewer token for this process only: ${token}`);
const child = spawn(process.execPath,['node_modules/next/dist/bin/next','dev','apps/web','--webpack','--hostname','127.0.0.1','--port',port],{
  stdio:'inherit',env:{...process.env, COMGROUND_MODE: 'demo',LOCAL_REVIEW_TOKEN:token,COMGROUND_DB_PATH:process.env.COMGROUND_DB_PATH||resolve('.data/comground.sqlite'),NEXT_TELEMETRY_DISABLED:'1'}
});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code||0));
