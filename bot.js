const mineflayer = require('mineflayer');

/**
 * Bir Minecraft bot örneği oluşturur ve olayları yönetir.
 * @param {Object} config Bot yapılandırma ayarları
 * @param {string} username Botun kullanıcı adı
 * @param {boolean} isLeader Lider bot mu? (her zaman sunucuda kalır)
 */
function createManagedBot(config, username, isLeader = false) {
  console.log(`[Sistem] ${username} oluşturuluyor... [${isLeader ? 'LİDER' : 'SWARM'}]`);

  // Lider bot anında yeniden bağlanır, diğerleri biraz bekler
  const reconnectDelay = isLeader ? 3000 : (config.reconnectInterval || 15000);

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
  let lastWeatherClear = 0;

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
      if (!isBot) realCount++;
    }
    return realCount;
  }

  function startRandomMovement() {
    if (!config.randomMovement) return;
    if (moveInterval) return;

    moveInterval = setInterval(() => {
      if (!bot || !bot.entity) return;
      const actions = ['forward', 'back', 'left', 'right', 'jump', 'sneak'];
      const action = actions[Math.floor(Math.random() * actions.length)];
      const duration = Math.floor(Math.random() * 1500) + 500;

      if (action === 'jump') {
        bot.setControlState('jump', true);
        setTimeout(() => { if (bot) bot.setControlState('jump', false); }, 500);
      } else {
        bot.setControlState(action, true);
        setTimeout(() => { if (bot) bot.setControlState(action, false); }, duration);
      }
    }, Math.floor(Math.random() * 5000) + 3000);
  }

  function stopRandomMovement() {
    if (moveInterval) {
      clearInterval(moveInterval);
      moveInterval = null;
    }
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

  function reconnect() {
    if (isReconnecting) return;
    isReconnecting = true;
    cleanup();
    console.log(`[Bağlantı] ${username} için ${reconnectDelay / 1000}sn içinde yeniden bağlanılıyor...`);
    setTimeout(() => {
      createManagedBot(config, username, isLeader);
    }, reconnectDelay);
  }

  // ─── BOT OLAYLARI ────────────────────────────────────────────────────────────

  bot.once('spawn', () => {
    console.log(`[Giriş] ${username} sunucuya girdi!`);

    if (!isLeader) {
      // Swarm bot: sunucuda gerçek oyuncu varsa hemen çık
      const realPlayers = getRealPlayerCount();
      if (realPlayers > 0) {
        console.log(`[Swarm] ${realPlayers} gerçek oyuncu var. ${username} çıkıyor...`);
        reconnect();
        return;
      }
    }

    startRandomMovement();
  });

  // Gerçek oyuncu sunucuya girdiğinde
  bot.on('playerJoined', (player) => {
    const isBotPlayer =
      player.username === config.leaderName ||
      player.username.startsWith(config.botNamePrefix || 'SwarmBot_');

    if (!isBotPlayer) {
      console.log(`[Oyuncu] "${player.username}" sunucuya girdi!`);
      if (!isLeader) {
        // Swarm botlar çıksın
        console.log(`[Swarm] ${username} sunucudan çıkıyor (gerçek oyuncu var)...`);
        stopRandomMovement();
        reconnect();
      } else {
        // Lider kalsın ama hareketi durdur (gereksiz lag yapmasın)
        console.log(`[Lider] Gerçek oyuncu var. ${username} hareketsiz bekliyor...`);
        stopRandomMovement();
      }
    }
  });

  // Gerçek oyuncu sunucudan çıktığında
  bot.on('playerLeft', (player) => {
    const isBotPlayer =
      player.username === config.leaderName ||
      player.username.startsWith(config.botNamePrefix || 'SwarmBot_');

    if (!isBotPlayer) {
      const remaining = getRealPlayerCount();
      console.log(`[Oyuncu] "${player.username}" çıktı. Kalan gerçek oyuncu: ${remaining}`);

      if (remaining === 0 && isLeader) {
        // Lider bot yeniden harekete başlasın
        console.log(`[Lider] Sunucuda gerçek oyuncu kalmadı. ${username} harekete başlıyor...`);
        startRandomMovement();
      }
    }
  });

  // Zaman ve hava durumu kontrolü (SADECE LİDER BOT)
  bot.on('time', () => {
    if (!isLeader) return;
    if (!bot || !bot.time) return;

    const now = Date.now();
    const realPlayers = getRealPlayerCount();

    // ─ Gece kontrolü ─
    if (config.autoDay && realPlayers === 0) {
      const timeOfDay = bot.time.timeOfDay;
      if (timeOfDay >= 13000 && timeOfDay < 23000 && (now - lastTimeSet > 30000)) {
        lastTimeSet = now;
        console.log(`[Lider] Gece + gerçek oyuncu yok → /time set day`);
        bot.chat('/time set day');
      }
    }
  });

  // Hava durumu değiştiğinde kontrol (SADECE LİDER BOT)
  bot.on('rain', () => {
    if (!isLeader || !config.autoWeather) return;

    const now = Date.now();
    // Spam koruması: 30 saniyede bir
    if (now - lastWeatherClear < 30000) return;

    const realPlayers = getRealPlayerCount();
    if (realPlayers === 0) {
      lastWeatherClear = now;
      console.log(`[Lider] Kötü hava algılandı + gerçek oyuncu yok → /weather clear`);
      bot.chat('/weather clear 1000000');
    }
  });

  // ─── STANDART OLAYLAR ─────────────────────────────────────────────────────────

  bot.on('death', () => {
    console.log(`[Ölüm] ${username} öldü!`);
    if (config.autoRespawn) {
      console.log(`[Doğma] ${username} yeniden doğuyor...`);
      bot.respawn();
    }
  });

  bot.on('kicked', (reason) => {
    const reasonText = typeof reason === 'object' ? JSON.stringify(reason) : reason;
    console.warn(`[Atıldı] ${username} sunucudan atıldı! Sebep: ${reasonText}`);
    reconnect();
  });

  bot.on('error', (err) => {
    console.error(`[Hata] ${username}:`, err.message || err);
    reconnect();
  });

  bot.on('end', () => {
    console.log(`[Koptu] ${username} bağlantısı kesildi.`);
    reconnect();
  });
}

module.exports = { createManagedBot };
