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
let gpsWatchId = null;

// Konstanta
const DETECTION_RADIUS_KM = 2; // Radius deteksi kendaraan
const UPDATE_INTERVAL = 10000; // Update setiap 10 detik
const MAX_DRIVER_AGE = 5 * 60 * 1000; // Driver dianggap offline setelah 5 menit

// ========== INISIALISASI ==========
document.addEventListener('DOMContentLoaded', function() {
    console.log("🚌 Bus Tracker Starting...");
    console.log("🌍 Environment:", window.location.protocol + "//" + window.location.host);
    
    // Tampilkan user ID
    document.getElementById('userId').textContent = userId.substring(0, 8) + '...';
    
    // Inisialisasi peta
    initMap();
    
    // Tunggu sedikit untuk Firebase (jika belum ready)
    setTimeout(() => {
        // Mulai monitoring lokasi user
        startLocationMonitoring();
        
        // Mulai listen data realtime dari Firebase
        startRealtimeListener();
        
        // Update timestamp
        updateTimestamp();
        setInterval(updateTimestamp, 1000);
        
        // Test Firebase connection
        testFirebaseConnection();
        
    }, 1000);
});

// ========== FUNGSI PETA ==========
function initMap() {
    console.log("🗺️ Initializing map...");
    
    try {
        // Buat peta dengan view Jakarta
        map = L.map('map').setView([-6.2088, 106.8456], 13);
        
        // Tambahkan tile layer (peta dasar)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);
        
        // Tambahkan kontrol skala
        L.control.scale({imperial: false}).addTo(map);
        
        updateStatus('Peta siap digunakan', 'info');
        console.log("✅ Map initialized");
    } catch (error) {
        console.error("❌ Map initialization error:", error);
        updateStatus('Error loading map', 'error');
    }
}

// ========== MONITORING LOKASI USER ==========
function startLocationMonitoring() {
    console.log("📍 Starting GPS monitoring...");
    
    if (!navigator.geolocation) {
        console.warn("❌ Geolocation API not supported");
        updateStatus('Browser tidak mendukung GPS', 'error');
        getLocationByIP(); // Fallback ke IP
        return;
    }
    
    const gpsOptions = {
        enableHighAccuracy: true,     // Pakai GPS jika available
        maximumAge: 0,               // Jangan pakai cache
        timeout: 15000               // 15 detik timeout
    };
    
    // Dapatkan lokasi sekali saat awal
    navigator.geolocation.getCurrentPosition(
        (position) => {
            console.log("✅ GPS Success - High Accuracy:", {
                lat: position.coords.latitude.toFixed(6),
                lng: position.coords.longitude.toFixed(6),
                accuracy: position.coords.accuracy + "m",
                altitude: position.coords.altitude ? "Available" : "Not available",
                source: position.coords.altitude ? "Real GPS" : "Network"
            });
            
            updateUserLocation(position);
            updateStatus('Lokasi GPS berhasil dideteksi', 'success');
            
            // Mulai watch position untuk update terus menerus
            startWatchingPosition();
        },
        (error) => {
            console.warn("⚠️ GPS High Accuracy failed, trying low accuracy...");
            
            // Coba dengan accuracy lebih rendah
            const lowAccuracyOptions = {
                enableHighAccuracy: false,
                maximumAge: 60000,    // Boleh pakai cache 1 menit
                timeout: 10000
            };
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    console.log("✅ GPS Success - Low Accuracy:", {
                        lat: position.coords.latitude.toFixed(6),
                        lng: position.coords.longitude.toFixed(6),
                        accuracy: position.coords.accuracy + "m"
                    });
                    
                    updateUserLocation(position);
                    updateStatus('Lokasi berhasil dideteksi (akurasi rendah)', 'warning');
                    startWatchingPosition();
                },
                (error) => {
                    console.error("❌ GPS Completely Failed:", error);
                    handleGeolocationError(error);
                },
                lowAccuracyOptions
            );
        },
        gpsOptions
    );
}

function startWatchingPosition() {
    if (gpsWatchId) {
        navigator.geolocation.clearWatch(gpsWatchId);
    }
    
    gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            console.log("🔄 GPS Update:", {
                lat: position.coords.latitude.toFixed(6),
                lng: position.coords.longitude.toFixed(6),
                accuracy: position.coords.accuracy + "m"
            });
            
            updateUserLocation(position);
            
            // Jika dalam mode driver, update posisi ke Firebase
            if (isDriverMode) {
                updateDriverPosition();
            }
        },
        (error) => {
            console.warn('GPS Watch Error:', error.message);
            // Jangan stop watch, biarkan continue
        },
        {
            enableHighAccuracy: false, // Watch dengan low accuracy lebih reliable
            maximumAge: 30000,
            timeout: 10000
        }
    );
}

function updateUserLocation(position) {
    const newLat = position.coords.latitude;
    const newLng = position.coords.longitude;
    
    // Cek jika lokasi berubah signifikan (lebih dari 10 meter)
    const distanceChanged = calculateDistance(
        currentUserLocation.lat, currentUserLocation.lng,
        newLat, newLng
    ) * 1000; // Convert to meters
    
    currentUserLocation = {
        lat: newLat,
        lng: newLng
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
        
        // Tambah circle radius (accuracy)
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
        
        // Update view jika perubahan signifikan
        if (distanceChanged > 50) { // > 50 meter
            map.setView([currentUserLocation.lat, currentUserLocation.lng], map.getZoom());
        }
    }
    
    // Update accuracy circle jika perlu
    if (position.coords.accuracy < 1000) { // Jika accuracy < 1km
        userCircle.setRadius(position.coords.accuracy);
        userCircle.setStyle({
            color: position.coords.accuracy < 100 ? '#4CAF50' : 
                   position.coords.accuracy < 500 ? '#FF9800' : '#F44336',
            fillOpacity: 0.2
        });
    }
    
    // Update info GPS di UI
    const accuracyStatus = position.coords.accuracy < 100 ? 'Tinggi' :
                          position.coords.accuracy < 500 ? 'Sedang' : 'Rendah';
    
    document.getElementById('gpsInfo').innerHTML = `
        <strong>Koordinat:</strong> ${currentUserLocation.lat.toFixed(6)}, ${currentUserLocation.lng.toFixed(6)}<br>
        <strong>Akurasi:</strong> ${position.coords.accuracy.toFixed(0)} meter (${accuracyStatus})<br>
        <strong>Waktu:</strong> ${new Date().toLocaleTimeString()}
    `;
}

// ========== FALLBACK: IP GEOLOCATION ==========
function getLocationByIP() {
    console.log("🌐 Trying IP-based location as fallback...");
    updateStatus('Mendapatkan lokasi dari jaringan...', 'info');
    
    // Coba beberapa IP geolocation services (gratis)
    const ipServices = [
        'https://ipapi.co/json/',
        'https://ipinfo.io/json?token=test', // Token optional
        'https://geolocation-db.com/json/'
    ];
    
    let currentService = 0;
    
    function tryNextService() {
        if (currentService >= ipServices.length) {
            updateStatus('Gagal mendapatkan lokasi', 'error');
            return;
        }
        
        fetch(ipServices[currentService])
            .then(response => {
                if (!response.ok) throw new Error('Service failed');
                return response.json();
            })
            .then(data => {
                console.log("📍 IP Location Data:", data);
                
                let lat, lng;
                
                // Parse data dari berbagai format service
                if (data.latitude && data.longitude) {
                    lat = parseFloat(data.latitude);
                    lng = parseFloat(data.longitude);
                } else if (data.loc) {
                    const loc = data.loc.split(',');
                    lat = parseFloat(loc[0]);
                    lng = parseFloat(loc[1]);
                }
                
                if (lat && lng) {
                    const simulatedPosition = {
                        coords: {
                            latitude: lat,
                            longitude: lng,
                            accuracy: 50000, // Accuracy rendah (50km)
                            altitude: null,
                            altitudeAccuracy: null,
                            heading: null,
                            speed: null
                        },
                        timestamp: Date.now()
                    };
                    
                    currentUserLocation = { lat, lng };
                    updateUserLocation(simulatedPosition);
                    updateStatus('Lokasi dari jaringan (mungkin kurang akurat)', 'warning');
                    
                    // Update marker style untuk bedakan
                    if (userMarker) {
                        userMarker.setIcon(L.icon({
                            iconUrl: 'https://cdn-icons-png.flaticon.com/512/3176/3176296.png',
                            iconSize: [40, 40],
                            iconAnchor: [20, 40],
                            className: 'ip-location-marker'
                        }));
                    }
                } else {
                    currentService++;
                    tryNextService();
                }
            })
            .catch(error => {
                console.log(`Service ${currentService} failed:`, error.message);
                currentService++;
                setTimeout(tryNextService, 500);
            });
    }
    
    tryNextService();
}

function handleGeolocationError(error) {
    let message = '';
    switch(error.code) {
        case error.PERMISSION_DENIED:
            message = 'Akses lokasi ditolak. Izinkan akses lokasi di browser settings.';
            console.log("🔒 Permission denied - asking user to enable location");
            showPermissionInstructions();
            break;
        case error.POSITION_UNAVAILABLE:
            message = 'GPS tidak tersedia. Coba di tempat terbuka.';
            getLocationByIP(); // Fallback ke IP
            break;
        case error.TIMEOUT:
            message = 'GPS timeout. Coba refresh halaman.';
            setTimeout(startLocationMonitoring, 3000); // Retry
            break;
        default:
            message = 'Error tidak diketahui.';
    }
    
    updateStatus(message, 'error');
    console.error("GPS Error Details:", {
        code: error.code,
        message: error.message,
        timestamp: new Date().toISOString()
    });
}

function showPermissionInstructions() {
    const instructions = `
    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin-top: 10px;">
        <strong>📋 Cara mengizinkan akses lokasi:</strong>
        <ol style="margin: 10px 0 0 20px;">
            <li>Klik ikon <strong>🔒</strong> di address bar browser</li>
            <li>Pilih <strong>"Izinkan"</strong> untuk akses lokasi</li>
            <li>Refresh halaman setelah mengizinkan</li>
            <li>Atau klik tombol di bawah untuk coba lagi</li>
        </ol>
        <button onclick="retryGPS()" style="margin-top: 10px; padding: 8px 15px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">
            🔄 Coba Lagi
        </button>
    </div>
    `;
    
    document.getElementById('statusText').innerHTML += instructions;
}

function retryGPS() {
    console.log("🔄 Retrying GPS...");
    updateStatus('Mencoba ulang GPS...', 'info');
    startLocationMonitoring();
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
        plateNumber: 'B ' + Math.floor(Math.random() * 10000) + ' AC',
        route: 'Kampung Melayu - Tanah Abang',
        lastUpdate: new Date().toLocaleTimeString(),
        accuracy: userCircle ? userCircle.getRadius() : 1000
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
        const driversRef = window.firebaseDatabase.ref('drivers');
        
        driversRef.on('value', (snapshot) => {
            const drivers = snapshot.val();
            console.log("📡 Firebase data received, drivers:", drivers ? Object.keys(drivers).length : 0);
            
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
        
        if (key === userId) return;
        
        const age = now - driver.timestamp;
        if (age > MAX_DRIVER_AGE) return;
        
        activeCount++;
        
        const distance = calculateDistance(
            currentUserLocation.lat, currentUserLocation.lng,
            driver.lat, driver.lng
        );
        
        if (distance <= DETECTION_RADIUS_KM) {
            nearbyCount++;
        }
        
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
    
    Object.keys(vehicleMarkers).forEach(key => {
        if (!drivers || !drivers[key] || drivers[key].userId === userId) {
            if (vehicleMarkers[key]) {
                map.removeLayer(vehicleMarkers[key]);
            }
            delete vehicleMarkers[key];
        }
    });
    
    if (drivers) {
        Object.keys(drivers).forEach(key => {
            const driver = drivers[key];
            
            if (key === userId || (now - driver.timestamp) > MAX_DRIVER_AGE) return;
            
            const distance = calculateDistance(
                currentUserLocation.lat, currentUserLocation.lng,
                driver.lat, driver.lng
            );
            
            if (distance <= DETECTION_RADIUS_KM * 2) {
                if (vehicleMarkers[key]) {
                    vehicleMarkers[key].setLatLng([driver.lat, driver.lng]);
                } else {
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
        setTimeout(testFirebaseConnection, 3000); // Retry
        return;
    }
    
    const testRef = window.firebaseDatabase.ref('connection_test/' + Date.now());
    testRef.set({
        message: "Test connection from Bus Tracker",
        timestamp: Date.now(),
        userId: userId,
        environment: window.location.hostname
    }).then(() => {
        console.log("✅ Firebase write successful");
        updateStatus("Firebase terhubung", "success");
        
        window.firebaseDatabase.ref('connection_test').limitToLast(1).once('value')
            .then((snapshot) => {
                console.log("✅ Firebase read successful");
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
    const R = 6371;
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
        
        updateDriverPosition();
        driverWatchInterval = setInterval(updateDriverPosition, UPDATE_INTERVAL);
        
    } else {
        button.innerHTML = '🚗 Jadi Driver';
        button.classList.remove('pulse');
        updateStatus('Mode Driver NONAKTIF', 'info');
        
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
        let nearestDriver = null;
        let nearestDistance = Infinity;
        
        if (drivers) {
            Object.keys(drivers).forEach(key => {
                const driver = drivers[key];
                if (key === userId) return;
                
                const distance = calculateDistance(
                    currentUserLocation.lat, currentUserLocation.lng,
                    driver.lat, driver.lng
                );
                
                if (distance <= 1) {
                    foundCount++;
                    if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearestDriver = driver;
                    }
                }
            });
        }
        
        if (foundCount > 0) {
            updateStatus(`Ditemukan ${foundCount} kendaraan dalam radius 1km!`, 'success');
            playNotificationSound();
            
            // Auto focus ke yang terdekat
            if (nearestDriver) {
                map.setView([nearestDriver.lat, nearestDriver.lng], 16);
            }
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
    const routePoints = [
        [-6.2088, 106.8456],
        [-6.2188, 106.8356],
        [-6.2288, 106.8256]
    ];
    
    if (routes[routeCode]) {
        map.removeLayer(routes[routeCode]);
    }
    
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
                    
                    Object.keys(vehicleMarkers).forEach(key => {
                        map.removeLayer(vehicleMarkers[key]);
                    });
                    vehicleMarkers = {};
                    
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
    try {
        const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-correct-answer-tone-2870.mp3');
        audio.volume = 0.3;
        audio.play();
    } catch (e) {
        // Silent fail
    }
}

// ========== AUTO CLEANUP ==========
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
}, 60000);

// ========== GLOBAL FUNCTIONS ==========
window.toggleDriverMode = toggleDriverMode;
window.findNearbyVehicles = findNearbyVehicles;
window.centerOnVehicle = centerOnVehicle;
window.showRoute = showRoute;
window.clearAllData = clearAllData;
window.retryGPS = retryGPS;