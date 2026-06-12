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
  let followInterval = null;
  let danceTimeout = null;
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

  // Master Oyuncu (Komut verebilen tek oyuncu)
  const master = config.masterName || 'NuclearTactic';

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

  // Lider Bot Takip Sistemleri
  function startFollowing() {
    stopRandomMovement();
    if (followInterval) clearInterval(followInterval);
    followInterval = setInterval(() => {
      if (!bot) return;
      const player = bot.players[master];
      if (player && player.entity) {
        bot.lookAt(player.entity.position.offset(0, 1.6, 0));
        const distance = bot.entity.position.distanceTo(player.entity.position);
        if (distance > 3) {
          // 3 bloktan uzaksa doğrudan master oyuncunun yanına ışınlan
          bot.chat(`/tp ${master}`);
        }
      }
    }, 1500);
  }

  function stopFollowing() {
    if (followInterval) {
      clearInterval(followInterval);
      followInterval = null;
    }
  }

  // İnteraktif Dans Animasyonu (Eğlence Amaçlı)
  function startDancing() {
    stopRandomMovement();
    stopFollowing();
    if (danceTimeout) {
      clearInterval(danceTimeout);
      danceTimeout = null;
    }

    let isSneaking = false;
    let count = 0;

    danceTimeout = setInterval(() => {
      if (!bot || count > 15) {
        clearInterval(danceTimeout);
        danceTimeout = null;
        if (bot) bot.setControlState('sneak', false);
        startRandomMovement();
        return;
      }

      isSneaking = !isSneaking;
      bot.setControlState('sneak', isSneaking);
      if (count % 3 === 0) {
        bot.setControlState('jump', true);
        setTimeout(() => { if (bot) bot.setControlState('jump', false); }, 300);
      }
      count++;
    }, 400);
  }

  // Eşya İsteği Ayrıştırıcı (Türkçe & İngilizce Destekli)
  function parseItemRequest(message) {
    const words = message.toLowerCase().split(/\s+/);
    let quantity = 1;
    const numMatch = message.match(/\d+/);
    if (numMatch) {
      quantity = parseInt(numMatch[0]);
    }

    const translations = {
      'elmas': 'diamond',
      'altin': 'gold_ingot',
      'altın': 'gold_ingot',
      'demir': 'iron_ingot',
      'zumrut': 'emerald',
      'zümrüt': 'emerald',
      'kömür': 'coal',
      'komur': 'coal',
      'tas': 'stone',
      'taş': 'stone',
      'toprak': 'dirt',
      'ekmek': 'bread',
      'tahta': 'oak_planks',
      'odun': 'oak_log',
      'kılıç': 'diamond_sword',
      'kilic': 'diamond_sword',
      'kazma': 'diamond_pickaxe',
      'balta': 'diamond_axe',
      'kürek': 'diamond_shovel',
      'kurek': 'diamond_shovel',
      'yay': 'bow',
      'ok': 'arrow',
      'meşale': 'torch',
      'mesale': 'torch',
      'blok': 'dirt',
      'obsidyen': 'obsidian',
      'biftek': 'cooked_beef'
    };

    const filterWords = ['swarm', 'leader', 'lider', '001', 'ver', 'give', 'at', 'toss', 'drop', 'get', 'lütfen', 'please', 'bana', 'me', 'tane', 'adet', 'x', '_'];
    const itemWords = words.filter(w => {
      return !w.match(/^\d+$/) && !filterWords.includes(w) && w.replace(/[^a-z]/g, '').length > 0;
    });

    let requestedItem = itemWords[0] || 'diamond';
    if (translations[requestedItem]) {
      requestedItem = translations[requestedItem];
    }

    return { item: requestedItem, quantity: quantity };
  }

  // Eşya Vermeyi Gerçekleştiren Fonksiyon
  async function handleGiveRequest(item, quantity) {
    console.log(`[Lider] Eşya isteği alındı: ${quantity}x ${item}`);
    bot.chat(`/give ${bot.username} ${item} ${quantity}`);

    // Eşyanın envantere yüklenmesi için 1.5 saniye bekle
    await new Promise(resolve => setTimeout(resolve, 1500));

    if (!bot || !bot.inventory) return;

    const items = bot.inventory.items();
    const matchingItems = items.filter(i => i.name.includes(item) || item.includes(i.name));

    if (matchingItems.length > 0) {
      try {
        const player = bot.players[master];
        if (player && player.entity) {
          await bot.lookAt(player.entity.position.offset(0, 1.6, 0));
        }
        for (const targetItem of matchingItems) {
          await bot.tossStack(targetItem);
        }
        bot.chat(`${quantity} adet ${item} verdim!`);
      } catch (err) {
        console.error('Toss error:', err);
        bot.chat('Eşyayı atarken bir sorun oluştu.');
      }
    } else {
      bot.chat('İstediğin eşyayı envanterimde bulamadım veya geçersiz eşya adı.');
    }
  }

  function cleanup() {
    stopRandomMovement();
    stopFollowing();
    if (danceTimeout) {
      clearInterval(danceTimeout);
      danceTimeout = null;
    }
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

  // Sohbet komutlarını algılayıcı (SADECE LİDER BOT)
  bot.on('chat', async (sender, message) => {
    if (!isLeader) return;
    if (sender.toLowerCase() !== master.toLowerCase()) return;

    // Kendisine seslenip seslenilmediğini kontrol et (Küçük/büyük harf ve özel karakterlerden bağımsız)
    const cleanMsg = message.toLowerCase().replace(/[^a-z]/g, '');
    const cleanBotName = bot.username.toLowerCase().replace(/[^a-z]/g, '');

    const isAddressed = 
      cleanMsg.includes(cleanBotName) || 
      message.toLowerCase().includes('leader') ||
      message.toLowerCase().includes('lider');

    if (!isAddressed) return;

    console.log(`[Lider Chat] Master oyuncudan komut alındı: "${message}"`);
    const lowerMsg = message.toLowerCase();

    // 1. Takip etme komutu
    if (lowerMsg.includes('takip') || lowerMsg.includes('follow') || lowerMsg.includes('arkamdan')) {
      bot.chat('Seni takip ediyorum!');
      startFollowing();
      return;
    }

    // 2. Durma komutu
    if (lowerMsg.includes('dur') || lowerMsg.includes('stop') || lowerMsg.includes('kal') || lowerMsg.includes('stay') || lowerMsg.includes('bekle')) {
      bot.chat('Duruyorum.');
      stopFollowing();
      return;
    }

    // 3. Teleport/Gelme komutu
    if (lowerMsg.includes('tp') || lowerMsg.includes('gel') || lowerMsg.includes('come') || lowerMsg.includes('teleport') || lowerMsg.includes('buraya') || lowerMsg.includes('here')) {
      bot.chat('Geliyorum!');
      bot.chat(`/tp ${master}`);
      return;
    }

    // 4. Eşya isteme komutu
    if (lowerMsg.includes('ver') || lowerMsg.includes('give') || lowerMsg.includes('at') || lowerMsg.includes('toss') || lowerMsg.includes('drop') || lowerMsg.includes('get')) {
      const { item, quantity } = parseItemRequest(message);
      bot.chat(`${quantity} adet ${item} hazırlıyorum...`);
      await handleGiveRequest(item, quantity);
      return;
    }

    // ─── SOHBET & DANS DİYALOGLARI ───────────────────────────────────────────────────
    const normalized = lowerMsg.replace(/[^a-z0-9çğıöşü]/g, '');

    // Selamlaşma
    if (normalized.includes('selam') || normalized.includes('merhaba') || normalized.includes('hello') || normalized.includes('hey') || normalized === 'sa' || normalized === 'slm') {
      const replies = [
        `Selam master! Bugün ne yapıyoruz?`,
        `Merhaba ${master}! Emrindeyim.`,
        `Aleykümselam master, hoş geldin!`
      ];
      bot.chat(replies[Math.floor(Math.random() * replies.length)]);
      return;
    }

    // Hal hatır sorma
    if (normalized.includes('nasilsin') || normalized.includes('nasılsın') || normalized.includes('keyifler') || normalized.includes('nasılgidiyor')) {
      const replies = [
        `Harikayım master! Sunucu saat gibi çalışıyor. Sen nasılsın?`,
        `İyiyim master, seninle oynamak harika!`,
        `7/24 nöbetteyim, yorulmak nedir bilmem! Sen nasılsın?`
      ];
      bot.chat(replies[Math.floor(Math.random() * replies.length)]);
      return;
    }

    // Ne yapıyorsun
    if (normalized.includes('neyapiyorsun') || normalized.includes('neyapıyorsun') || normalized.includes('napıyorsun') || normalized.includes('napiyorsun') || normalized.includes('neediyorsun') || normalized.includes('neediyon')) {
      const replies = [
        `Sunucuyu gözetliyorum master, her şey kontrolüm altında.`,
        `Gece olmasını bekliyorum ki sabah yapayım! :)`,
        `Seni izliyorum master, harika oynuyorsun!`
      ];
      bot.chat(replies[Math.floor(Math.random() * replies.length)]);
      return;
    }

    // Kimsin
    if (normalized.includes('kimsin') || normalized.includes('adınne') || normalized.includes('adinne') || normalized.includes('nesinsen')) {
      const replies = [
        `Ben senin sadık Lider Botunum. Bu sunucunun koruyucusuyum!`,
        `Adım ${bot.username}, senin için buradayım master!`
      ];
      bot.chat(replies[Math.floor(Math.random() * replies.length)]);
      return;
    }

    // Dans etme
    if (normalized.includes('dans') || normalized.includes('oyna') || normalized.includes('sıkıldım') || normalized.includes('sikildim')) {
      bot.chat('Hemen senin için dans ediyorum, izle! :)');
      startDancing();
      return;
    }

    // Övgüler
    if (normalized.includes('adamsın') || normalized.includes('adamsin') || normalized.includes('cansın') || normalized.includes('cansin') || normalized.includes('kral') || normalized.includes('helal')) {
      const replies = [
        `Eyvallah master, senin yanında stajyeriz!`,
        `Kral sensin master!`,
        `Teşekkürler, senin için her şeye değer.`
      ];
      bot.chat(replies[Math.floor(Math.random() * replies.length)]);
      return;
    }

    // Varsayılan yanıt
    const defaultReplies = [
      `Dediğini duydum master ama tam anlayamadım. Bana 'gel', 'takip et', 'dur', 'dans et' diyebilirsin veya benden '64 elmas' isteyebilirsin!`,
      `Ben sadece basit bir botum master, ama senin için çalışıyorum!`,
      `Bunu kelime dağarcığıma eklemeliyim! Şunu mu demek istedin: 'lider bana 64 ekmek ver'?`
    ];
    bot.chat(defaultReplies[Math.floor(Math.random() * defaultReplies.length)]);
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

  // Hata yakalayıcı
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
