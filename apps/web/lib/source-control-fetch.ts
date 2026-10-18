import { isIP } from 'node:net';
import type { FixtureRecord } from '../../../packages/domain/contracts.ts';
import type { SourcePermission } from '../../../packages/domain/source-control-contracts.ts';
import { parseFixture } from '../../../packages/domain/rules.ts';
import { SOURCE_RECORD_FIELDS } from '../../../packages/domain/source-control-contracts.ts';

export type SourceTransport = { resolve:(host:string)=>Promise<string[]>; robotsAllows?:(url:string)=>Promise<boolean>; transport:(request:{url:string;connectAddress:string;signal:AbortSignal;redirect:'manual';maxBytes:number})=>Promise<{status:number;headers:Record<string,string>;body:AsyncIterable<Uint8Array>}> };
export type SourceFetchResult = {kind:'ACCEPTED';body:string;code:null;retryAfterSeconds:null}|{kind:'REJECTED';body:null;code:string;retryAfterSeconds:number|null};
const rejected=(code:string,retryAfterSeconds:number|null=null):SourceFetchResult=>({kind:'REJECTED',body:null,code,retryAfterSeconds});
/** Deliberately IPv4-only until a real approved adapter supplies a reviewed IPv6 policy. */
function publicAddress(value:string):boolean {if(isIP(value)!==4)return false;const [a,b,c]=value.split('.').map(Number);return a>0&&a<224&&a!==10&&a!==127&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0||b===2))&&!(a===198&&(b===18||b===19||(b===51&&c===100)))&&!(a===203&&b===0&&c===113);}
function scopedUrl(contract:SourcePermission,raw:string):URL|null {try{if(raw.length>2000||/[\\\u0000-\u0020]/.test(raw)||/https:\/\/[^/]*:\d+/i.test(raw))return null;const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.hash||url.origin!==contract.origin||!url.pathname.startsWith(contract.pathPrefix)||/%2e|%2f|%5c/i.test(raw))return null;return url;}catch{return null;}}
/** No default network implementation: every DNS lookup and byte is supplied by an injected synthetic transport. */
export function createSafeSourceFetcher(transport:SourceTransport,options:{timeoutMs?:number;maxBytes?:number;maxRequestsPerMinute?:number;now?:()=>number}={}) {
  const timeoutMs=options.timeoutMs??3000,maxBytes=options.maxBytes??128*1024,budget=options.maxRequestsPerMinute??5,clock=options.now??Date.now;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>1024*1024||!Number.isSafeInteger(budget)||budget<1||budget>30)throw new Error('Invalid bounded transport configuration');
  const windows=new Map<string,{since:number;count:number}>();
  async function fetchSource(contract:SourcePermission,raw:string):Promise<SourceFetchResult>{
    if(contract.state!=='ACTIVE'||!Number.isFinite(Date.parse(contract.expiresAt))||Date.parse(contract.expiresAt)<=clock())return rejected('PERMISSION_BLOCKED');
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const expired=new Promise<SourceFetchResult>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(rejected('TIMEOUT'));},timeoutMs);});
    async function collect():Promise<SourceFetchResult>{let current=raw;for(let redirect=0;redirect<=2;redirect++){
      const url=scopedUrl(contract,current);if(!url)return rejected('URL_SCOPE');
      for(const [key,window]of windows)if(clock()-window.since>=60000)windows.delete(key);
      const window=windows.get(url.host)??{since:clock(),count:0};if(window.count>=budget||(!windows.has(url.host)&&windows.size>=100))return rejected('RATE_LIMITED',60);window.count++;windows.set(url.host,window);
      if(contract.method==='HTML'&&(!transport.robotsAllows||!await transport.robotsAllows(url.href)))return rejected('ROBOTS_DENIED');
      if(controller.signal.aborted)return rejected('TIMEOUT');
      const addresses=await transport.resolve(url.hostname);if(!addresses.length||addresses.length>16||addresses.some(address=>!publicAddress(address)))return rejected('PRIVATE_ADDRESS');
      if(controller.signal.aborted)return rejected('TIMEOUT');
      const response=await transport.transport({url:url.href,connectAddress:addresses[0],signal:controller.signal,redirect:'manual',maxBytes});
      const headers=Object.fromEntries(Object.entries(response.headers).map(([key,value])=>[key.toLowerCase(),value]));
      if([301,302,303,307,308].includes(response.status)){if(redirect===2||!headers.location)return rejected('REDIRECT_LIMIT');current=new URL(headers.location,url).href;continue;}
      if(response.status===429){const value=headers['retry-after']??'';const seconds=/^\d{1,6}$/.test(value)?Number(value):Math.ceil((Date.parse(value)-clock())/1000);return rejected('RATE_LIMITED',Number.isFinite(seconds)?Math.max(1,Math.min(3600,seconds)):60);}
      if(response.status!==200)return rejected('HTTP_STATUS');
      const expected=contract.method==='HTML'?'text/html':contract.method==='CSV'?'text/csv':'application/json';if(headers['content-type']?.split(';')[0].trim().toLowerCase()!==expected)return rejected('CONTENT_TYPE');
      if(headers['content-length']&&(!/^\d+$/.test(headers['content-length'])||Number(headers['content-length'])>maxBytes))return rejected('PAYLOAD_LIMIT');
      const chunks:Uint8Array[]=[];let length=0;for await(const chunk of response.body){if(controller.signal.aborted)return rejected('TIMEOUT');length+=chunk.byteLength;if(length>maxBytes){controller.abort();return rejected('PAYLOAD_LIMIT');}chunks.push(chunk);}
      return{kind:'ACCEPTED',body:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),code:null,retryAfterSeconds:null};
    }return rejected('REDIRECT_LIMIT');}
    try{return await Promise.race([collect(),expired]);}catch{return rejected(controller.signal.aborted?'TIMEOUT':'TRANSPORT_ERROR');}finally{if(timer)clearTimeout(timer);controller.abort();}
  }
  return {fetch:fetchSource};
}
export type ExtractionResult={kind:'ACCEPTED';record:FixtureRecord;code:null}|{kind:'QUARANTINED';record:null;code:string};
/** Strict data-only extraction boundary. Source text never becomes instructions, tools, URLs to follow, or student context. */
export function extractSyntheticRecord(contract:SourcePermission,input:unknown):ExtractionResult {
  const quarantine=(code:string):ExtractionResult=>({kind:'QUARANTINED',record:null,code});
  if(!input||typeof input!=='object'||Array.isArray(input))return quarantine('INVALID_SCHEMA');
  const value=input as Record<string,unknown>;if(Object.keys(value).some(key=>!['kind','record'].includes(key)))return quarantine('INVALID_SCHEMA');
  if(value.kind==='REFUSED'||value.kind==='TRUNCATED'||value.kind==='ERROR')return quarantine(value.kind);
  if(value.kind!=='COMPLETE')return quarantine('INVALID_SCHEMA');
  try {const record=parseFixture(value.record);if(record.source.id!==contract.sourceId||!scopedUrl(contract,record.source.url)||Object.keys(record).some(key=>SOURCE_RECORD_FIELDS.includes(key)&&!contract.fields.includes(key)))return quarantine('OUT_OF_SCOPE');const composite:Record<string,string[]>={requirements:['fee','requiresTraining','requiresGuardian','schoolCreditApproved'],participation:['minAge','maxAge','startsAt','endsAt']};if(!record.evidence.length||record.evidence.some(item=>!item.excerpt.trim()||(!contract.fields.includes(item.field)&&!(composite[item.field]?.every(field=>contract.fields.includes(field)))&&!['source.permission','source.permissionEvidence'].includes(item.field))||!scopedUrl(contract,item.sourceUrl)))return quarantine('UNGROUNDED');return{kind:'ACCEPTED',record,code:null};}catch{return quarantine('INVALID_SCHEMA');}
}
