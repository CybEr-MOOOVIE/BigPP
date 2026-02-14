// Configuration - FILL these before deploying
const ABLY_API_KEY = 'REPLACE_WITH_YOUR_ABLY_KEY'; // Ably Realtime key (token / key)
const ROOM = new URLSearchParams(location.search).get('room') || 'main';
const DEMO_PASSWORD = 'changeme'; // client-side password (not secure) - change before publishing

// VidFast defaults: use URL params: ?type=movie&id=533535  or ?type=tv&id=63174&season=1&episode=1
const mediaType = new URLSearchParams(location.search).get('type') || 'movie';
const mediaId = new URLSearchParams(location.search).get('id') || '533535';
const season = new URLSearchParams(location.search).get('season');
const episode = new URLSearchParams(location.search).get('episode');

// Allowed VidFast origins
const vidfastOrigins = [
  'https://vidfast.pro','https://vidfast.in','https://vidfast.io','https://vidfast.me','https://vidfast.net','https://vidfast.pm','https://vidfast.xyz'
];

// DOM
const passwordOverlay = () => document.getElementById('passwordOverlay');
const passwordInput = () => document.getElementById('passwordInput');
const btnPasswordSubmit = () => document.getElementById('btnPasswordSubmit');
const nameInput = () => document.getElementById('nameInput');
const btnSaveName = () => document.getElementById('btnSaveName');
const messagesEl = () => document.getElementById('messages');
const chatForm = () => document.getElementById('chatForm');
const chatInput = () => document.getElementById('chatInput');
const userCountEl = () => document.getElementById('userCount');
const roomLabel = () => document.getElementById('roomLabel');
const iframeEl = () => document.getElementById('vidfast-player');
const btnPlay = () => document.getElementById('btnPlay');
const btnPause = () => document.getElementById('btnPause');
const btnSeek = () => document.getElementById('btnSeek');
const seekInput = () => document.getElementById('seekInput');

let ably = null;
let channel = null;
let myClientId = null;
let username = null;
let lastPublishedTimeUpdate = 0;

function setCookie(name, value, days=365){
  const expires = new Date(Date.now()+days*864e5).toUTCString();
  document.cookie = name+"="+encodeURIComponent(value)+"; expires="+expires+"; path=/";
}
function getCookie(name){
  return document.cookie.split('; ').reduce((r,v)=>{const parts=v.split('=');return parts[0]===name?decodeURIComponent(parts.slice(1).join('=')):r}, '');
}

function showPasswordOverlay(show){
  const el = passwordOverlay();
  if(!el) return;
  el.classList.toggle('hidden', !show);
}

function requirePassword(){
  const ok = localStorage.getItem('watchparty_auth_'+ROOM)==='1';
  if(!ok){
    showPasswordOverlay(true);
  }
}

function buildIframeSrc(){
  const base = 'https://vidfast.pro';
  if(mediaType==='tv'){
    const s = season || 1; const e = episode || 1;
    return `${base}/tv/${mediaId}/${s}/${e}?autoPlay=false&title=true&poster=true`;
  }
  return `${base}/movie/${mediaId}?autoPlay=false&title=true&poster=true`;
}

function appendMessage(text, meta){
  const div = document.createElement('div');
  div.className = 'message';
  div.textContent = (meta?`[${meta}] `:'') + text;
  messagesEl().appendChild(div);
  messagesEl().scrollTop = messagesEl().scrollHeight;
}

function connectAbly(){
  if(!ABLY_API_KEY || ABLY_API_KEY.includes('07BFEg.BHH9sQ:ACVC6y_4Jv0rP3Q_8-K1XDW-TFIN2Vifx-IpKyro_I8')){
    appendMessage('ERROR: Set ABLY_API_KEY in app.js before deploying.');
    return;
  }
  myClientId = username + '-' + Math.floor(Math.random()*10000);
  ably = new Ably.Realtime({ key: ABLY_API_KEY, clientId: myClientId });
  channel = ably.channels.get('watchparty:'+ROOM);

  channel.attach(err => {
    if(err) { appendMessage('Ably attach error: '+err.message); return; }
    // enter presence
    channel.presence.enter({ name: username }, err => {
      if(err) appendMessage('Presence error: '+err.message);
    });

    // subscribe chat
    channel.subscribe('chat', msg => {
      const data = msg.data || {};
      appendMessage(`${data.name}: ${data.text}`, new Date(msg.timestamp).toLocaleTimeString());
    });

    // subscribe control messages
    channel.subscribe('control', msg => {
      if(!msg) return;
      if(msg.clientId === myClientId) return; // ignore self
      const d = msg.data || {};
      handleRemoteControl(d);
    });

    // requestStatus handling
    channel.subscribe('requestStatus', msg => {
      const requester = msg.data && msg.data.requester;
      if(!requester || requester===myClientId) return;
      // ask vidfast for status and then send status back targeted
      requestAndSendStatus(requester);
    });

    // status messages (response to request)
    channel.subscribe('status', msg => {
      const d = msg.data || {};
      if(d.target !== myClientId) return; // not for me
      // apply status: seek and play/pause
      applyStatusFromRemote(d.status);
    });

    // presence updates
    channel.presence.subscribe(pres => updatePresence());
    updatePresence();

    // announce and request a sync when joining
    setTimeout(()=>{
      channel.publish('chat', { name: 'system', text: `${username} joined the room` });
      channel.publish('requestStatus', { requester: myClientId });
    }, 500);
  });
}

function updatePresence(){
  if(!channel) return;
  channel.presence.get((err, members) => {
    if(err) return;
    userCountEl().textContent = `${members.length} users`;
  });
}

function handleRemoteControl(data){
  const iframe = iframeEl();
  if(!iframe || !iframe.contentWindow) return;
  switch(data.action){
    case 'play':
      if(typeof data.time === 'number') iframe.contentWindow.postMessage({command:'seek', time: data.time}, '*');
      iframe.contentWindow.postMessage({command:'play'}, '*');
      appendMessage(`Remote: play @ ${data.time||'?'}`);
      break;
    case 'pause':
      if(typeof data.time === 'number') iframe.contentWindow.postMessage({command:'seek', time: data.time}, '*');
      iframe.contentWindow.postMessage({command:'pause'}, '*');
      appendMessage(`Remote: pause @ ${data.time||'?'}`);
      break;
    case 'seek':
      iframe.contentWindow.postMessage({command:'seek', time: data.time}, '*');
      appendMessage(`Remote: seek ${data.time}s`);
      break;
    case 'status':
      // handled elsewhere
      break;
  }
}

function requestAndSendStatus(targetClientId){
  const iframe = iframeEl();
  if(!iframe || !iframe.contentWindow) return;
  const onMessage = (ev)=>{
    if(!vidfastOrigins.includes(ev.origin) || !ev.data) return;
    if(ev.data.type === 'PLAYER_EVENT' && ev.data.data && ev.data.data.event === 'playerstatus'){
      const status = ev.data.data;
      channel.publish('status', { target: targetClientId, status });
      window.removeEventListener('message', onMessage);
    }
  };
  window.addEventListener('message', onMessage);
  // ask the player
  iframe.contentWindow.postMessage({command:'getStatus'}, '*');
}

function applyStatusFromRemote(status){
  const iframe = iframeEl();
  if(!iframe || !iframe.contentWindow) return;
  try{
    const t = status.currentTime || 0;
    iframe.contentWindow.postMessage({command:'seek', time: t}, '*');
    if(status.playing) iframe.contentWindow.postMessage({command:'play'}, '*');
    else iframe.contentWindow.postMessage({command:'pause'}, '*');
    appendMessage(`Synced to ${t}s (${status.playing? 'playing':'paused'})`);
  }catch(e){console.warn(e)}
}

function publishControl(action, time){
  if(!channel) return;
  channel.publish('control', { action, time });
}

function setupPlayerListeners(){
  window.addEventListener('message', ({origin, data})=>{
    if(!vidfastOrigins.includes(origin) || !data) return;
    if(data.type === 'PLAYER_EVENT' && data.data){
      const ev = data.data.event;
      // only publish important events
      if(ev==='play' || ev==='pause' || ev==='seeked' || ev==='ended' || ev==='playerstatus'){
        // throttle timeupdate
        if(ev==='timeupdate'){
          const now = Date.now();
          if(now - lastPublishedTimeUpdate < 2000) return; // every 2s
          lastPublishedTimeUpdate = now;
        }
        // send control message
        if(channel){
          channel.publish('control', {
            action: ev==='seeked'? 'seek' : (ev==='playerstatus'?'status':ev),
            time: data.data.currentTime || 0,
            status: data.data
          });
        }
      }
    }
  });
}

function setupUI(){
  document.getElementById('roomLabel').textContent = 'Room: '+ROOM;

  btnPasswordSubmit().addEventListener('click', ()=>{
    const v = passwordInput().value || '';
    if(v === DEMO_PASSWORD){
      localStorage.setItem('watchparty_auth_'+ROOM, '1');
      showPasswordOverlay(false);
      loadAfterAuth();
    } else appendMessage('Wrong password');
  });

  btnSaveName().addEventListener('click', ()=>{
    const v = nameInput().value.trim();
    if(!v) return;
    username = v;
    setCookie('watchparty_user', username);
    nameInput().value = '';
    appendMessage('Saved name: '+username);
    // connect
    connectAbly();
  });

  chatForm().addEventListener('submit', (e)=>{
    e.preventDefault();
    const text = chatInput().value.trim();
    if(!text || !channel) return;
    channel.publish('chat', { name: username, text });
    chatInput().value = '';
  });

  btnPlay().addEventListener('click', ()=>{
    const iframe = iframeEl();
    if(iframe && iframe.contentWindow){
      iframe.contentWindow.postMessage({command:'play'}, '*');
      publishControl('play');
    }
  });
  btnPause().addEventListener('click', ()=>{
    const iframe = iframeEl();
    if(iframe && iframe.contentWindow){
      iframe.contentWindow.postMessage({command:'pause'}, '*');
      publishControl('pause');
    }
  });
  btnSeek().addEventListener('click', ()=>{
    const t = Number(seekInput().value);
    if(Number.isFinite(t)){
      const iframe = iframeEl();
      if(iframe && iframe.contentWindow){
        iframe.contentWindow.postMessage({command:'seek', time: t}, '*');
        publishControl('seek', t);
      }
    }
  });
}

function loadAfterAuth(){
  // set iframe src
  iframeEl().src = buildIframeSrc();
  // restore name if cookie present and auto connect
  const saved = getCookie('watchparty_user');
  if(saved){ username = saved; appendMessage('Welcome back '+username); connectAbly(); }
  setupPlayerListeners();
}

// init
window.addEventListener('DOMContentLoaded', ()=>{
  setupUI();
  requirePassword();
});
