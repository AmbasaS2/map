/*
 * Character-shared Map notebook storage. SillyTavern's per-user /api/files
 * endpoints keep large notebook data out of settings.json and synchronize
 * across devices that connect to the same SillyTavern server.
 * No browser-local storage, external service, or server plugin is required.
 */
export const NOTEBOOK_FORMAT = 'map-notebook-v1';
export const INDEX_FORMAT = 'map-notebook-index-v1';
export const BACKUP_FORMAT = 'map-notebook-legacy-backup-v1';
export const INDEX_PATH = '/user/files/map-notebook-index-v1.json';
const PREFIX = '/user/files/';

function stableHash(value) {
    let a = 0x811c9dc5;
    let b = 0x85ebca6b;
    for (const point of String(value)) {
        const code = point.codePointAt(0);
        a = Math.imul(a ^ code, 0x01000193) >>> 0;
        b = Math.imul(b ^ (code & 65535), 0x27d4eb2d) >>> 0;
        b = Math.imul(b ^ (code >>> 16), 0x27d4eb2d) >>> 0;
    }
    return a.toString(16).padStart(8,'0') + b.toString(16).padStart(8,'0');
}

export function notebookPath(key) {
    if (typeof key !== 'string' || !key) throw new Error('Missing notebook character key');
    return PREFIX + 'map-notebook-' + stableHash(key) + '.json';
}
function headers(context) {
    const result = context?.getRequestHeaders?.();
    if (!result) throw new Error('SillyTavern file request headers are not available');
    return result;
}
async function post(url, data, context) {
    const result = await fetch(url,{method:'POST',headers:headers(context),body:JSON.stringify(data),cache:'no-store'});
    if (!result.ok) throw new Error('Map notebook request failed (' + result.status + ', ' + url + ')');
    return await result.json();
}
async function exists(path,context) {
    const result = await post('/api/files/verify',{urls:[path]},context);
    return result?.[path] === true;
}
async function read(path,context) {
    if (!await exists(path,context)) return null;
    const result = await fetch(path,{method:'GET',headers:headers(context),cache:'no-store'});
    if (!result.ok) throw new Error('Map notebook read failed (' + result.status + ', ' + path + ')');
    try { return await result.json(); }
    catch { throw new Error('Map notebook file is not valid JSON (' + path + ')'); }
}
function equal(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
async function encodedJSON(value) {
    const raw = JSON.stringify(value);
    if (typeof raw !== 'string') throw new Error('Invalid notebook JSON value');
    return await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onerror=()=>reject(reader.error || Error('Map notebook encoding failed'));
        reader.onload=()=>{
            const url=String(reader.result || '');
            const index=url.indexOf(',');
            if(index<0)return reject(Error('Invalid map notebook encoded URL'));
            resolve(url.slice(index+1));
        };
        reader.readAsDataURL(new Blob([raw],{type:'application/json'}));
    });
}
async function write(path,value,context) {
    if(!/^\/user\/files\/map-notebook-[A-Za-z0-9_-]+\.json$/.test(path))throw Error('Invalid map notebook file path');
    const name=path.slice(PREFIX.length);
    const saved=await post('/api/files/upload',{name,data:await encodedJSON(value)},context);
    if(saved?.path!==path)throw Error('Map notebook write returned an unexpected file path');
    const verified=await read(path,context);
    if(!equal(value,verified))throw Error('Map notebook read-back verification failed');
    return path;
}
function validIndex(value) {
    if (!value || value.format!==INDEX_FORMAT || !Array.isArray(value.keys)
        || value.keys.some(k=>typeof k!=='string'||!k)
        || new Set(value.keys).size!==value.keys.length
        || (value.backup!==undefined && typeof value.backup!=='string'))
        throw Error('Invalid map notebook index');
    return {format:INDEX_FORMAT,keys:[...value.keys],backup:String(value.backup||'')};
}
export async function readNotebookIndex(context) {
    const value=await read(INDEX_PATH,context);
    return value===null ? null : validIndex(value);
}
export async function writeNotebookIndex(keys,backup,context) {
    const value=validIndex({format:INDEX_FORMAT,keys:[...new Set(keys)].sort(),backup});
    await write(INDEX_PATH,value,context);
    return value;
}
function validSnapshot(key,value) {
    if(value===null)return null;
    if(!value || value.format!==NOTEBOOK_FORMAT || value.key!==key ||
        !Number.isSafeInteger(value.revision) || value.revision<1 ||
        !value.notebook || typeof value.notebook!=='object' || Array.isArray(value.notebook))
        throw Error('Invalid/mismatched map notebook file: '+key);
    return value;
}
export async function readNotebookSnapshot(key,context) {
    const item=validSnapshot(key,await read(notebookPath(key),context));
    return item ? {notebook:item.notebook,revision:item.revision} : null;
}
export async function writeNotebookSnapshot(key,notebook,expectedRevision,context) {
    if(!notebook || typeof notebook!=='object' || Array.isArray(notebook))throw Error('Invalid map notebook data');
    if(!Number.isSafeInteger(expectedRevision) || expectedRevision<0)throw Error('Invalid map notebook revision');
    const prior=await readNotebookSnapshot(key,context);
    if((prior?.revision || 0)!==expectedRevision)
        throw Error('Map notebook changed on another device. Refusing stale overwrite: '+key);
    const value={format:NOTEBOOK_FORMAT,key,revision:expectedRevision+1,
        savedAt:new Date().toISOString(),notebook};
    await write(notebookPath(key),value,context);
    return value.revision;
}
export async function backupLegacyNotebooks(legacy,context) {
    if(!legacy || typeof legacy!=='object' || Array.isArray(legacy))throw Error('Invalid legacy map notebook store');
    const filename='map-notebook-legacy-'+Date.now()+'-'+Math.random().toString(36).slice(2,9)+'.json';
    const path=PREFIX+filename;
    await write(path,{format:BACKUP_FORMAT,createdAt:new Date().toISOString(),characterNotebooks:legacy},context);
    return path;
}
export async function readNotebookBackup(path,context) {
    if(!/^\/user\/files\/map-notebook-legacy-[A-Za-z0-9_-]+\.json$/.test(path))
        throw Error('Invalid map notebook backup path');
    const result=await read(path,context);
    if(!result || result.format!==BACKUP_FORMAT ||
        !result.characterNotebooks || typeof result.characterNotebooks!=='object' ||
        Array.isArray(result.characterNotebooks)) throw Error('Map notebook backup is missing/invalid');
    return result.characterNotebooks;
}
