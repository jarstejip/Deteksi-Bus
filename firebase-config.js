// 🔥 CONFIG FIREBASE - SIMPLE VERSION
const firebaseConfig = {
    apiKey: "AIzaSyBW7ZJ0qmZ0XyOfSNGJZjNLQJcx4zqg_d8",
    authDomain: "bus-tracker-f6390.firebaseapp.com",
    databaseURL: "https://bus-tracker-f6390-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "bus-tracker-f6390",
    storageBucket: "bus-tracker-f6390.firebasestorage.app",
    messagingSenderId: "517707774612",
    appId: "1:517707774612:web:3cb9c5be0d46270e509281"
};

// Initialize Firebase - VERSI SEDERHANA
console.log("🚀 Initializing Firebase...");

try {
    // Pastikan firebase sudah di-load
    if (typeof firebase === 'undefined') {
        console.error("Firebase CDN belum dimuat");
    } else {
        // Initialize app
        const app = firebase.initializeApp(firebaseConfig);
        const database = firebase.database();
        
        console.log("✅ Firebase App initialized:", app.name);
        console.log("📡 Database URL:", firebaseConfig.databaseURL);
        
        // Simpan ke window untuk digunakan di app.js
        window.firebaseApp = app;
        window.firebaseDatabase = database;
        
        // Test connection sederhana (tanpa .info/connected)
        database.ref('connection_test').set({
            timestamp: Date.now(),
            status: 'connected'
        }).then(() => {
            console.log("🔥 Firebase connected successfully!");
        }).catch(error => {
            console.warn("⚠️ Firebase test error:", error.message);
        });
    }
} catch (error) {
    console.error("❌ Firebase initialization error:", error);
}