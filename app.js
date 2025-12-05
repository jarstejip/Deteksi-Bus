// ========== KONSTANTA & VARIABEL ==========
let map;
let userMarker;
let userCircle;
let currentUserLocation = { lat: -6.2088, lng: 106.8456 }; // Default: Jakarta
let isDriverMode = false;
let userId = 'user_' + Math.random().toString(36).substr(2, 9);
let vehicleMarkers = {};
let routes = {};
let driverWatchInterval;

// Konstanta
const DETECTION_RADIUS_KM = 2; // Radius deteksi kendaraan
const UPDATE_INTERVAL = 10000; // Update setiap 10 detik
const MAX_DRIVER_AGE = 5 * 60 * 1000; // Driver dianggap offline setelah 5 menit

// ========== INISIALISASI ==========
document.addEventListener('DOMContentLoaded', function() {
    console.log("🚌 Bus Tracker Starting...");
    
    // Tampilkan user ID
    document.getElementById('userId').textContent = userId.substring(0, 8) + '...';
    
    // Tunggu Firebase siap (500ms delay)
    setTimeout(() => {
        // Inisialisasi peta
        initMap();
        
        // Mulai monitoring lokasi user
        startLocationMonitoring();
        
        // Mulai listen data realtime dari Firebase
        startRealtimeListener();
        
        // Update timestamp
        updateTimestamp();
        setInterval(updateTimestamp, 1000);
        
        // Test Firebase connection
        testFirebaseConnection();
        
    }, 500);
});

// ========== FUNGSI PETA ==========
function initMap() {
    console.log("🗺️ Initializing map...");
    
    // Buat peta dengan view Jakarta
    map = L.map('map').setView([-6.2088, 106.8456], 13);
    
    // Tambahkan tile layer (peta dasar)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    
    // Tambahkan kontrol skala
    L.control.scale().addTo(map);
    
    updateStatus('Peta siap digunakan', 'info');
    console.log("✅ Map initialized");
}

// ========== MONITORING LOKASI USER ==========
function startLocationMonitoring() {
    if (!navigator.geolocation) {
        updateStatus('Browser tidak mendukung GPS', 'error');
        return;
    }
    
    console.log("📍 Starting GPS monitoring...");
    
    // Dapatkan lokasi sekali saat awal
    navigator.geolocation.getCurrentPosition(
        (position) => {
            updateUserLocation(position);
            updateStatus('Lokasi berhasil dideteksi', 'success');
        },
        (error) => {
            handleGeolocationError(error);
        }
    );
    
    // Watch position untuk update terus menerus
    navigator.geolocation.watchPosition(
        (position) => {
            updateUserLocation(position);
            
            // Jika dalam mode driver, update posisi ke Firebase
            if (isDriverMode) {
                updateDriverPosition();
            }
        },
        (error) => {
            console.warn('GPS Warning:', error);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 30000,
            timeout: 10000
        }
    );
}

function updateUserLocation(position) {
    currentUserLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
    };
    
    // Update marker user
    if (!userMarker) {
        // Buat marker baru
        userMarker = L.marker([currentUserLocation.lat, currentUserLocation.lng], {
            icon: L.icon({
                iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
                iconSize: [40, 40],
                iconAnchor: [20, 40],
                popupAnchor: [0, -40]
            }),
            title: 'Lokasi Anda'
        }).addTo(map);
        
        userMarker.bindPopup('<b>📍 Lokasi Anda</b><br>Anda berada di sini').openPopup();
        
        // Tambah circle radius
        userCircle = L.circle([currentUserLocation.lat, currentUserLocation.lng], {
            color: '#2196F3',
            fillColor: '#2196F3',
            fillOpacity: 0.1,
            radius: DETECTION_RADIUS_KM * 1000 // Convert km ke meter
        }).addTo(map);
        
        // Update view ke lokasi user
        map.setView([currentUserLocation.lat, currentUserLocation.lng], 15);
        
    } else {
        // Update posisi marker yang sudah ada
        userMarker.setLatLng([currentUserLocation.lat, currentUserLocation.lng]);
        userCircle.setLatLng([currentUserLocation.lat, currentUserLocation.lng]);
    }
    
    // Update info GPS di UI
    document.getElementById('gpsInfo').innerHTML = `
        <strong>Koordinat:</strong> ${currentUserLocation.lat.toFixed(6)}, ${currentUserLocation.lng.toFixed(6)}<br>
        <strong>Akurasi:</strong> ±${position.coords.accuracy.toFixed(0)} meter<br>
        <strong>Waktu:</strong> ${new Date().toLocaleTimeString()}
    `;
}

function handleGeolocationError(error) {
    let message = 'Error GPS: ';
    switch(error.code) {
        case error.PERMISSION_DENIED:
            message += 'Akses lokasi ditolak. Izinkan akses lokasi di browser settings.';
            break;
        case error.POSITION_UNAVAILABLE:
            message += 'Informasi lokasi tidak tersedia.';
            break;
        case error.TIMEOUT:
            message += 'Request lokasi timeout.';
            break;
        default:
            message += 'Error tidak diketahui.';
    }
    updateStatus(message, 'error');
    console.error("GPS Error:", error);
}

// ========== FIREBASE FUNCTIONS ==========
function updateDriverPosition() {
    if (!window.firebaseDatabase) {
        console.warn("Firebase not available for update");
        return;
    }
    
    const driverData = {
        userId: userId,
        lat: currentUserLocation.lat,
        lng: currentUserLocation.lng,
        timestamp: Date.now(),
        isActive: true,
        vehicleType: 'angkot',
        plateNumber: 'B ' + Math.floor(Math.random() * 10000) + ' AC', // Random untuk demo
        route: 'Kampung Melayu - Tanah Abang',
        lastUpdate: new Date().toLocaleTimeString()
    };
    
    window.firebaseDatabase.ref('drivers/' + userId).set(driverData)
        .then(() => {
            console.log("📡 Driver position updated to Firebase");
        })
        .catch((error) => {
            console.error('Firebase update error:', error);
            updateStatus('Gagal update posisi ke server', 'warning');
        });
}

function startRealtimeListener() {
    console.log("🔄 Starting Firebase realtime listener...");
    
    if (!window.firebaseDatabase) {
        console.warn("Firebase not ready, retrying in 2 seconds...");
        setTimeout(startRealtimeListener, 2000);
        return;
    }
    
    try {
        // Listen untuk data driver realtime - PASTIKAN PATH BENAR
        const driversRef = window.firebaseDatabase.ref('drivers');
        
        // Hanya gunakan .on() dengan event type 'value' untuk sekarang
        driversRef.on('value', (snapshot) => {
            console.log("📡 Firebase data received");
            const drivers = snapshot.val();
            
            // Update UI
            updateDriverList(drivers);
            updateVehicleMarkers(drivers);
            updateConnectionStatus(true);
            
        }, (error) => {
            console.error('Firebase listener error:', error);
            updateConnectionStatus(false);
        });
        
    } catch (error) {
        console.error("Error in startRealtimeListener:", error);
    }
}

function updateDriverList(drivers) {
    const driverListElement = document.getElementById('driverList');
    const now = Date.now();
    let activeCount = 0;
    let nearbyCount = 0;
    
    if (!drivers) {
        driverListElement.innerHTML = '<div class="driver-item">Tidak ada driver aktif</div>';
        document.getElementById('totalDrivers').textContent = '0';
        document.getElementById('nearbyCount').textContent = '0';
        return;
    }
    
    let driverItems = '';
    Object.keys(drivers).forEach(key => {
        const driver = drivers[key];
        
        // Skip jika driver adalah user sendiri
        if (key === userId) return;
        
        // Hitung umur data
        const age = now - driver.timestamp;
        if (age > MAX_DRIVER_AGE) return; // Skip jika data terlalu tua
        
        activeCount++;
        
        // Hitung jarak dari user
        const distance = calculateDistance(
            currentUserLocation.lat, currentUserLocation.lng,
            driver.lat, driver.lng
        );
        
        if (distance <= DETECTION_RADIUS_KM) {
            nearbyCount++;
        }
        
        // Format waktu terakhir update
        const timeAgo = formatTimeAgo(age);
        
        driverItems += `
            <div class="driver-item">
                <div>
                    <span class="driver-plate">${driver.plateNumber || 'Unknown'}</span><br>
                    <small>${driver.route || 'No route'}</small>
                </div>
                <div style="text-align: right;">
                    <span class="driver-distance">${distance.toFixed(1)} km</span><br>
                    <small class="driver-time">${timeAgo}</small>
                </div>
            </div>
        `;
    });
    
    driverListElement.innerHTML = driverItems || '<div class="driver-item">Tidak ada driver aktif</div>';
    document.getElementById('totalDrivers').textContent = activeCount;
    document.getElementById('nearbyCount').textContent = nearbyCount;
}

function updateVehicleMarkers(drivers) {
    const now = Date.now();
    
    // Hapus marker lama yang tidak ada lagi
    Object.keys(vehicleMarkers).forEach(key => {
        if (!drivers || !drivers[key] || drivers[key].userId === userId) {
            if (vehicleMarkers[key]) {
                map.removeLayer(vehicleMarkers[key]);
            }
            delete vehicleMarkers[key];
        }
    });
    
    // Tambah/update marker baru
    if (drivers) {
        Object.keys(drivers).forEach(key => {
            const driver = drivers[key];
            
            // Skip jika driver adalah user sendiri atau data terlalu tua
            if (key === userId || (now - driver.timestamp) > MAX_DRIVER_AGE) return;
            
            const distance = calculateDistance(
                currentUserLocation.lat, currentUserLocation.lng,
                driver.lat, driver.lng
            );
            
            // Hanya tampilkan dalam radius tertentu
            if (distance <= DETECTION_RADIUS_KM * 2) { // Lebih besar dari detection radius
                if (vehicleMarkers[key]) {
                    // Update posisi marker yang sudah ada
                    vehicleMarkers[key].setLatLng([driver.lat, driver.lng]);
                } else {
                    // Buat marker baru
                    const marker = L.marker([driver.lat, driver.lng], {
                        icon: L.icon({
                            iconUrl: 'https://cdn-icons-png.flaticon.com/512/3097/3097143.png',
                            iconSize: [35, 35],
                            iconAnchor: [17, 35],
                            popupAnchor: [0, -35]
                        }),
                        title: driver.plateNumber || 'Kendaraan'
                    }).addTo(map);
                    
                    marker.bindPopup(`
                        <b>🚌 ${driver.plateNumber || 'Kendaraan'}</b><br>
                        <b>Rute:</b> ${driver.route || 'Tidak diketahui'}<br>
                        <b>Jarak:</b> ${distance.toFixed(1)} km dari Anda<br>
                        <b>Update:</b> ${new Date(driver.timestamp).toLocaleTimeString()}<br>
                        <button onclick="centerOnVehicle('${key}')" style="margin-top: 5px; padding: 5px 10px; background: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer;">
                            Fokus ke kendaraan
                        </button>
                    `);
                    
                    vehicleMarkers[key] = marker;
                }
            }
        });
    }
}

// ========== TEST FIREBASE CONNECTION ==========
function testFirebaseConnection() {
    console.log("🧪 Testing Firebase connection...");
    
    if (!window.firebaseDatabase) {
        console.error("❌ Firebase Database not available");
        updateStatus("Firebase belum terhubung", "warning");
        return;
    }
    
    // Coba write data test
    const testRef = window.firebaseDatabase.ref('connection_test/' + Date.now());
    testRef.set({
        message: "Test connection from Bus Tracker",
        timestamp: Date.now(),
        userId: userId
    }).then(() => {
        console.log("✅ Firebase write successful");
        updateStatus("Firebase terhubung", "success");
        
        // Coba read data
        window.firebaseDatabase.ref('connection_test').limitToLast(1).once('value')
            .then((snapshot) => {
                console.log("✅ Firebase read successful");
                console.log("Test data:", snapshot.val());
            })
            .catch(error => {
                console.error("❌ Firebase read failed:", error);
            });
            
    }).catch(error => {
        console.error("❌ Firebase write failed:", error.code, error.message);
        updateStatus("Gagal terhubung ke Firebase", "error");
    });
}

// ========== FUNGSI UTILITAS ==========
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius bumi dalam km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function formatTimeAgo(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds < 60) return `${seconds} detik lalu`;
    if (seconds < 3600) return `${Math.floor(seconds/60)} menit lalu`;
    return `${Math.floor(seconds/3600)} jam lalu`;
}

function updateTimestamp() {
    document.getElementById('updateTime').textContent = 
        new Date().toLocaleTimeString();
}

function updateStatus(message, type = 'info') {
    const statusElement = document.getElementById('statusText');
    statusElement.textContent = message;
    
    // Update warna berdasarkan type
    const statusBox = document.getElementById('statusBox');
    statusBox.style.borderLeftColor = 
        type === 'error' ? '#f44336' : 
        type === 'warning' ? '#ff9800' : 
        type === 'success' ? '#4CAF50' : '#2196F3';
}

function updateConnectionStatus(isConnected) {
    const connectionElement = document.getElementById('connectionStatus');
    if (isConnected) {
        connectionElement.textContent = '🟢 Terhubung ke Firebase';
        connectionElement.style.color = '#4CAF50';
    } else {
        connectionElement.textContent = '🔴 Koneksi terputus';
        connectionElement.style.color = '#f44336';
    }
}

// ========== FUNGSI UI CONTROLLER ==========
function toggleDriverMode() {
    isDriverMode = !isDriverMode;
    const button = document.getElementById('driverBtn');
    
    if (isDriverMode) {
        button.innerHTML = '🚗 Mode Driver Aktif';
        button.classList.add('pulse');
        updateStatus('Mode Driver AKTIF - Posisi Anda dikirim ke server', 'success');
        
        // Mulai update posisi secara berkala
        updateDriverPosition();
        driverWatchInterval = setInterval(updateDriverPosition, UPDATE_INTERVAL);
        
    } else {
        button.innerHTML = '🚗 Jadi Driver';
        button.classList.remove('pulse');
        updateStatus('Mode Driver NONAKTIF', 'info');
        
        // Hentikan interval dan hapus data dari Firebase
        if (driverWatchInterval) {
            clearInterval(driverWatchInterval);
        }
        if (window.firebaseDatabase) {
            window.firebaseDatabase.ref('drivers/' + userId).remove()
                .then(() => {
                    console.log("Driver data removed from Firebase");
                })
                .catch(error => {
                    console.error("Error removing driver data:", error);
                });
        }
    }
}

function findNearbyVehicles() {
    if (!window.firebaseDatabase) {
        alert('Firebase belum terhubung');
        return;
    }
    
    updateStatus('Mencari kendaraan di sekitar...', 'info');
    
    window.firebaseDatabase.ref('drivers').once('value').then((snapshot) => {
        const drivers = snapshot.val();
        let foundCount = 0;
        
        if (drivers) {
            Object.keys(drivers).forEach(key => {
                const driver = drivers[key];
                if (key === userId) return;
                
                const distance = calculateDistance(
                    currentUserLocation.lat, currentUserLocation.lng,
                    driver.lat, driver.lng
                );
                
                if (distance <= 1) { // Dalam 1km
                    foundCount++;
                    
                    // Buka popup marker jika ada
                    if (vehicleMarkers[key]) {
                        vehicleMarkers[key].openPopup();
                        map.setView([driver.lat, driver.lng], 16);
                    }
                }
            });
        }
        
        if (foundCount > 0) {
            updateStatus(`Ditemukan ${foundCount} kendaraan dalam radius 1km!`, 'success');
            playNotificationSound();
        } else {
            updateStatus('Tidak ada kendaraan dalam radius 1km', 'warning');
        }
    }).catch(error => {
        console.error("Error finding nearby vehicles:", error);
        updateStatus('Gagal mencari kendaraan', 'error');
    });
}

function centerOnVehicle(vehicleId) {
    if (vehicleMarkers[vehicleId]) {
        const marker = vehicleMarkers[vehicleId];
        map.setView(marker.getLatLng(), 16);
        marker.openPopup();
    }
}

function showRoute(routeCode) {
    // Contoh rute sederhana (bisa dikembangkan)
    const routePoints = [
        [-6.2088, 106.8456], // Jakarta
        [-6.2188, 106.8356],
        [-6.2288, 106.8256]
    ];
    
    // Hapus polyline lama jika ada
    if (routes[routeCode]) {
        map.removeLayer(routes[routeCode]);
    }
    
    // Buat polyline baru
    const polyline = L.polyline(routePoints, {
        color: '#2196F3',
        weight: 4,
        opacity: 0.7,
        dashArray: '10, 10'
    }).addTo(map);
    
    routes[routeCode] = polyline;
    updateStatus(`Rute ${routeCode} ditampilkan`, 'info');
}

function clearAllData() {
    if (confirm('Hapus SEMUA data driver dari server? Tindakan ini tidak bisa dibatalkan.')) {
        if (window.firebaseDatabase) {
            window.firebaseDatabase.ref('drivers').remove()
                .then(() => {
                    updateStatus('Semua data berhasil dihapus', 'success');
                    alert('Data berhasil dihapus dari server');
                    
                    // Clear local markers
                    Object.keys(vehicleMarkers).forEach(key => {
                        map.removeLayer(vehicleMarkers[key]);
                    });
                    vehicleMarkers = {};
                    
                    // Update UI
                    document.getElementById('driverList').innerHTML = '<div class="driver-item">Tidak ada driver aktif</div>';
                    document.getElementById('totalDrivers').textContent = '0';
                    document.getElementById('nearbyCount').textContent = '0';
                    
                })
                .catch((error) => {
                    updateStatus('Gagal menghapus data', 'error');
                    console.error('Delete error:', error);
                });
        }
    }
}

function playNotificationSound() {
    // Coba play sound notification
    try {
        const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-correct-answer-tone-2870.mp3');
        audio.volume = 0.3;
        audio.play();
    } catch (e) {
        // Silent fail jika audio error
    }
}

// ========== AUTO CLEANUP ==========
// Bersihkan driver yang offline setiap 1 menit
setInterval(() => {
    if (!window.firebaseDatabase) return;
    
    const now = Date.now();
    window.firebaseDatabase.ref('drivers').once('value').then((snapshot) => {
        const drivers = snapshot.val();
        if (!drivers) return;
        
        Object.keys(drivers).forEach(key => {
            const driver = drivers[key];
            if (now - driver.timestamp > MAX_DRIVER_AGE) {
                window.firebaseDatabase.ref('drivers/' + key).remove()
                    .then(() => {
                        console.log(`Removed stale driver: ${key}`);
                    })
                    .catch(error => {
                        console.error(`Error removing driver ${key}:`, error);
                    });
            }
        });
    }).catch(error => {
        console.error("Error in auto cleanup:", error);
    });
}, 60000); // Setiap 1 menit

// ========== GLOBAL FUNCTIONS ==========
// Export function untuk digunakan di HTML
window.toggleDriverMode = toggleDriverMode;
window.findNearbyVehicles = findNearbyVehicles;
window.centerOnVehicle = centerOnVehicle;
window.showRoute = showRoute;
window.clearAllData = clearAllData;