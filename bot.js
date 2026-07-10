const mineflayer = require('mineflayer');
const https = require('https');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

/**
 * Groq API'sini kullanarak yapay zekadan cevap alır.
 * @param {string} apiKey Groq API Anahtarı
 * @param {string} model Groq LLM Modeli
 * @param {string} prompt Kullanıcı mesajı
 * @param {string} botName Botun adı (lider bot)
 * @param {string} masterName Komut veren master oyuncu adı
 * @returns {Promise<string>} AI cevabı
 */
function askGroq(apiKey, model, prompt, botName, masterName) {
  return new Promise((resolve, reject) => {
    const defaultModel = model || 'llama-3.3-70b-versatile';
    const postData = JSON.stringify({
      model: defaultModel,
      messages: [
        {
          role: "system",
          content: `Sen Minecraft oyununda sadık bir lider asistan botsun. Adın "${botName}". Efendin/yöneticin "${masterName}". Sana verilen Minecraft chat komutlarını veya normal sohbet mesajlarını yanıtlıyorsun. Türkçe yanıt ver. Cevapların çok uzun olmasın (ortalama 1-2 kısa cümle), samimi, eğlenceli ve yardımsever olsun. Minecraft terimlerini bil.`
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 7000 // 7 saniye zaman aşımı
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
            resolve(parsed.choices[0].message.content.trim());
          } else if (parsed.error) {
            reject(new Error(parsed.error.message || 'Groq API Hatası'));
          } else {
            reject(new Error('Geçersiz API Yanıtı'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Groq API Zaman Aşımı'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Uzun mesajları Minecraft'ın 256 karakter sınırına takılmayacak şekilde
 * parçalara bölerek ve aralarında küçük bir gecikmeyle gönderir.
 * @param {Object} bot Mineflayer bot nesnesi
 * @param {string} fullMessage Gönderilecek tam mesaj
 */
async function sendSplitMessage(bot, fullMessage) {
  if (!bot || !fullMessage) return;
  
  // Satırlara böl ve 240 karakterden uzun olanları parçala
  const maxLen = 240;
  const words = fullMessage.replace(/\n/g, ' ').split(' ');
  let currentLine = '';
  const lines = [];

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > maxLen) {
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      currentLine = word;
    } else {
      currentLine = (currentLine + ' ' + word).trim();
    }
  }
  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  // Sırayla 500ms aralıklarla gönder
  for (const line of lines) {
    bot.chat(line);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}


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
  bot.loadPlugin(pathfinder);
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

  // Master Oyuncular (Virgülle ayrılmış birden fazla isim destekler)
  const authorizedMasters = (config.masterName || 'NuclearTactic').split(',').map(n => n.trim().toLowerCase());
  let master = (config.masterName || 'NuclearTactic').split(',')[0].trim();

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

    // Pathfinder ayarları — kapıları açabilsin, blok kırmasın
    const defaultMove = new Movements(bot);
    defaultMove.canDig = false;
    defaultMove.canOpenDoors = true;
    bot.pathfinder.setMovements(defaultMove);

    // GoalFollow: hedefi sürekli takip et (2 blok mesafede dur)
    const playerEntry = bot.players[master];
    if (playerEntry && playerEntry.entity) {
      bot.pathfinder.setGoal(new goals.GoalFollow(playerEntry.entity, 2), true);
    }

    // Sürekli hedefi güncelle: her 1.5sn'de goal yenile (entity ref güncellenir)
    followInterval = setInterval(() => {
      if (!bot || !bot.entity) return;
      const pl = bot.players[master];
      if (!pl) return;

      if (pl.entity) {
        const distance = bot.entity.position.distanceTo(pl.entity.position);

        if (distance > 40) {
          // Çok uzaksa ışınlan, sonra yeniden pathfind et
          bot.chat(`/tp ${master}`);
          setTimeout(() => {
            if (!bot) return;
            const pl2 = bot.players[master];
            if (pl2 && pl2.entity) {
              bot.pathfinder.setGoal(new goals.GoalFollow(pl2.entity, 2), true);
            }
          }, 1200);
        } else {
          // Hedefi sürekli güncelle ki bot asla durmasın
          try {
            bot.pathfinder.setGoal(new goals.GoalFollow(pl.entity, 2), true);
          } catch (e) {}
          // Yakındayken yüzünü master'a döndür
          if (distance < 5) {
            bot.lookAt(pl.entity.position.offset(0, 1.6, 0));
          }
        }
      } else {
        // Oyuncu render dışındaysa ışınlan
        bot.chat(`/tp ${master}`);
      }
    }, 1500);
  }

  function stopFollowing() {
    if (followInterval) {
      clearInterval(followInterval);
      followInterval = null;
    }
    if (bot && bot.pathfinder) {
      try {
        bot.pathfinder.setGoal(null);
      } catch (e) {}
    }
  }

  // Envanteri tamamen at (tüm eşyalar)
  async function handleDropInventory() {
    if (!bot || !bot.inventory) return;
    const items = bot.inventory.items();
    if (items.length === 0) {
      bot.chat('Envanterim zaten boş master!');
      return;
    }
    bot.chat(`Envanterdeki ${items.length} çeşit eşyayı atıyorum...`);
    const player = bot.players[master];
    if (player && player.entity) {
      await bot.lookAt(player.entity.position.offset(0, 1.6, 0));
    }
    for (const item of items) {
      try {
        await bot.tossStack(item);
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {}
    }
    bot.chat('Tüm envanterimi attım master!');
  }

  // Sadece eldeki eşyayı at
  async function handleDropHeldItem() {
    if (!bot || !bot.inventory) return;
    const heldItem = bot.inventory.slots[bot.quickBarSlot + 36];
    if (!heldItem) {
      bot.chat('Elimde bir şey yok master!');
      return;
    }
    bot.chat(`Elimdeki ${heldItem.name} eşyasını atıyorum...`);
    const player = bot.players[master];
    if (player && player.entity) {
      await bot.lookAt(player.entity.position.offset(0, 1.6, 0));
    }
    try {
      await bot.tossStack(heldItem);
      bot.chat('Elimdekini attım master!');
    } catch (e) {
      bot.chat('Eşyayı atarken hata oluştu.');
    }
  }

  // 360 Derece Dönme Hareketi
  function startSpinning360() {
    stopRandomMovement();
    stopFollowing();
    
    let currentYaw = bot.entity.yaw;
    const steps = 20;
    const stepDelay = 50;
    const yawStep = (2 * Math.PI) / steps;
    let step = 0;
    
    const spinInterval = setInterval(() => {
      if (!bot) {
        clearInterval(spinInterval);
        return;
      }
      currentYaw += yawStep;
      bot.look(currentYaw, bot.entity.pitch, true);
      step++;
      if (step >= steps) {
        clearInterval(spinInterval);
        bot.chat("360 derece döndüm master!");
        startRandomMovement();
      }
    }, stepDelay);
  }

  // Evet Anlamında Kafa Sallama (Yukarı-Aşağı)
  async function startNodding() {
    stopRandomMovement();
    stopFollowing();

    // Önce master oyuncuya odaklan
    const player = bot.players[master];
    if (player && player.entity) {
      await bot.lookAt(player.entity.position.offset(0, 1.6, 0));
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    if (!bot) return;
    
    const originalPitch = bot.entity.pitch;
    const pitchChanges = [0.4, -0.4, 0.4, -0.4, 0.4, -0.4, 0];
    
    for (const p of pitchChanges) {
      if (!bot) break;
      await bot.look(bot.entity.yaw, originalPitch + p, true);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    if (bot) {
      bot.chat("Kafamı salladım master!");
      startRandomMovement();
    }
  }

  // Hayır Anlamında Kafa Sallama (Sağa-Sola)
  async function startShakingHead() {
    stopRandomMovement();
    stopFollowing();

    // Önce master oyuncuya odaklan
    const player = bot.players[master];
    if (player && player.entity) {
      await bot.lookAt(player.entity.position.offset(0, 1.6, 0));
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    if (!bot) return;
    
    const originalYaw = bot.entity.yaw;
    const yawChanges = [0.4, -0.4, 0.4, -0.4, 0.4, -0.4, 0];
    
    for (const y of yawChanges) {
      if (!bot) break;
      await bot.look(originalYaw + y, bot.entity.pitch, true);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    if (bot) {
      bot.chat("Hayır anlamında kafamı salladım master.");
      startRandomMovement();
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
    if (!authorizedMasters.includes(sender.toLowerCase())) return;

    // Kim komut veriyorsa güncel "master" o olur (takip, eşya verme, dönme işlemleri ona odaklanır)
    master = sender;

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
    if (lowerMsg.includes('takip') || lowerMsg.includes('follow') || lowerMsg.includes('arkamdan') ||
        lowerMsg.includes('peşim') || lowerMsg.includes('yanıma gel') || lowerMsg.includes('yanımda kal')) {
      bot.chat('Seni takip ediyorum!');
      startFollowing();
      return;
    }

    // 2. Durma komutu
    if (lowerMsg.includes('dur') || lowerMsg.includes('stop') || lowerMsg.includes('stay') ||
        lowerMsg.includes('bekle') || lowerMsg.includes('takibi bırak') || lowerMsg.includes('gelme')) {
      bot.chat('Duruyorum.');
      stopFollowing();
      startRandomMovement();
      return;
    }

    // 3. Teleport/Gelme komutu (önce kontrol — "gel" ile çakışmasın)
    if (lowerMsg.includes('/tp') || lowerMsg.includes('teleport') || lowerMsg.includes('buraya gel') ||
        lowerMsg.includes('yanıma gel') || lowerMsg.includes('come here') || lowerMsg.includes('come to me')) {
      bot.chat('Geliyorum!');
      bot.chat(`/tp ${master}`);
      return;
    }

    // 4. Envanteri tamamen at (ÖNCELİKLİ — 'at' ile çakışmasın diye)
    const isInventoryDrop =
      (lowerMsg.includes('envanteri') || lowerMsg.includes('envanter')) &&
      (lowerMsg.includes('at') || lowerMsg.includes('ver') || lowerMsg.includes('boşalt') ||
       lowerMsg.includes('dök') || lowerMsg.includes('toss') || lowerMsg.includes('drop'));

    const isHeldDrop =
      (lowerMsg.includes('elindeki') || lowerMsg.includes('eldeki') || lowerMsg.includes('tuttuğun') ||
       lowerMsg.includes('elindekini') || lowerMsg.includes('elimdeki') || lowerMsg.includes('elini')) &&
      (lowerMsg.includes('at') || lowerMsg.includes('ver') || lowerMsg.includes('bırak') ||
       lowerMsg.includes('toss') || lowerMsg.includes('drop'));

    if (isInventoryDrop) {
      await handleDropInventory();
      return;
    }

    if (isHeldDrop) {
      await handleDropHeldItem();
      return;
    }

    // 5. Dönme Komutu (360 derece) — 'at' den ÖNCE kontrol et
    if (lowerMsg.includes('360') || lowerMsg.includes('spin') || lowerMsg.includes('döndür') ||
        lowerMsg.includes('dön') || lowerMsg.includes('çevir')) {
      bot.chat('360 derece dönüyorum!');
      startSpinning360();
      return;
    }

    // 6. Kafa Sallama — tüm varyantlar (evet/hayır/nötr)
    const isHeadNod =
      lowerMsg.includes('kafanı salla') || lowerMsg.includes('kafa salla') ||
      lowerMsg.includes('başını salla') || lowerMsg.includes('baş salla') ||
      lowerMsg.includes('onayla') || lowerMsg.includes('evet de') ||
      lowerMsg.includes('nod');
    const isHeadShake =
      lowerMsg.includes('kafanı salla hayır') || lowerMsg.includes('hayır de') ||
      lowerMsg.includes('reddet') || lowerMsg.includes('shake') ||
      (isHeadNod && (lowerMsg.includes('hayır') || lowerMsg.includes('no') || lowerMsg.includes('olmaz')));

    if (isHeadNod || isHeadShake) {
      if (isHeadShake) {
        bot.chat('Hayır diyorum master...');
        await startShakingHead();
      } else {
        bot.chat('Evet diyorum master!');
        await startNodding();
      }
      return;
    }

    // 7. Zıplama Komutu
    if (lowerMsg.includes('zıpla') || lowerMsg.includes('zıplayıver') || lowerMsg.includes('jump') ||
        lowerMsg.includes('sıçra') || lowerMsg.includes('hop')) {
      bot.chat('Zıplıyorum!');
      stopRandomMovement();
      bot.setControlState('jump', true);
      setTimeout(() => {
        if (bot) {
          bot.setControlState('jump', false);
          startRandomMovement();
        }
      }, 500);
      return;
    }

    // 8. Eğilme/Çökme Komutu
    if (lowerMsg.includes('eğil') || lowerMsg.includes('çök') || lowerMsg.includes('sneak') ||
        lowerMsg.includes('çömel') || lowerMsg.includes('sindir') || lowerMsg.includes('gizlen')) {
      bot.chat('Eğiliyorum.');
      stopRandomMovement();
      bot.setControlState('sneak', true);
      setTimeout(() => {
        if (bot) {
          bot.setControlState('sneak', false);
          startRandomMovement();
        }
      }, 1500);
      return;
    }

    // 9. Eşya isteme komutu — 'at' son olarak burada (envanterden değil, /give ile)
    const isGiveCmd =
      lowerMsg.includes('ver') || lowerMsg.includes('give') || lowerMsg.includes('get') ||
      lowerMsg.includes('toss') || lowerMsg.includes('drop') ||
      // 'at' sadece fiziksel eylem içermeyen mesajlarda eşya atma sayılsın
      (lowerMsg.includes(' at ') || lowerMsg.endsWith(' at') || lowerMsg.startsWith('at '));

    if (isGiveCmd) {
      const { item, quantity } = parseItemRequest(message);
      bot.chat(`${quantity} adet ${item} hazırlıyorum...`);
      await handleGiveRequest(item, quantity);
      return;
    }

    // ─── SOHBET & DANS DİYALOGLARI ───────────────────────────────────────────────────
    const normalized = lowerMsg.replace(/[^a-z0-9çğıöşü]/g, '');

    // Dans etme
    if (normalized.includes('dans') || normalized.includes('oyna') || normalized.includes('sıkıldım') || normalized.includes('sikildim')) {
      bot.chat('Hemen senin için dans ediyorum, izle! :)');
      startDancing();
      return;
    }

    if (config.groqApiKey) {
      try {
        console.log(`[Lider Chat] Groq AI çağrılıyor...`);
        const reply = await askGroq(config.groqApiKey, config.groqModel, message, bot.username, master);
        console.log(`[Lider Chat] Groq AI yanıtı: "${reply}"`);
        await sendSplitMessage(bot, reply);
        return;
      } catch (err) {
        console.error(`[Lider Chat] Groq API hatası oluştu, yerel yanıtlara geçiliyor:`, err.message || err);
      }
    }

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
