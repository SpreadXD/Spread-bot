const mineflayer = require('mineflayer');

/**
 * Bir Minecraft bot örneği oluşturur ve olayları yönetir.
 * @param {Object} config Bot yapılandırma ayarları
 * @param {string} username Botun kullanıcı adı
 * @param {boolean} isLeader Lider bot mu? (her zaman sunucuda kalır)
 * @param {Object} coordinator Merkezi koordinatör nesnesi
 */
function createManagedBot(config, username, isLeader = false, coordinator = null) {
  console.log(`[Sistem] ${username} oluşturuluyor... [${isLeader ? 'LİDER' : 'SWARM'}]`);

  // Lider bot anında yeniden bağlanır (3sn), diğerleri biraz bekler (varsayılan 15sn)
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

  // Botu koordinatöre kaydet
  if (coordinator) {
    if (isLeader) {
      coordinator.setLeader(bot);
    } else {
      coordinator.registerSwarm(username, bot);
    }
  }

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
    if (coordinator && !isLeader) {
      coordinator.unregisterSwarm(username);
    }
    try {
      bot.removeAllListeners();
      bot.on('error', () => {});
    } catch (e) {}
  }

  function reconnect() {
    if (isReconnecting) return;

    // Swarm botlar için kontrol: eğer gerçek oyuncu varsa veya coordinator aktif değilse bağlanma
    if (!isLeader && coordinator && !coordinator.shouldSwarmBeOnline) {
      console.log(`[Bağlantı] ${username} için yeniden bağlanma iptal edildi (gerçek oyuncu var veya swarm inaktif).`);
      return;
    }

    isReconnecting = true;
    cleanup();
    console.log(`[Bağlantı] ${username} için ${reconnectDelay / 1000}sn içinde yeniden bağlanılıyor...`);
    setTimeout(() => {
      // Bağlanmadan hemen önce tekrar kontrol
      if (!isLeader && coordinator && !coordinator.shouldSwarmBeOnline) {
        console.log(`[Bağlantı] ${username} için bağlantı zamanı geldi ama gerçek oyuncu var. Bağlantı kurulmuyor.`);
        isReconnecting = false;
        return;
      }
      createManagedBot(config, username, isLeader, coordinator);
    }, reconnectDelay);
  }

  // ─── BOT OLAYLARI ────────────────────────────────────────────────────────────

  bot.once('spawn', () => {
    console.log(`[Giriş] ${username} sunucuya girdi!`);

    const realPlayers = getRealPlayerCount();
    
    // Koordinatörün oyuncu durumunu güncelle
    if (coordinator) {
      coordinator.updateRealPlayerCount(realPlayers);
    }

    if (!isLeader) {
      // Swarm bot: sunucuda gerçek oyuncu varsa veya koordinatör aktif değilse hemen çık
      if (realPlayers > 0 || (coordinator && !coordinator.shouldSwarmBeOnline)) {
        console.log(`[Swarm] Gerçek oyuncu var veya swarm inaktif. ${username} sunucudan çıkıyor...`);
        cleanup();
        try { bot.quit(); } catch(e) {}
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
      
      const realPlayers = getRealPlayerCount();
      if (coordinator) {
        coordinator.updateRealPlayerCount(realPlayers);
      }

      if (!isLeader) {
        // Swarm botlar çıksın
        console.log(`[Swarm] ${username} sunucudan çıkıyor (gerçek oyuncu girdi)...`);
        cleanup();
        try { bot.quit(); } catch(e) {}
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

      if (coordinator) {
        coordinator.updateRealPlayerCount(remaining);
      }

      if (remaining === 0 && isLeader) {
        // Lider bot yeniden harekete başlasın
        console.log(`[Lider] Sunucuda gerçek oyuncu kalmadı. ${username} harekete başlıyor...`);
        startRandomMovement();
      }
    }
  });

  // Zaman kontrolü (SADECE LİDER BOT)
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

    // ─ Hava durumu kontrolü ─
    if (config.autoWeather && realPlayers === 0 && bot.isRaining) {
      if (now - lastWeatherClear > 30000) {
        lastWeatherClear = now;
        console.log(`[Lider] Yağmur/Fırtına + gerçek oyuncu yok → /weather clear`);
        bot.chat('/weather clear 1000000');
      }
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
    // Lider bot her durumda yeniden bağlanır, swarm botlar sadece coordinator izin veriyorsa
    if (isLeader) {
      reconnect();
    } else {
      if (coordinator && coordinator.shouldSwarmBeOnline) {
        reconnect();
      } else {
        console.log(`[Swarm] ${username} reconnect iptal edildi (gerçek oyuncu var veya swarm pasif).`);
      }
    }
  });
}

module.exports = { createManagedBot };
