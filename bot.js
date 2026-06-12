const mineflayer = require('mineflayer');

/**
 * Bir Minecraft bot örneği oluşturur ve olayları yönetir.
 * @param {Object} config Bot yapılandırma ayarları
 * @param {string} username Botun kullanıcı adı
 */
function createManagedBot(config, username) {
  console.log(`[Sistem] ${username} oluşturuluyor ve bağlanılıyor...`);

  // Aternos ve benzeri sunucular için gecikmeyi ve yeniden bağlanma sürelerini artırıyoruz
  const reconnectDelay = config.reconnectInterval || 15000;

  const botOptions = {
    host: config.host,
    port: parseInt(config.port) || 25565,
    username: username,
    version: config.version || false, // false veya null ise mineflayer otomatik algılar
    skipValidation: true
  };

  let bot = mineflayer.createBot(botOptions);
  let moveInterval = null;
  let isReconnecting = false;

  // Rastgele hareket döngüsü
  function startRandomMovement() {
    if (!config.randomMovement) return;

    console.log(`[Hareket] ${username} için rastgele hareketler başlatıldı.`);

    moveInterval = setInterval(() => {
      if (!bot || !bot.entity) return;

      const actions = ['forward', 'back', 'left', 'right', 'jump', 'sneak'];
      const action = actions[Math.floor(Math.random() * actions.length)];
      const duration = Math.floor(Math.random() * 1500) + 500; // 500ms - 2000ms

      // Eylemi başlat
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
    }, Math.floor(Math.random() * 5000) + 3000); // Her 3-8 saniyede bir yeni hareket
  }

  function cleanup() {
    if (moveInterval) {
      clearInterval(moveInterval);
      moveInterval = null;
    }
    try {
      // Tüm olay dinleyicileri kaldırılıyor
      bot.removeAllListeners();
      // Kapatma esnasında gelebilecek geç soket hatalarının (ECONNRESET vb.) 
      // Node.js sürecini çökertmesini önlemek için boş bir hata dinleyicisi bırakıyoruz.
      bot.on('error', () => {});
    } catch (e) {}
  }

  function reconnect() {
    if (isReconnecting) return;
    isReconnecting = true;
    cleanup();

    console.log(`[Bağlantı] ${username} için ${reconnectDelay / 1000} saniye içinde yeniden bağlanılıyor...`);
    setTimeout(() => {
      createManagedBot(config, username);
    }, reconnectDelay);
  }

  // BOT OLAYLARI (EVENTS)

  // Giriş yapıldığında
  bot.once('spawn', () => {
    console.log(`[Giriş] ${username} başarıyla sunucuya girdi!`);
    startRandomMovement();
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
