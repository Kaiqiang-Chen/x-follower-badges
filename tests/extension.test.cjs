const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '../extension');
const core = require(path.join(root, 'core.js'));
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const pause = () => new Promise(r => setTimeout(r,200));
function env(html='') {
 const dom = new JSDOM(html,{url:'https://x.com/home',runScripts:'outside-only'});
 dom.window.eval(read('core.js')); return dom;
}
test('extracts old and new X user schemas, zero counts, and excludes malformed values',()=>{
 const data={a:{legacy:{screen_name:'Alice',followers_count:174000}},b:{core:{screen_name:'Bob'},legacy:{followers_count:0}},c:{screen_name:'Charlie',followers_count:42},bad:{screen_name:'BAD',followers_count:-1}};
 data.self=data;
 assert.deepEqual(core.extract(data).sort((a,b)=>a.name.localeCompare(b.name)),[{name:'Alice',count:174000},{name:'Bob',count:0},{name:'Charlie',count:42}]);
 assert.equal(core.format(174000),'17.4万'); assert.equal(core.format(174000,'exact'),'174,000'); assert.equal(core.format(0),'0'); assert.equal(core.profile('https://evil.com/Alice'),null); assert.equal(core.profile('/Alice'),'alice');
});
test('fetch and XHR observation preserves original response and isolates malformed JSON',async()=>{
 const dom=env(); const w=dom.window, messages=[];
 w.postMessage=data=>messages.push(data);
 let cloneCount=0;
 const response={url:'https://x.com/i/api/graphql/abc/HomeTimeline',clone(){cloneCount++;return {json:async()=>({u:{core:{screen_name:'Alice'},legacy:{followers_count:27}}})}}};
 const originalPromise=Promise.resolve(response);
 w.fetch=()=>originalPromise;
 class XHR extends w.EventTarget {open(method,url){this.responseURL=url;} }
 w.XMLHttpRequest=XHR;
 w.eval(read('interceptor.js'));
 assert.equal(w.fetch('/foo'),originalPromise);
 assert.equal(await w.fetch('/foo'),response);
 const xhr=new XHR(); xhr.open('GET','https://x.com/i/api/graphql/a/Followers'); xhr.responseType='json'; xhr.response={screen_name:'Bob',followers_count:0}; xhr.dispatchEvent(new w.Event('load'));
 await pause();
 assert.equal(cloneCount,2);
 const users=messages.flatMap(m=>m.users||[]);
 assert.ok(users.some(u=>u.name==='Alice'&&u.count===27)); assert.ok(users.some(u=>u.name==='Bob'&&u.count===0));
 xhr.responseType='';xhr.responseText='not json';assert.doesNotThrow(()=>xhr.dispatchEvent(new w.Event('load')));
 dom.window.close();
});
test('DOM badges render, update, survive recycled cells, and respond to settings',async()=>{
 const dom=env('<div data-testid="User-Name"><a href="/Alice">Alice</a><a href="/Alice">@Alice</a></div><div data-testid="UserCell"><a href="/Bob"><img></a><a href="/Bob"><span>Bob</span><span>@Bob</span></a></div>');
 const w=dom.window;let onSettings;
 w.chrome={storage:{local:{get:async defaults=>defaults},onChanged:{addListener:fn=>onSettings=fn}},runtime:{onMessage:{addListener(){}}}};
 w.eval(read('content.js'));
 const send=users=>w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:'https://x.com',data:{source:'x-follower-badges-v1',type:'users',users}}));
 send([{name:'Alice',count:174000},{name:'Bob',count:0}]); await pause();
 assert.equal(w.document.querySelectorAll('.xfb-badge').length,2);
 assert.equal(w.document.querySelector('.xfb-badge').textContent,'粉丝 17.4万');
 send([{name:'Alice',count:175000}]);await pause();assert.equal(w.document.querySelector('.xfb-badge').textContent,'粉丝 17.5万');
 const row=w.document.querySelector('[data-testid="User-Name"]');row.querySelectorAll('a').forEach(a=>{a.href='/Charlie';a.textContent='Charlie';});await pause();assert.equal(row.querySelector('.xfb-badge'),null);
 send([{name:'Charlie',count:45678}]);await pause();assert.equal(row.querySelector('.xfb-badge').textContent,'粉丝 4.6万');
 onSettings({format:{newValue:'exact'}},'local');await pause();assert.equal(row.querySelector('.xfb-badge').textContent,'粉丝 45,678');
 onSettings({enabled:{newValue:false}},'local');await pause();assert.equal(w.document.querySelectorAll('.xfb-badge').length,0);
 onSettings({enabled:{newValue:true}},'local');await pause();assert.equal(w.document.querySelectorAll('.xfb-badge').length,2);
 dom.window.close();
});
test('manifest uses only storage permission and existing script files',()=>{
 const m=JSON.parse(read('manifest.json')); assert.equal(m.manifest_version,3);assert.deepEqual(m.permissions,['storage']);
 for(const script of m.content_scripts) for(const f of [...script.js,...script.css||[]]) assert.ok(fs.existsSync(path.join(root,f)));
});
test('current X relationship_counts schema is associated with its own user',()=>{
 const data={result:{__typename:'User',core:{screen_name:'NewUser'},relationship_counts:{followers:33079,following:103}},other:{core:{screen_name:'Zero'},relationship_counts:{followers:0}}};
 assert.deepEqual(core.extract(data).sort((a,b)=>a.name.localeCompare(b.name)),[{name:'NewUser',count:33079},{name:'Zero',count:0}]);
});
test('realistic X columns: timeline badge stays between author and handle; list badge follows verification',async()=>{
 const dom=env('<div data-testid="User-Name"><div id="author"><div><a href="/Alice">Alice</a></div></div><div id="handle"><a href="/Alice">@Alice</a></div></div><div data-testid="UserCell"><div><div><a href="/Bob"><div id="name-row" style="display:flex;flex-direction:row"><span>Bob</span><svg aria-label="Verified account"></svg></div></a></div><div><a href="/Bob">@Bob</a></div></div><button>Follow</button></div><div data-testid="User-Name"><div id="quote-name">Charlie</div><div><span>@Charlie</span></div></div>');
 const w=dom.window;w.chrome={storage:{local:{get:async d=>d},onChanged:{addListener(){}}},runtime:{onMessage:{addListener(){}}}};
 w.eval(read('content.js'));
 w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:'https://x.com',data:{source:'x-follower-badges-v1',type:'users',users:[{name:'Alice',count:10},{name:'Bob',count:20},{name:'Charlie',count:30}]}}));
 await pause();
 assert.equal(w.document.querySelector('#author').nextElementSibling.className,'xfb-badge');
 assert.equal(w.document.querySelector('#name-row').lastElementChild.className,'xfb-badge');
 assert.equal(w.document.querySelector('#quote-name').nextElementSibling.className,'xfb-badge');
 assert.equal(w.document.querySelectorAll('.xfb-badge').length,3);
 w.close();
});
test('expanded post header retains two rows and places badge alongside name and affiliation',async()=>{
 const dom=env('<div data-testid="User-Name" style="display:flex;flex-direction:column"><div id="detail-name" style="display:flex"><a href="/Alice">Alice<svg aria-label="Verified account"></svg></a><a href="/Brand">Brand</a></div><div id="detail-handle"><a href="/Alice">@Alice</a></div></div>');
 const w=dom.window;w.chrome={storage:{local:{get:async d=>d},onChanged:{addListener(){}}},runtime:{onMessage:{addListener(){}}}};
 w.eval(read('content.js'));
 w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:'https://x.com',data:{source:'x-follower-badges-v1',type:'users',users:[{name:'Alice',count:1402}]}}));
 await pause();
 assert.equal(w.document.querySelector('.xfb-badge').parentElement.id,'detail-name');
 assert.equal(w.document.querySelector('[data-testid="User-Name"]').children.length,2);
 assert.equal(w.document.querySelector('#detail-name').classList.contains('xfb-name-row'),true);
 w.close();
});
