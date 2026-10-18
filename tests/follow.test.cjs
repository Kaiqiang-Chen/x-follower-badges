const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const read=n=>fs.readFileSync(require('node:path').join(__dirname,'../extension',n),'utf8');
const pause=(ms=300)=>new Promise(r=>setTimeout(r,ms));
function fixture({trusted=true,name='Alice',extra=''}={}) {
 const dom=new JSDOM(`<a data-testid="AppTabBar_Profile_Link" href="/Me"></a><article data-testid="tweet"><div data-testid="User-Name"><div><a href="/${name}">${name}</a></div><div><a href="/${name}">@${name}</a></div></div><button data-testid="caret">More</button>${extra}</article>`,{url:'https://x.com/home',runScripts:'outside-only'});
 const w=dom.window;w.confirm=()=>true;let settings;
 w.chrome={storage:{local:{get:async d=>d},onChanged:{addListener:f=>settings=f}}};
 // jsdom cannot emit trusted pointer events; replace only this gate in action tests.
 w.eval(trusted?read('follow.js').replace('if (event.isTrusted) follow(', 'if (true) follow('):read('follow.js'));
 const send=(users,confirmed=false)=>w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:'https://x.com',data:{source:'x-follower-badges-v1',type:'relationships',users,confirmed}}));
 const menu=(text,click)=>{
  const caret=w.document.querySelector('[data-testid=caret]');
  caret.addEventListener('click',()=>{
   const existing=w.document.querySelector('[role=menu]');if(existing){existing.remove();return;}
   const m=w.document.createElement('div');m.setAttribute('role','menu');const item=w.document.createElement('div');item.setAttribute('role','menuitem');item.textContent=text;m.append(item);w.document.body.append(m);
   item.onclick=()=>{m.remove();click?.()};
  });
 };
 return {dom,w,send,menu,settings:(v)=>settings({followEnabled:{newValue:v}},'local'),button:()=>w.document.querySelector('.xfb-follow')};
}
test('one author button, no quote button, no self button; settings and recycled rows',async()=>{
 const f=fixture({extra:'<div data-testid="User-Name"><a href="/Quote">Quote</a></div>'});await pause();assert.equal(f.w.document.querySelectorAll('.xfb-follow').length,1);
 assert.equal(f.button().dataset.handle,'alice');f.settings(false);await pause();assert.equal(f.button(),null);f.settings(true);await pause();
 f.w.document.querySelectorAll('[data-testid="User-Name"] a[href="/Alice"]').forEach(a=>a.href='/Me');await pause();assert.equal(f.button(),null);f.w.close();
});
test('successful native follow is confirmed by response, and duplicate clicks do not double-submit',async()=>{
 const f=fixture();let calls=0;f.menu('关注 @Alice',()=>calls++);await pause();f.button().click();f.button().click();await pause();
 assert.equal(calls,1);assert.equal(f.button().textContent,'关注中…');f.send([{name:'Alice',following:true,requested:false}],true);await pause();assert.equal(f.button().textContent,'已关注');assert.equal(f.button().disabled,false);f.w.close();
});
test('already-followed native menu never clicks Unfollow',async()=>{
 const f=fixture();let calls=0;f.menu('取消关注 @Alice',()=>calls++);await pause();f.button().click();await pause();assert.equal(calls,0);assert.equal(f.button().textContent,'已关注');assert.equal(f.w.document.querySelector('[role=menu]'),null);f.w.close();
});
test('private-account response displays requested instead of followed',async()=>{
 const f=fixture();f.menu('Follow @Alice');await pause();f.button().click();await pause();f.send([{name:'Alice',following:false,requested:true}],true);await pause();assert.equal(f.button().textContent,'已申请');f.w.close();
});
test('page-script-generated clicks cannot initiate a follow',async()=>{
 const f=fixture({trusted:false});let opened=0;f.w.document.querySelector('[data-testid=caret]').onclick=()=>opened++;await pause();f.button().click();await pause();assert.equal(opened,0);f.w.close();
});
test('wrong author menu never triggers a follow',async()=>{
 const f=fixture();let calls=0;f.menu('关注 @Alice2',()=>calls++);await pause();f.button().click();await pause(2900);assert.equal(calls,0);assert.equal(f.button().disabled,false);assert.match(f.w.document.querySelector('.xfb-toast').textContent,/未找到/);f.w.close();
});
test('network observer extracts relationship state without follower counts and confirms native follow responses',async()=>{
 const dom=new JSDOM('',{url:'https://x.com/home',runScripts:'outside-only'});const w=dom.window,messages=[];w.postMessage=d=>messages.push(d);
 let url='https://x.com/i/api/graphql/x/HomeTimeline',data={core:{screen_name:'Alice'},relationship_perspectives:{following:false,follow_request_sent:false}};
 w.fetch=()=>Promise.resolve({url,ok:true,clone:()=>({json:async()=>data})});w.eval(read('interceptor.js'));await w.fetch('/');await pause();
 assert.ok(messages.some(m=>m.type==='relationships'&&m.users[0].following===false&&!m.confirmed));
 url='https://x.com/i/api/1.1/friendships/create.json';data={screen_name:'Alice',following:true,follow_request_sent:false};await w.fetch('/');await pause();
 assert.ok(messages.some(m=>m.type==='relationships'&&m.users[0].following===true&&m.confirmed));w.close();
});
test('unconfirmed follow times out without showing false success',async()=>{
 const f=fixture();const original=f.w.setTimeout.bind(f.w);f.w.setTimeout=(fn,ms)=>original(fn,ms===10000?250:ms);
 f.menu('关注 @Alice');await pause();f.button().click();await pause(600);assert.equal(f.button().textContent,'＋关注');assert.equal(f.button().disabled,false);assert.match(f.w.document.querySelector('.xfb-toast').textContent,/尚未确认/);f.w.close();
});
test('timeline response started before a follow cannot revert its relationship result',async()=>{
 const dom=new JSDOM('',{url:'https://x.com/home',runScripts:'outside-only'});const w=dom.window,messages=[];w.postMessage=d=>messages.push(d);
 let finishOld;w.fetch=url=>url==='old'?new Promise(resolve=>finishOld=resolve):Promise.resolve({url:'https://x.com/i/api/1.1/friendships/create.json',ok:true,clone:()=>({json:async()=>({screen_name:'Alice',following:true})})});
 w.eval(read('interceptor.js'));w.fetch('old');await w.fetch('follow');await pause();
 finishOld({url:'https://x.com/i/api/graphql/x/HomeTimeline',ok:true,clone:()=>({json:async()=>({screen_name:'Alice',following:false})})});await pause();
 assert.equal(messages.filter(m=>m.type==='relationships').length,1);assert.equal(messages.find(m=>m.type==='relationships').users[0].following,true);w.close();
});
function confirmation(f) {
 const d=f.w.document.createElement('div');d.setAttribute('role','dialog');
 d.innerHTML='<button data-testid="confirmationSheetConfirm">Unfollow</button><button data-testid="confirmationSheetCancel">Cancel</button>';
 f.w.document.body.append(d);
 d.querySelector('[data-testid=confirmationSheetCancel]').onclick=()=>d.remove();
 return d;
}
test('followed button opens native confirmation; cancel keeps following',async()=>{
 const f=fixture();let dialog,calls=0;f.send([{name:'Alice',following:true,requested:false}]);f.menu('取消关注 @Alice',()=>{calls++;dialog=confirmation(f)});await pause();
 assert.equal(f.button().disabled,false);assert.match(f.button().title,/取消关注/);f.button().click();await pause();assert.equal(calls,1);assert.equal(f.button().textContent,'取关中…');
 dialog.querySelector('[data-testid=confirmationSheetCancel]').click();await pause();assert.equal(f.button().textContent,'已关注');assert.equal(f.button().disabled,false);f.w.close();
});
test('unfollow waits for user confirmation and successful response before showing follow again',async()=>{
 const f=fixture();let dialog;f.send([{name:'Alice',following:true,requested:false}]);f.menu('Unfollow @Alice',()=>{dialog=confirmation(f)});await pause();f.button().click();await pause();
 assert.equal(f.button().textContent,'取关中…');dialog.querySelector('[data-testid=confirmationSheetConfirm]').onclick=()=>dialog.remove();dialog.querySelector('[data-testid=confirmationSheetConfirm]').click();await pause();assert.equal(f.button().textContent,'取关中…');
 f.send([{name:'Alice',following:false,requested:false}],true);await pause();assert.equal(f.button().textContent,'＋关注');assert.match(f.w.document.querySelector('.xfb-toast').textContent,/已取消关注/);f.w.close();
});
test('stale followed state never causes an unintended new follow',async()=>{
 const f=fixture();let calls=0;f.send([{name:'Alice',following:true,requested:false}]);f.menu('Follow @Alice',()=>calls++);await pause();f.button().click();await pause();assert.equal(calls,0);assert.equal(f.button().textContent,'＋关注');f.w.close();
});
test('mutual is shown only for two-way follow and remains clickable',async()=>{
 const f=fixture();f.send([{name:'Alice',following:true}]);await pause();assert.equal(f.button().textContent,'已关注');
 f.send([{name:'Alice',followedBy:true}]);await pause();assert.equal(f.button().textContent,'互关');assert.equal(f.button().disabled,false);
 f.send([{name:'Alice',following:false}]);await pause();assert.equal(f.button().textContent,'＋关注');
 f.send([{name:'Alice',following:true}]);await pause();assert.equal(f.button().textContent,'互关');
 f.send([{name:'Alice',followedBy:false}]);await pause();assert.equal(f.button().textContent,'已关注');f.w.close();
});
test('observer preserves followed-by when mutation response omits it and supports both user schemas',async()=>{
 const dom=new JSDOM('',{url:'https://x.com/home',runScripts:'outside-only'});const w=dom.window,messages=[];w.postMessage=d=>messages.push(d);
 let url='https://x.com/i/api/graphql/x/HomeTimeline',data={a:{core:{screen_name:'Alice'},relationship_perspectives:{following:true,followed_by:true}},b:{legacy:{screen_name:'Bob',following:true,followed_by:false}}};
 w.fetch=()=>Promise.resolve({url,ok:true,clone:()=>({json:async()=>data})});w.eval(read('interceptor.js'));await w.fetch('/');await pause();
 const users=messages.filter(m=>m.type==='relationships').flatMap(m=>m.users);assert.equal(users.find(u=>u.name==='Alice').followedBy,true);assert.equal(users.find(u=>u.name==='Bob').followedBy,false);
 url='https://x.com/i/api/1.1/friendships/destroy.json';data={screen_name:'Alice',following:false};await w.fetch('/');await pause();
 const result=messages.filter(m=>m.type==='relationships').at(-1);assert.equal(result.confirmed,true);assert.equal(result.users[0].followedBy,true);assert.equal(result.users[0].following,false);w.close();
});
test('extension confirmation cancellation does not open menu or change relationship',async()=>{
 const f=fixture();let opened=0;f.w.confirm=()=>false;f.send([{name:'Alice',following:true,followedBy:true}]);f.w.document.querySelector('[data-testid=caret]').onclick=()=>opened++;await pause();f.button().click();await pause();assert.equal(opened,0);assert.equal(f.button().textContent,'互关');f.w.close();
});
test('real X native success notices confirm unfollow and manual refollow',async()=>{
 const f=fixture();f.send([{name:'Alice',following:true,followedBy:true}]);f.menu('取消关注 @Alice',()=>{
 const toast=f.w.document.createElement('div');toast.textContent='你取消关注了 @Alice';f.w.document.body.append(toast);
 });await pause();f.button().click();await pause();assert.equal(f.button().textContent,'＋关注');assert.equal(f.button().disabled,false);
 const toast=f.w.document.createElement('div');toast.textContent='你关注了 @Alice';f.w.document.body.append(toast);await pause();assert.equal(f.button().textContent,'互关');
 f.send([{name:'Alice',following:false}]);await pause();assert.equal(f.button().textContent,'互关');f.w.close();
});
test('split native toast text assembled in nested spans confirms success',async()=>{
 const f=fixture();f.send([{name:'Alice',following:true,followedBy:true}]);
 f.menu('取消关注 @Alice',()=>{const box=f.w.document.createElement('div');box.innerHTML='<div><span>你取消关注了 </span><a><span></span></a></div>';f.w.document.body.append(box);box.querySelector('a span').append(f.w.document.createTextNode('@Alice'));});
 await pause();f.button().click();await pause();assert.equal(f.button().textContent,'＋关注');assert.equal(f.button().disabled,false);f.w.close();
});
test('late fresh relationship state clears stale tooltip and timeout toast',async()=>{
 const f=fixture();f.send([{name:'Alice',following:true}]);const original=f.w.setTimeout.bind(f.w);f.w.setTimeout=(fn,ms)=>original(fn,ms===10000?250:ms);f.menu('取消关注 @Alice');await pause();f.button().click();await pause(600);assert.match(f.button().title,/尚未确认/);
 f.send([{name:'Alice',following:false}]);await pause();assert.equal(f.button().textContent,'＋关注');assert.doesNotMatch(f.button().title,/尚未确认/);assert.equal(f.w.document.querySelector('.xfb-toast'),null);f.w.close();
});
