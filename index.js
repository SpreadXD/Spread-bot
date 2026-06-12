const fs = require('fs');
const path = require('path');
const readline = require('readline');
const http = require('http');
const { createManagedBot } = require('./bot');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Global hata yakalayıcıları (Node.js sürecinin çökmesini tamamen engellemek için)
process.on('uncaughtException', (err) => {
  console.error('[Sistem Hata] Beklenmedik Hata (uncaughtException):', err.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Sistem Hata] Beklenmedik Promise Reddi (unhandledRejection):', reason);
});

// Yardımcı readline sorusu fonksiyonu
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

// Varsayılan ayarları yükle
function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.error("[Sistem] Ayar dosyası (config.json) okunamadı, varsayılanlar kullanılacak.");
    }
  }
  return {
    host: "localhost",
    port: 25565,
    version: "1.20.1",
    botCount: 5,
    botNamePrefix: "SwarmBot_",
    leaderName: "SpreadLeader", // Lider botun sabit ismi (bir kez /op ver, sonsuza kadar çalışır)
    randomMovement: true,
    autoRespawn: true,
    autoDay: true,      // Gece → /time set day (gerçek oyuncu yokken)
    autoWeather: true,  // Yağmur/fırtına → /weather clear (gerçek oyuncu yokken)
    reconnectInterval: 15000
  };
}

// Ayarları kaydet
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    console.log("[Sistem] Ayarlar kaydedildi (config.json).");
  } catch (e) {
    console.error("[Sistem] Ayarlar kaydedilirken hata oluştu:", e.message);
  }
}

// Render veya bulut sunucuları için HTTP sunucusu (Uyanık kalma/Port bağlama için)
function startWebServer() {
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Minecraft Swarm Bot Aktif ve Çalışıyor!');
  }).listen(port, () => {
    console.log(`[Web] Sunucu port ${port} üzerinde aktif (Render uyanık kalma servisi için).`);
  });
}

async function main() {
  console.log("==========================================================");
  console.log("             MINECRAFT SWARM BOT CLIENT                   ");
  console.log("==========================================================");
  console.log("Bu araç sunucu testi ve aktif kalma amaçlı hazırlanmıştır.");
  console.log("==========================================================\n");

  let config = loadConfig();

  // Render veya diğer bulut ortamlarında çalışıp çalışmadığımızı kontrol et
  const isCloudEnv = process.env.PORT || process.env.RENDER || process.env.NODE_ENV === 'production';

  if (isCloudEnv) {
    console.log("[Bulut Ortamı] Bulut ortamı algılandı, interaktif sorular geçiliyor.");
    
    // Çevre değişkenlerinden ayarları oku, yoksa config.json kullan
    config.host = process.env.MC_HOST || config.host;
    config.port = process.env.MC_PORT ? parseInt(process.env.MC_PORT) : config.port;
    
    if (process.env.MC_VERSION) {
      config.version = process.env.MC_VERSION.toLowerCase() === 'auto' ? false : process.env.MC_VERSION;
    }
    
    config.botCount = process.env.MC_BOT_COUNT ? parseInt(process.env.MC_BOT_COUNT) : config.botCount;
    config.botNamePrefix = process.env.MC_BOT_PREFIX || config.botNamePrefix;
    config.leaderName = process.env.MC_LEADER_NAME || config.leaderName || 'SpreadLeader';
    config.masterName = process.env.MC_MASTER_NAME || config.masterName || 'NuclearTactic';
    config.reconnectInterval = process.env.MC_RECONNECT_INTERVAL ? parseInt(process.env.MC_RECONNECT_INTERVAL) : config.reconnectInterval;
    config.autoDay     = process.env.MC_AUTO_DAY     ? process.env.MC_AUTO_DAY     === 'true' : (config.autoDay     !== undefined ? config.autoDay     : true);
    config.autoWeather = process.env.MC_AUTO_WEATHER ? process.env.MC_AUTO_WEATHER === 'true' : (config.autoWeather !== undefined ? config.autoWeather : true);
    config.groqApiKey  = process.env.GROQ_API_KEY  || process.env.MC_GROQ_API_KEY  || config.groqApiKey;
    config.groqModel   = process.env.GROQ_MODEL    || process.env.MC_GROQ_MODEL    || config.groqModel;

    console.log("Bulut Sunucu Ayarları:");
    console.log(`- Sunucu IP: ${config.host}`);
    console.log(`- Port: ${config.port}`);
    console.log(`- Sürüm: ${config.version}`);
    console.log(`- Bot Sayısı: ${config.botCount}`);
    console.log(`- İsim Ön Eki: ${config.botNamePrefix}`);
    console.log(`- Lider Bot İsmi: ${config.leaderName}`);
    console.log(`- Master Oyuncu (Yönetici): ${config.masterName}`);
    console.log(`- Otomatik Sabah Yapma (autoDay): ${config.autoDay}`);
    console.log(`- Otomatik Hava Temizleme (autoWeather): ${config.autoWeather}`);
    console.log(`- Yeniden Bağlanma Sıklığı: ${config.reconnectInterval / 1000} saniye`);
    console.log(`- Groq API Anahtarı: ${config.groqApiKey ? 'Tanımlı (***)' : 'Tanımlanmamış'}`);
    console.log(`- Groq Model: ${config.groqModel || 'llama-3.3-70b-versatile'}`);
    console.log("----------------------------------------------------------");

    // Web sunucusunu başlat
    startWebServer();
  } else {
    // Lokal interaktif terminal akışı
    console.log("Mevcut Ayarlar:");
    console.log(`- Sunucu IP: ${config.host}`);
    console.log(`- Port: ${config.port}`);
    console.log(`- Sürüm: ${config.version}`);
    console.log(`- Bot Sayısı: ${config.botCount}`);
    console.log(`- İsim Ön Eki: ${config.botNamePrefix}`);
    console.log(`- Otomatik Sabah Yapma: ${config.autoDay}`);
    console.log("----------------------------------------------------------");

    const useDefaultAns = await askQuestion("Varsayılan ayarlar ile başlatılsın mı? (E/H veya Yes/No): ");
    
    if (useDefaultAns.toLowerCase() === 'h' || useDefaultAns.toLowerCase() === 'n' || useDefaultAns.toLowerCase() === 'no') {
      console.log("\nYeni Ayarları Girin (Varsayılan değer için Enter'a basın):");
      
      const hostInput = await askQuestion(`Sunucu IP (${config.host}): `);
      if (hostInput) config.host = hostInput;

      const portInput = await askQuestion(`Sunucu Port (${config.port}): `);
      if (portInput) config.port = parseInt(portInput) || config.port;

      const versionInput = await askQuestion(`Minecraft Sürümü (Örn: 1.20.1 veya otomatik algılama için 'auto') (${config.version}): `);
      if (versionInput) {
        config.version = versionInput.toLowerCase() === 'auto' ? false : versionInput;
      }

      const botCountInput = await askQuestion(`Bot Sayısı (${config.botCount}): `);
      if (botCountInput) config.botCount = parseInt(botCountInput) || config.botCount;

      const botPrefixInput = await askQuestion(`Bot İsim Ön Eki (${config.botNamePrefix}): `);
      if (botPrefixInput) config.botNamePrefix = botPrefixInput;

      const autoDayInput = await askQuestion(`Gece olunca sabah yapılsın mı? (E/H) (${config.autoDay ? 'E' : 'H'}): `);
      if (autoDayInput) {
        config.autoDay = autoDayInput.toLowerCase() === 'e' || autoDayInput.toLowerCase() === 'y';
      }

      // Ayarları dosyaya kaydet
      saveConfig(config);
    }
  }

  console.log("\n[Sistem] Koordinatör ve Lider Bot başlatılıyor...");
  console.log("----------------------------------------------------------");

  const BotCoordinator = require('./coordinator');
  const coordinator = new BotCoordinator(config);

  // Başlangıçta sadece Lider Bot başlatılır.
  // Swarm botları, lider bot sunucuya bağlanıp oyuncu yokluğunu onayladığında koordinatör tarafından başlatılacaktır.
  createManagedBot(config, config.leaderName, true, coordinator);
}

main().catch(err => {
  console.error("[Sistem] Kritik Hata:", err);
});
