const { createManagedBot } = require('./bot');

class BotCoordinator {
  constructor(config) {
    this.config = config;
    this.leaderBot = null;
    this.swarmBots = new Map(); // username -> mineflayer bot instance
    this.realPlayersCount = 0;
    this.shouldSwarmBeOnline = false;
    this.spawnTimeouts = []; // Array of active setTimeout IDs
  }

  setLeader(botInstance) {
    this.leaderBot = botInstance;
    console.log(`[Coordinator] Lider bot koordinatöre kaydedildi.`);
  }

  registerSwarm(username, botInstance) {
    this.swarmBots.set(username, botInstance);
    console.log(`[Coordinator] Swarm bot koordinatöre kaydedildi: ${username} (Toplam Aktif Swarm: ${this.swarmBots.size})`);
  }

  unregisterSwarm(username) {
    if (this.swarmBots.has(username)) {
      this.swarmBots.delete(username);
      console.log(`[Coordinator] Swarm bot koordinatörden çıkarıldı: ${username} (Kalan Aktif Swarm: ${this.swarmBots.size})`);
    }
  }

  updateRealPlayerCount(count) {
    this.realPlayersCount = count;
    console.log(`[Coordinator] Güncel gerçek oyuncu sayısı: ${count}`);

    if (count > 0) {
      // Gerçek oyuncu var -> Swarm botları kapat, yenilerini başlatmayı iptal et
      if (this.shouldSwarmBeOnline || this.swarmBots.size > 0 || this.spawnTimeouts.length > 0) {
        console.log(`[Coordinator] Gerçek oyuncu tespit edildi! Swarm botları durduruluyor.`);
        this.shouldSwarmBeOnline = false;
        this.stopSwarmBots();
      }
    } else {
      // Gerçek oyuncu yok -> Swarm botları başlat
      if (!this.shouldSwarmBeOnline) {
        console.log(`[Coordinator] Sunucu boş. Swarm botları başlatılıyor.`);
        this.shouldSwarmBeOnline = true;
        this.startSwarmBots();
      }
    }
  }

  startSwarmBots() {
    // Önceki zamanlayıcıları temizle
    this.clearSpawnTimeouts();

    console.log(`[Coordinator] Swarm botları sırayla sunucuya sokuluyor...`);
    let delay = 2000; // İlk bot 2 saniye sonra girsin

    for (let i = 2; i <= this.config.botCount; i++) {
      const timeoutId = setTimeout(() => {
        // Son saniye kontrolü: hala swarm'ın aktif olması gerekiyor mu?
        if (!this.shouldSwarmBeOnline) {
          console.log(`[Coordinator] Swarm bot başlatma iptal edildi, sunucuda oyuncu var.`);
          return;
        }

        // Zaten o sayıya ulaştıysak veya bu bot zaten varsa es geç
        if (this.swarmBots.size >= this.config.botCount - 1) {
          return;
        }

        const username = `${this.config.botNamePrefix}${i}_${Math.floor(1000 + Math.random() * 9000)}`;
        try {
          createManagedBot(this.config, username, false, this);
        } catch (err) {
          console.error(`[Coordinator] Bot başlatılırken hata oluştu (${username}):`, err);
        }
      }, delay);

      this.spawnTimeouts.push(timeoutId);
      delay += 15000; // Botlar arası 15 saniye bekleme süresi
    }
  }

  stopSwarmBots() {
    this.clearSpawnTimeouts();

    for (const [username, botInstance] of this.swarmBots.entries()) {
      console.log(`[Coordinator] Swarm bot bağlantısı kesiliyor: ${username}`);
      try {
        // bot.quit() çağırmak end event'ini tetikler.
        // end event'i tetiklendiğinde coordinator.shouldSwarmBeOnline false olduğu için reconnect yapılmayacak.
        botInstance.quit();
      } catch (err) {
        console.error(`[Coordinator] Bot kapatılırken hata oluştu (${username}):`, err.message || err);
      }
    }
    this.swarmBots.clear();
  }

  clearSpawnTimeouts() {
    if (this.spawnTimeouts.length > 0) {
      console.log(`[Coordinator] Bekleyen swarm başlatma zamanlayıcıları temizleniyor (${this.spawnTimeouts.length} adet).`);
      this.spawnTimeouts.forEach(clearTimeout);
      this.spawnTimeouts = [];
    }
  }
}

module.exports = BotCoordinator;
