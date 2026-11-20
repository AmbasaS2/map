import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import {
    notebookPath, INDEX_PATH, readNotebookIndex, writeNotebookIndex,
    readNotebookSnapshot, writeNotebookSnapshot, backupLegacyNotebooks,
    readNotebookBackup,
} from './map-notebook-storage.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const source=readFileSync(join(root,'index.js'),'utf8');
const section=source.slice(source.indexOf('function getNotebookStore('),source.indexOf('function saveSettings() {'));
function sourceBetween(start,end) {
    const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
    assert.ok(a>=0 && b>a,'missing source section '+start);
    return source.slice(a,b);
}
const originalFetch=globalThis.fetch;
const originalReader=globalThis.FileReader;
class TestFileReader {
    async readAsDataURL(blob) {
        try {
            const data=Buffer.from(await blob.arrayBuffer());
            this.result='data:application/json;base64,'+data.toString('base64');
            this.onload?.();
        } catch(error) { this.error=error;this.onerror?.(); }
    }
}
globalThis.FileReader=TestFileReader;

function createServer() {
    const files=new Map();
    let persisted={extension_settings:{marauders_map:{}}};
    const actions=[];
    let failUpload=false, failSettings=false;
    const response=(status,value)=>({ok:status>=200&&status<300,status,
        json:async()=>structuredClone(value)});
    const fetchMock=async(url,opts={})=>{
        actions.push({url,method:opts.method||'GET'});
        if(url==='/api/files/verify') {
            const {urls}=JSON.parse(opts.body);
            return response(200,Object.fromEntries(urls.map(path=>[path,files.has(path)])));
        }
        if(url==='/api/files/upload') {
            if(failUpload) return response(500,{error:'synthetic upload failure'});
            const {name,data}=JSON.parse(opts.body);
            const file=JSON.parse(Buffer.from(data,'base64').toString('utf8'));
            const path='/user/files/'+name;
            files.set(path,file);
            return response(200,{path});
        }
        if(url==='/api/settings/get')
            return response(200,{settings:JSON.stringify(persisted)});
        if(url.startsWith('/user/files/')) {
            if(!files.has(url))return response(404,{error:'missing'});
            return response(200,files.get(url));
        }
        throw Error('Unexpected endpoint '+url);
    };
    return {
        files,actions,fetchMock,failUpload(v){failUpload=v;},
        failSettings(v){failSettings=v;},
        persist(settings) {if(failSettings)throw Error('synthetic settings persistence failure');
            persisted={extension_settings:{marauders_map:structuredClone(settings)}};},
        persisted(){return structuredClone(persisted)},
    };
}
function install(server) { globalThis.fetch=server.fetchMock; }
const headers={getRequestHeaders:()=>({'Content-Type':'application/json','X-CSRF-Token':'test'})};
function data(name='상점') {
    return {managedItems:[{id:'m1',title:name,status:'held'}],footstepProfiles:{},
        trackedPeople:{},recommendations:[],searchResults:[],createdAt:'now',updatedAt:'now'};
}

function makeController(settings,server) {
    const diagnostics=[];
    const sandbox={
        saveMemoryQueue:Promise.resolve(),
        fetch:server.fetchMock,
        getSettings:()=>settings,stContext:()=>headers,
        readNotebookIndex,writeNotebookIndex,readNotebookSnapshot,
        writeNotebookSnapshot,backupLegacyNotebooks,readNotebookBackup,
        getExistingMemory:()=>null,attachedNotebookMemories:new WeakSet(),
        attachCharacterNotebook:()=>{},syncExtensionPrompt:()=>{},
        getCurrentCharacterKey:()=> 'Remus',
        notebookHasData:book=>Boolean(book?.managedItems?.length || Object.keys(book?.trackedPeople||{}).length ||
            book?.recommendations?.length || book?.searchResults?.length || Object.keys(book?.footstepProfiles||{}).length),
        createEmptyNotebook:()=>({managedItems:[],footstepProfiles:{},trackedPeople:{},recommendations:[],searchResults:[],createdAt:'now',updatedAt:'now'}),
        createSharedNotebookResetToken:()=> 'reset-new',
        activeMapConfirmation:null,cancelActiveMapGeneration:()=>{},
        getExistingMemory:()=>null,
        toast:()=>{},pushDebugLog:()=>{},
        saveSillyTavernSettings:async()=>server.persist(settings),
        saveSettings:()=>{},pushDebugLog:(...x)=>diagnostics.push(x),
        toast:(...x)=>diagnostics.push(x),console,
    };
    vm.createContext(sandbox);
    vm.runInContext(
        'const MODULE_NAME="marauders_map";'
        +'let notebookFilesReady=false,notebookFiles=Object.create(null),notebookFileRevisions=Object.create(null),notebookFileIndex=null,notebookStorageInit=null,notebookStorageNoticeShown=false;'
        +section
        +sourceBetween('async function resetStoredCharacterNotebook(key) {','async function openStoredCharacterNotebookResetPopup() {')
        +'\nglobalThis.api={ensureNotebookStorage,getNotebookStore,writeCurrentNotebookFile,resetStoredCharacterNotebook,getState:()=>({ready:notebookFilesReady,cache:notebookFiles,revisions:notebookFileRevisions,index:notebookFileIndex})};'
    ,sandbox);
    return {...sandbox.api,diagnostics};
}

test('character files use stable ASCII names, not user-controlled paths',()=>{
    assert.match(notebookPath('리무스/../../시리우스'),/^\/user\/files\/map-notebook-[0-9a-f]{16}\.json$/);
    assert.equal(notebookPath('리무스'),notebookPath('리무스'));
    assert.notEqual(notebookPath('리무스'),notebookPath('시리우스'));
});
test('verified revisioned files and immutable backup round-trip multilingual records',async()=>{
    const server=createServer();install(server);
    const notebook=data('리무스의 마법 가게'),key='한국어/슬래시 ✨';
    const original={ [key]:notebook };
    const backup=await backupLegacyNotebooks(original,headers);
    assert.deepEqual(await readNotebookBackup(backup,headers),original);
    assert.equal(await writeNotebookSnapshot(key,notebook,0,headers),1);
    assert.deepEqual((await readNotebookSnapshot(key,headers)).notebook,notebook);
    await assert.rejects(writeNotebookSnapshot(key,data('나중 수정'),0,headers),/changed on another device/);
    assert.equal(await writeNotebookSnapshot(key,data('나중 수정'),1,headers),2);
    const index=await writeNotebookIndex([key,key],backup,headers);
    assert.deepEqual(index.keys,[key]);
    assert.deepEqual(await readNotebookIndex(headers),index);
    assert.equal(server.files.get(INDEX_PATH).backup,backup);
    assert.deepEqual((await readNotebookSnapshot(key,headers)).notebook,data('나중 수정'));
});
test('migrates settings into per-character files, verifies backup, then clears old settings',async()=>{
    const server=createServer();install(server);
    const original={Remus:data('리무스'),Sirius:data('시리우스')};
    const settings={theme:'marauder',characterNotebooks:structuredClone(original)};
    const controller=makeController(settings,server);
    assert.equal(await controller.ensureNotebookStorage(),true);
    assert.equal(controller.getState().ready,true);
    assert.equal(settings.characterNotebooks,undefined,'legacy is removed only after verification');
    assert.equal(settings.theme,'marauder','UI settings survive');
    const index=await readNotebookIndex(headers);
    assert.deepEqual([...index.keys].sort(),['Remus','Sirius']);
    assert.deepEqual(await readNotebookBackup(index.backup,headers),original);
    assert.deepEqual((await readNotebookSnapshot('Remus',headers)).notebook,original.Remus);
    assert.equal(server.persisted().extension_settings.marauders_map.characterNotebooks,undefined);
    assert.equal(server.persisted().extension_settings.marauders_map.notebookStorage.format,'server-files-v1');
    // Unchanged re-opening should not repeat full backup or write settings.
    const writes=server.actions.filter(a=>a.url==='/api/files/upload').length;
    await controller.ensureNotebookStorage();
    assert.equal(server.actions.filter(a=>a.url==='/api/files/upload').length,writes);
});
test('does not clear settings when even one server upload fails; later retry preserves originals',async()=>{
    const server=createServer();install(server);
    const original={Remus:data()};
    const settings={characterNotebooks:structuredClone(original)};
    const controller=makeController(settings,server);
    server.failUpload(true);
    await assert.rejects(controller.ensureNotebookStorage(),/request failed/);
    assert.deepEqual(settings.characterNotebooks,original);
    assert.equal(controller.getState().ready,false);
    server.failUpload(false);
    await controller.ensureNotebookStorage();
    assert.deepEqual((await readNotebookSnapshot('Remus',headers)).notebook,original.Remus);
    assert.equal(settings.characterNotebooks,undefined);
});
test('failed settings read-back never claims success or erases backup',async()=>{
    const server=createServer();install(server);
    const original={Remus:data()};
    const settings={characterNotebooks:structuredClone(original)};
    server.failSettings(true);
    const controller=makeController(settings,server);
    await assert.rejects(controller.ensureNotebookStorage(),/settings.json/);
    assert.equal(controller.getState().ready,false);
    assert.deepEqual(settings.characterNotebooks,original);
    const index=await readNotebookIndex(headers);
    assert.deepEqual(await readNotebookBackup(index.backup,headers),original);
    server.failSettings(false);
    await controller.ensureNotebookStorage();
    assert.equal(settings.characterNotebooks,undefined);
});
test('another device changing legacy settings does not overwrite newer server files',async()=>{
    const server=createServer();install(server);
    const firstSettings={characterNotebooks:{Remus:data('old')}};
    await makeController(firstSettings,server).ensureNotebookStorage();
    const secondSettings={notebookStorage:structuredClone(firstSettings.notebookStorage),
        characterNotebooks:{Remus:data('stale changed by old device')}};
    const controller=makeController(secondSettings,server);
    await assert.rejects(controller.ensureNotebookStorage(),/변경되었습니다|덮어쓰기를 중단|원본 백업 검증 실패/);
    assert.equal(controller.getState().ready,false);
    assert.deepEqual((await readNotebookSnapshot('Remus',headers)).notebook,data('old'));
    assert.deepEqual(secondSettings.characterNotebooks.Remus,data('stale changed by old device'));
});
test('subsequent tabs load verified server data without reintroducing settings copies',async()=>{
    const server=createServer();install(server);
    const settings={characterNotebooks:{Remus:data('legacy')}};
    await makeController(settings,server).ensureNotebookStorage();
    const secondSettings=server.persisted().extension_settings.marauders_map;
    const next=makeController(secondSettings,server);
    assert.equal(await next.ensureNotebookStorage(),true);
    assert.deepEqual(next.getState().cache.Remus,data('legacy'));
    assert.equal(secondSettings.characterNotebooks,undefined);
    const revisions=next.getState().revisions;
    assert.equal(revisions.Remus,1);
    next.getState().cache.Remus=data('new saved');
    await next.writeCurrentNotebookFile('Remus');
    assert.equal(next.getState().revisions.Remus,2);
    assert.equal((await readNotebookSnapshot('Remus',headers)).notebook.managedItems[0].title,'new saved');
});

test('new character registration updates index and survives another client load',async()=>{
    const server=createServer();install(server);
    const settings={};
    const first=makeController(settings,server);
    await first.ensureNotebookStorage();
    first.getState().cache.NewCharacter=data('새 캐릭터');
    await first.writeCurrentNotebookFile('NewCharacter');
    assert.equal((await readNotebookIndex(headers)).keys.includes('NewCharacter'),true);
    server.persist(settings);
    const second=makeController(server.persisted().extension_settings.marauders_map,server);
    await second.ensureNotebookStorage();
    assert.deepEqual(second.getState().cache.NewCharacter,data('새 캐릭터'));
});

test('reset only the selected character using a revisioned empty file; other notebooks remain',async()=>{
    const server=createServer();install(server);
    const settings={characterNotebooks:{Remus:data('리무스'),Sirius:data('시리우스')}};
    const controller=makeController(settings,server);
    await controller.ensureNotebookStorage();
    const prior=(await readNotebookSnapshot('Sirius',headers)).revision;
    assert.equal(await controller.resetStoredCharacterNotebook('Sirius'),true);
    const stored=await readNotebookSnapshot('Sirius',headers);
    assert.equal(stored.revision,prior+1);
    assert.deepEqual(stored.notebook.managedItems,[]);
    assert.equal(stored.notebook.resetToken,'reset-new');
    assert.deepEqual((await readNotebookSnapshot('Remus',headers)).notebook,data('리무스'));
    assert.equal(settings.characterNotebookResets.Sirius,'reset-new');
    assert.equal(server.persisted().extension_settings.marauders_map.characterNotebookResets.Sirius,'reset-new');
});

test('reset does not alter settings marker when another device has already advanced revision',async()=>{
    const server=createServer();install(server);
    const settings={characterNotebooks:{Remus:data('리무스'),Sirius:data('시리우스')}};
    const c=makeController(settings,server);
    await c.ensureNotebookStorage();
    await writeNotebookSnapshot('Sirius',data('다른 기기'),1,headers);
    await assert.rejects(c.resetStoredCharacterNotebook('Sirius'),/changed on another device/);
    assert.equal(settings.characterNotebookResets?.Sirius,undefined);
    assert.deepEqual((await readNotebookSnapshot('Sirius',headers)).notebook,data('다른 기기'));
});

test('a server-side reset token that conflicts with saved settings refuses to revive old chat copies',async()=>{
    const server=createServer();install(server);
    const settings={characterNotebooks:{Remus:data('리무스')}};
    await makeController(settings,server).ensureNotebookStorage();
    const stale=server.persisted().extension_settings.marauders_map;
    stale.characterNotebookResets={Remus:'reset-mismatched'};
    const c=makeController(stale,server);
    await assert.rejects(c.ensureNotebookStorage(),/초기화 기록과 저장 파일/);
    assert.equal(c.getState().ready,false);
    assert.deepEqual((await readNotebookSnapshot('Remus',headers)).notebook,data('리무스'));
});


function saveHarness(controller,server,memory) {
    let saved=0,savedSettings=0;
    const context={
        chatMetadata:{marauders_map_state:memory},
        saveMetadata:async()=>{saved++},
    };
    const settings={};
    const diagnostics=[];
    const sandbox={
        Promise,
        saveMemoryQueue:Promise.resolve(),saveMemorySequence:0,
        METADATA_KEY:'marauders_map_state',
        safeContext:()=>context,stContext:()=>context,getStableChatSignature:()=> 'chat-A',
        ensureNotebookStorage:()=>controller.ensureNotebookStorage(),
        ensureMemory:()=>memory,getSettings:()=>settings,getCurrentCharacterKey:()=> 'Remus',
        getCharacterNotebook:(_settings,key)=>({key,notebook:controller.getState().cache[key]||null}),
        clone:structuredClone,attachedNotebookFingerprints:new WeakMap(),
        persistCharacterNotebook:(value)=>{
            controller.getState().cache.Remus={
                ...data('edited'),managedItems:structuredClone(value.managedItems),
            };
            return true;
        },
        writeCurrentNotebookFile:key=>controller.writeCurrentNotebookFile(key),
        notebookFiles:controller.getState().cache,
        saveSillyTavernSettings:async()=>{savedSettings++},
        pushDebugLog:(...args)=>diagnostics.push(args),
        serializeForDebug:error=>String(error),
        toast:(...args)=>diagnostics.push(args),
        console:{warn:()=>{}},
    };
    vm.createContext(sandbox);
    vm.runInContext(sourceBetween('function saveMemory(memoryArg = null) {','function getCurrentCharacterName() {')
        +'\nglobalThis.runSave=saveMemory;',sandbox);
    return {save:()=>sandbox.runSave(memory),context,diagnostics,
        get saved(){return saved;},get savedSettings(){return savedSettings;}};
}

test('real Map save pipeline writes the one affected character file, not the complete ST settings',async()=>{
    const server=createServer();install(server);
    const settings={characterNotebooks:{Remus:data('original')}};
    const controller=makeController(settings,server);
    await controller.ensureNotebookStorage();
    const memory={sharedNotebookKey:'Remus',managedItems:[{id:'m1',title:'new',status:'injected'}],
        recommendations:[],searchResults:[],footstepProfiles:{},trackedPeople:{},
        map:{locations:[{id:'hall'}]},previousMap:{map:{locations:[{id:'old'}]}}};
    const h=saveHarness(controller,server,memory);
    const before=server.actions.length;
    assert.equal(await h.save(),true);
    assert.equal(h.saved,1,'chat metadata is persisted');
    assert.equal(h.savedSettings,0,'full SillyTavern settings writer is never called here');
    assert.equal((await readNotebookSnapshot('Remus',headers)).notebook.managedItems[0].title,'new');
    const calls=server.actions.slice(before);
    assert.equal(calls.filter(call=>call.url==='/api/files/upload').length,1,
        'only one character file is uploaded');
    assert.deepEqual(memory.previousMap,{map:{locations:[{id:'old'}]}},
        'map rollback snapshot must not change');
});

test('stale server revision fails without overwriting newer data or writing chat metadata',async()=>{
    const server=createServer();install(server);
    const settings={characterNotebooks:{Remus:data('original')}};
    const controller=makeController(settings,server);
    await controller.ensureNotebookStorage();
    const memory={sharedNotebookKey:'Remus',managedItems:[{id:'m1',title:'my edit',status:'held'}],
        recommendations:[],searchResults:[],footstepProfiles:{},trackedPeople:{}};
    const h=saveHarness(controller,server,memory);
    await writeNotebookSnapshot('Remus',data('other device'),1,headers);
    assert.equal(await h.save(),false);
    assert.equal(h.saved,0);
    assert.equal(h.savedSettings,0);
    assert.equal((await readNotebookSnapshot('Remus',headers)).notebook.managedItems[0].title,'other device');
    assert.equal(controller.getState().cache.Remus.managedItems[0].title,'original',
        'in-memory shared cache rolls back after failed write');
    assert.equal(memory.managedItems[0].title,'my edit','unsaved user edit remains in memory');
});


test('missing index after completed migration stops instead of creating a blank store',async()=>{
    const server=createServer();install(server);
    const settings={characterNotebooks:{Remus:data('old')}};
    await makeController(settings,server).ensureNotebookStorage();
    server.files.delete(INDEX_PATH);
    const next=makeController(server.persisted().extension_settings.marauders_map,server);
    await assert.rejects(next.ensureNotebookStorage(),/인덱스 파일이 사라졌습니다/);
    assert.equal(next.getState().ready,false);
    assert.equal((await readNotebookSnapshot('Remus',headers)).notebook.managedItems[0].title,'old');
});

test('missing character file prevents loading and never erases server index',async()=>{
    const server=createServer();install(server);
    const settings={characterNotebooks:{Remus:data('old')}};
    await makeController(settings,server).ensureNotebookStorage();
    server.files.delete(notebookPath('Remus'));
    const next=makeController(server.persisted().extension_settings.marauders_map,server);
    await assert.rejects(next.ensureNotebookStorage(),/수첩 파일 누락/);
    assert.equal(next.getState().ready,false);
    assert.deepEqual((await readNotebookIndex(headers)).keys,['Remus']);
});

test('read-back mismatch blocks migration and leaves original settings unchanged',async()=>{
    const server=createServer();install(server);
    const raw=server.fetchMock;
    // Return a successful path but a corrupted stored payload for upload
    // read-back verification. Old settings must stay untouched.
    server.fetchMock=async(url,opts)=>{
        const result=await raw(url,opts);
        if(url==='/api/files/upload'&&result.ok){
            const {name}=JSON.parse(opts.body);
            server.files.set('/user/files/'+name,{unexpected:'corruption'});
        }
        return result;
    };
    install(server);
    const settings={characterNotebooks:{Remus:data('old')}};
    const controller=makeController(settings,server);
    await assert.rejects(controller.ensureNotebookStorage(),/read-back verification failed/);
    assert.equal(controller.getState().ready,false);
    assert.deepEqual(settings.characterNotebooks.Remus,data('old'));
});


test('production notebook writer updates file-backed cache without recreating legacy settings',()=>{
    const settings={theme:'bonbon',notebookStorage:{format:'server-files-v1',backup:'/user/files/map-notebook-legacy-abc.json',cleared:false}};
    const cache=Object.create(null);
    cache.Remus=data('before');
    const sandbox={
        settings,
        notebookFilesReady:true,notebookFiles:cache,
        SHARED_NOTEBOOK_KEYS:['managedItems','footstepProfiles','trackedPeople','recommendations','searchResults'],
        attachedNotebookFingerprints:new WeakMap(),
        getSettings:()=>settings,getCurrentCharacterKey:()=> 'Remus',
        getNotebookStore:()=>cache,
        getSharedNotebookResetToken:()=> '',
        sharedNotebookFingerprint:source=>JSON.stringify(Object.fromEntries(
            ['managedItems','footstepProfiles','trackedPeople','recommendations','searchResults'].map(key=>[key,source[key]]))),
        notebookHasData:source=>Boolean(source.managedItems?.length),
        createEmptyNotebook:()=>data(''),
        cloneSharedNotebookData:source=>Object.fromEntries(
            ['managedItems','footstepProfiles','trackedPeople','recommendations','searchResults'].map(key=>[key,structuredClone(source[key])])),
        nowStamp:()=> 'today',
    };
    vm.createContext(sandbox);
    vm.runInContext(sourceBetween('function getCharacterNotebook(settings = getSettings()', 'function getSharedNotebookResetToken(')
        +sourceBetween('function persistCharacterNotebook(memory) {','function enforceSingleQuestPerLocation(')
        +'\nglobalThis.persist=persistCharacterNotebook;',sandbox);
    const memory={
        sharedNotebookKey:'Remus',managedItems:[{id:'m1',title:'new',status:'held'}],
        footstepProfiles:{},trackedPeople:{},recommendations:[],searchResults:[],
    };
    assert.equal(sandbox.persist(memory),true);
    assert.equal(cache.Remus.managedItems[0].title,'new');
    assert.equal(settings.characterNotebooks,undefined);
    assert.equal(sandbox.persist(memory),false,'unchanged shared copy does not schedule more file writes');
    assert.equal(settings.theme,'bonbon');
});


test('large migration keeps dozens of long shared notebooks separated instead of inflating settings',async()=>{
    const server=createServer();install(server);
    const owners=Array.from({length:40},(_,i)=> '캐릭터-'+String(i).padStart(2,'0'));
    const original=Object.fromEntries(owners.map((owner,i)=>[owner,{
        ...data('장소 '+i),managedItems:[{
            id:'long-'+i,title:'시리우스',status:'held',
            englishContext:'상황과 문맥 '.repeat(900),
        }],
    }]));
    const settings={theme:'marauder',characterNotebooks:structuredClone(original)};
    const c=makeController(settings,server);
    assert.equal(await c.ensureNotebookStorage(),true);
    const index=await readNotebookIndex(headers);
    assert.equal(index.keys.length,40);
    assert.equal(server.files.size,42,'40 owner files + 1 index + 1 original backup');
    assert.equal(settings.characterNotebooks,undefined);
    assert.equal(JSON.stringify(server.persisted().extension_settings.marauders_map).includes('englishContext'),false);
    assert.equal((await readNotebookSnapshot(owners[23],headers)).notebook.managedItems[0].englishContext,
        original[owners[23]].managedItems[0].englishContext);
    assert.deepEqual(await readNotebookBackup(index.backup,headers),original);
});
test.after(()=>{
    globalThis.fetch=originalFetch;
    globalThis.FileReader=originalReader;
});
