const te=new TextEncoder(), td=new TextDecoder();
const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(u8){let c=0xffffffff;for(const b of u8)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0}
function wr16(a,o,v){a[o]=v&255;a[o+1]=(v>>>8)&255} function wr32(a,o,v){a[o]=v&255;a[o+1]=(v>>>8)&255;a[o+2]=(v>>>16)&255;a[o+3]=(v>>>24)&255}
function read16(d,o){return d[o]|(d[o+1]<<8)} function read32(d,o){return (d[o]|d[o+1]<<8|d[o+2]<<16|d[o+3]<<24)>>>0}
export async function makeZip(entries){if(entries.length>=65535)throw new Error('Для этого объёма требуется ZIP64');const parts=[],central=[];let offset=0;for(const e of entries){const name=te.encode(e.name);const data=e.data instanceof Uint8Array?e.data:new Uint8Array(await e.data.arrayBuffer());const crc=crc32(data);const local=new Uint8Array(30+name.length);wr32(local,0,0x04034b50);wr16(local,4,20);wr16(local,6,0x0800);wr16(local,8,0);wr16(local,10,0);wr16(local,12,0);wr32(local,14,crc);wr32(local,18,data.length);wr32(local,22,data.length);wr16(local,26,name.length);wr16(local,28,0);local.set(name,30);parts.push(local,data);
const c=new Uint8Array(46+name.length);wr32(c,0,0x02014b50);wr16(c,4,20);wr16(c,6,20);wr16(c,8,0x0800);wr16(c,10,0);wr16(c,12,0);wr16(c,14,0);wr32(c,16,crc);wr32(c,20,data.length);wr32(c,24,data.length);wr16(c,28,name.length);wr16(c,30,0);wr16(c,32,0);wr16(c,34,0);wr16(c,36,0);wr32(c,38,0);wr32(c,42,offset);c.set(name,46);central.push(c);offset+=local.length+data.length}
if(offset>=0xffffffff)throw new Error('Для этого объёма требуется ZIP64');const centralOffset=offset,centralSize=central.reduce((s,x)=>s+x.length,0);parts.push(...central);const end=new Uint8Array(22);wr32(end,0,0x06054b50);wr16(end,4,0);wr16(end,6,0);wr16(end,8,entries.length);wr16(end,10,entries.length);wr32(end,12,centralSize);wr32(end,16,centralOffset);wr16(end,20,0);parts.push(end);return new Blob(parts,{type:'application/zip'})}
export async function readZip(blob){
 const d=new Uint8Array(await blob.arrayBuffer()),out=Object.create(null);
 const fail=()=>{throw new Error('Повреждённый или неполный ZIP')};
 let end=-1;
 for(let i=d.length-22;i>=Math.max(0,d.length-65557);i--)if(read32(d,i)===0x06054b50&&i+22+read16(d,i+20)===d.length){end=i;break;}
 if(end<0||read16(d,end+4)||read16(d,end+6))fail();
 const count=read16(d,end+10),size=read32(d,end+12),start=read32(d,end+16);
 if(count!==read16(d,end+8)||start+size!==end||count===65535)fail();
 let cursor=start,expectedLocal=0;
 for(let i=0;i<count;i++){
  if(cursor+46>end||read32(d,cursor)!==0x02014b50)fail();
  const flags=read16(d,cursor+8),method=read16(d,cursor+10),crc=read32(d,cursor+16),packed=read32(d,cursor+20),unpacked=read32(d,cursor+24),n=read16(d,cursor+28),extra=read16(d,cursor+30),comment=read16(d,cursor+32),local=read32(d,cursor+42);
  if(flags&9||method!==0)throw new Error('Поддерживается ZIP без шифрования и сжатия, созданный Knowledge Studio');
  if(packed!==unpacked||local!==expectedLocal||cursor+46+n+extra+comment>end||local+30>start)fail();
  const name=td.decode(d.subarray(cursor+46,cursor+46+n));
  if(!name||name.includes('..')||name.startsWith('/')||name.includes('\\')||name.includes(':')||name.includes(String.fromCharCode(0))||Object.hasOwn(out,name))throw new Error('Небезопасный или повторный путь в ZIP');
  if(read32(d,local)!==0x04034b50||read16(d,local+6)!==flags||read16(d,local+8)!==method||read32(d,local+14)!==crc||read32(d,local+18)!==packed||read32(d,local+22)!==unpacked)fail();
  const ln=read16(d,local+26),le=read16(d,local+28),body=local+30+ln+le;
  if(body+packed>start||td.decode(d.subarray(local+30,local+30+ln))!==name)fail();
  const bytes=d.slice(body,body+packed);if(crc32(bytes)!==crc)throw new Error('CRC: нарушена целостность ZIP');
  out[name]=bytes;expectedLocal=body+packed;cursor+=46+n+extra+comment;
 }
 if(cursor!==end||expectedLocal!==start)fail();return out;
}
