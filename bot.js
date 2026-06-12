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

  /**
   * Sunucudaki gerçek oyuncu sayısını döndürür.
   * Bot kullanıcı adları (leaderName veya botNamePrefix ile başlayanlar) sayılmaz.
   */
  function getRealPlayerCount() {
    if (!bot || !bot.players) return 0;

    let realCount = 0;
    for (const playerName of Object.keys(bot.players)) {
      const isBot =
        playerName === config.leaderName ||
        playerName.startsWith(config.botNamePrefix || 'SwarmBot_');
      if (!isBot) {
        realCount++;
      }
    }
    return realCount;
  }

  // Rastgele hareket döngüsü
  function startRandomMovement() {
    if (!config.randomMovement) return;
    if (moveInterval) return; // Zaten çalışıyorsa tekrar başlatma

    console.log(`[Hareket] ${username} için rastgele hareketler başlatıldı.`);

    moveInterval = setInterval(() => {
      if (!bot || !bot.entity) return;

      const actions = ['forward', 'back', 'left', 'right', 'jump', 'sneak'];
      const action = actions[Math.floor(Math.random() * actions.length)];
      const duration = Math.floor(Math.random() * 1500) + 500;

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

  function stopRandomMovement() {
    if (moveInterval) {
      clearInterval(moveInterval);
      moveInterval = null;
    }
    // Botun tüm hareketlerini durdur
    if (bot) {
      try {
        ['forward', 'back', 'left', 'right', 'jump', 'sneak'].forEach(ctrl => {
          bot.setControlState(ctrl, false);
        });
      } catch (e) {}
    }
  }

  function cleanup() {
    stopRandomMovement();
    try {
      bot.removeAllListeners();
      bot.on('error', () => {});
    } catch (e) {}
  }

  function reconnect(delay) {
    if (isReconnecting) return;
    isReconnecting = true;
    cleanup();

    const waitTime = delay || reconnectDelay;
    console.log(`[Bağlantı] ${username} için ${waitTime / 1000} saniye içinde yeniden bağlanılıyor...`);
    setTimeout(() => {
      createManagedBot(config, username, isLeader);
    }, waitTime);
  }

  // BOT OLAYLARI (EVENTS)

  bot.once('spawn', () => {
    console.log(`[Giriş] ${username} başarıyla sunucuya girdi!`);
    
    // Spawn anında zaten gerçek oyuncu var mı kontrol et
    const realPlayers = getRealPlayerCount();
    if (realPlayers > 0) {
      console.log(`[Kontrol] ${realPlayers} gerçek oyuncu bulundu. ${username} sunucudan çıkıyor...`);
      reconnect(reconnectDelay);
      return;
    }

    startRandomMovement();
  });

  // Oyuncu listeye eklendiğinde (birileri sunucuya girdiğinde)
  bot.on('playerJoined', (player) => {
    const isBot =
      player.username === config.leaderName ||
      player.username.startsWith(config.botNamePrefix || 'SwarmBot_');

    if (!isBot) {
      console.log(`[Uyarı] Gerçek oyuncu "${player.username}" sunucuya girdi! ${username} çıkıyor...`);
      stopRandomMovement();
      reconnect(reconnectDelay);
    }
  });

  // Oyuncu listeden çıktığında (birileri sunucudan ayrıldığında)
  bot.on('playerLeft', (player) => {
    const isBot =
      player.username === config.leaderName ||
      player.username.startsWith(config.botNamePrefix || 'SwarmBot_');

    if (!isBot) {
      const remaining = getRealPlayerCount();
      console.log(`[Bilgi] "${player.username}" sunucudan çıktı. Kalan gerçek oyuncu: ${remaining}`);

      if (remaining === 0) {
        console.log(`[Bilgi] Sunucuda gerçek oyuncu kalmadı. ${username} harekete başlıyor...`);
        startRandomMovement();
      }
    }
  });

  // Zaman kontrolü (Sadece Lider Bot, autoDay aktif VE gerçek oyuncu yoksa çalışır)
  bot.on('time', () => {
    if (!isLeader || !config.autoDay) return;
    if (!bot || !bot.time) return;

    // Gerçek oyuncu varsa zaman değiştirme
    if (getRealPlayerCount() > 0) return;

    const timeOfDay = bot.time.timeOfDay;
    const now = Date.now();

    // Gece aralığı: 13000 (gün batımı) - 23000 (gün doğumu)
    // Spam koruması: 30 saniyede bir en fazla bir kez yap
    if (timeOfDay >= 13000 && timeOfDay < 23000 && (now - lastTimeSet > 30000)) {
      lastTimeSet = now;
      console.log(`[Zaman] Gece algılandı ve gerçek oyuncu yok. Sabah yapılıyor...`);
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
