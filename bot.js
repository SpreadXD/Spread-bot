const mineflayer = require('mineflayer');

/**
 * Bir Minecraft bot örneği oluşturur ve olayları yönetir.
 * @param {Object} config Bot yapılandırma ayarları
 * @param {string} username Botun kullanıcı adı
 * @param {boolean} isLeader Zaman yönetimi ve özel komutları çalıştıracak lider bot mu?
 */
function createManagedBot(config, username, isLeader = false) {
  console.log(`[Sistem] ${username} oluşturuluyor ve bağlanılıyor... Lider: ${isLeader}`);

  const reconnectDelay = config.reconnectInterval || 15000;

  const botOptions = {
    host: config.host,
    port: parseInt(config.port) || 25565,
    username: username,
    version: config.version || false,
    skipValidation: true
  };

  let bot = mineflayer.createBot(botOptions);
  let moveInterval = null;
  let isReconnecting = false;
  let lastTimeSet = 0;

  // Rastgele hareket döngüsü
  function startRandomMovement() {
    if (!config.randomMovement) return;

    console.log(`[Hareket] ${username} için rastgele hareketler başlatıldı.`);

    moveInterval = setInterval(() => {
      if (!bot || !bot.entity) return;

      const actions = ['forward', 'back', 'left', 'right', 'jump', 'sneak'];
      const action = actions[Math.floor(Math.random() * actions.length)];
      const duration = Math.floor(Math.random() * 1500) + 500; // 500ms - 2000ms

      if (action === 'jump') {
        bot.setControlState('jump', true);
        setTimeout(() => {
          if (bot) bot.setControlState('jump', false);
        }, 500);
      } else {
        bot.setControlState(action, true);
        setTimeout(() => {
          if (bot) bot.setControlState(action, false);
        }, duration);
      }
    }, Math.floor(Math.random() * 5000) + 3000);
  }

  function cleanup() {
    if (moveInterval) {
      clearInterval(moveInterval);
      moveInterval = null;
    }
    try {
      bot.removeAllListeners();
      bot.on('error', () => {});
    } catch (e) {}
  }

  function reconnect() {
    if (isReconnecting) return;
    isReconnecting = true;
    cleanup();

    console.log(`[Bağlantı] ${username} için ${reconnectDelay / 1000} saniye içinde yeniden bağlanılıyor...`);
    setTimeout(() => {
      createManagedBot(config, username, isLeader);
    }, reconnectDelay);
  }

  // BOT OLAYLARI (EVENTS)

  // Giriş yapıldığında
  bot.once('spawn', () => {
    console.log(`[Giriş] ${username} başarıyla sunucuya girdi!`);
    startRandomMovement();
  });

  // Zaman kontrolü (Sadece Lider Bot ve autoDay aktifse çalışır)
  bot.on('time', () => {
    if (!isLeader || !config.autoDay) return;
    if (!bot || !bot.time) return;

    const timeOfDay = bot.time.timeOfDay;
    const now = Date.now();

    // Minecraft'ta gece 13000 (gün batımı) ile başlar, 23000 (gün doğumu) arası sürer
    // Spam yapmamak için en az 30 saniye bekleme süresi koyuyoruz
    if (timeOfDay >= 13000 && timeOfDay < 23000 && (now - lastTimeSet > 30000)) {
      lastTimeSet = now;
      console.log(`[Zaman Kontrolü] Gece vakti algılandı. Sunucu saati sabah yapılıyor...`);
      
      // Minecraft chat komutunu gönderir (Op yetkisi gerektirir)
      bot.chat('/time set day');
    }
  });

  // Ölme durumunda otomatik doğma
  bot.on('death', () => {
    console.log(`[Ölüm] ${username} öldü!`);
    if (config.autoRespawn) {
      console.log(`[Doğma] ${username} yeniden doğuyor...`);
      bot.respawn();
    }
  });

  // Sunucudan atılma durumunda
  bot.on('kicked', (reason) => {
    const reasonText = typeof reason === 'object' ? JSON.stringify(reason) : reason;
    console.warn(`[Atıldı] ${username} sunucudan atıldı! Sebep: ${reasonText}`);
    reconnect();
  });

  // Hata durumunda
  bot.on('error', (err) => {
    console.error(`[Hata] ${username} hatası:`, err.message || err);
    reconnect();
  });

  // Bağlantı koptuğunda
  bot.on('end', () => {
    console.log(`[Bağlantı Kesildi] ${username} sunucudan koptu.`);
    reconnect();
  });
}

module.exports = { createManagedBot };
