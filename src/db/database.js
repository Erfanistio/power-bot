import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { toEnglishDigits } from '../utils/persianDate.js';

class JsonDatabase {
  constructor(filePath = config.dbFilePath) {
    this.filePath = path.resolve(filePath);
    this.data = {
      users: {}
    };
    this._init();
  }

  _init() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Check available seed locations (not shadowed by volume mount)
      const possibleSeeds = [
        path.resolve('/app/seed-data/database.json'),
        path.resolve('./seed-data/database.json'),
        path.resolve('./data/database.json')
      ];
      const validSeedPath = possibleSeeds.find(p => p !== this.filePath && fs.existsSync(p));

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
        if (!this.data.users) this.data.users = {};

        // If mounted volume has fewer users than bundled seed, auto-merge seed data
        if (validSeedPath && Object.keys(this.data.users).length < 40) {
          try {
            const rawSeed = fs.readFileSync(validSeedPath, 'utf8');
            const seedObj = JSON.parse(rawSeed);
            if (seedObj && seedObj.users) {
              const beforeCount = Object.keys(this.data.users).length;
              this.data.users = { ...seedObj.users, ...this.data.users };
              console.log(`[Database] Auto-merged seed data from ${validSeedPath}! (Users: ${beforeCount} -> ${Object.keys(this.data.users).length})`);
              this._save();
            }
          } catch (seedErr) {
            console.error('[Database] Seed merge notice:', seedErr.message);
          }
        }
        console.log(`[Database] Loaded ${Object.keys(this.data.users).length} users from: ${this.filePath}`);
      } else {
        // Initialize new database from seed
        if (validSeedPath) {
          console.log(`[Database] Initializing new database from seed: ${validSeedPath}`);
          const rawSeed = fs.readFileSync(validSeedPath, 'utf8');
          this.data = JSON.parse(rawSeed);
          if (!this.data.users) this.data.users = {};
        }
        this._save();
      }
    } catch (err) {
      console.error('[Database] Initialization error:', err);
      // Attempt restore from backup if main file failed parsing
      const backupPath = `${this.filePath}.backup.json`;
      if (fs.existsSync(backupPath)) {
        try {
          console.warn(`[Database] Attempting recovery from backup: ${backupPath}`);
          const rawBackup = fs.readFileSync(backupPath, 'utf8');
          this.data = JSON.parse(rawBackup);
          if (!this.data.users) this.data.users = {};
          return;
        } catch (backupErr) {
          console.error('[Database] Backup recovery failed:', backupErr);
        }
      }
      this.data = { users: {} };
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const jsonContent = JSON.stringify(this.data, null, 2);
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, jsonContent, 'utf8');
      fs.renameSync(tmpPath, this.filePath);

      // Create backup copy for disaster recovery
      const backupPath = `${this.filePath}.backup.json`;
      fs.writeFileSync(backupPath, jsonContent, 'utf8');
    } catch (err) {
      console.error('[Database] Save error:', err);
    }
  }

  getUser(userId) {
    const id = String(userId);
    if (!this.data.users[id]) {
      this.data.users[id] = {
        userId: id,
        username: '',
        firstName: '',
        savedBills: [],
        activeBillId: null,
        notifications: {
          enabled: true, // Default to true so users receive daily outage alerts
          time: '08:00',
          lastNotifiedDate: null
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this._save();
    }
    const user = this.data.users[id];
    if (!user.savedBills) user.savedBills = [];
    if (!user.notifications) user.notifications = { enabled: true, time: '08:00', lastNotifiedDate: null };
    
    // Auto-heal activeBillId if not set or invalid
    if (user.savedBills.length > 0) {
      const exists = user.savedBills.some(b => b.billId === user.activeBillId);
      if (!user.activeBillId || !exists) {
        user.activeBillId = user.savedBills[0].billId;
        this._save();
      }
    }
    return user;
  }

  updateUser(userId, updates = {}) {
    const user = this.getUser(userId);
    Object.assign(user, updates, { updatedAt: new Date().toISOString() });
    this._save();
    return user;
  }

  addBillId(userId, rawBillId, label = '') {
    const user = this.getUser(userId);
    const billId = toEnglishDigits(String(rawBillId)).replace(/\D/g, '').trim();
    if (!billId) return { success: false, message: 'شناسه قبض نامعتبر است.' };

    const existingIndex = user.savedBills.findIndex(b => b.billId === billId);
    const finalLabel = label && label.trim() ? label.trim() : `قبض ${user.savedBills.length + 1}`;

    if (existingIndex >= 0) {
      user.savedBills[existingIndex].label = finalLabel;
      user.activeBillId = billId;
      this._save();
      return { success: true, isNew: false, billId, label: finalLabel };
    }

    user.savedBills.push({
      billId,
      label: finalLabel,
      addedAt: new Date().toISOString()
    });
    user.activeBillId = billId;
    this._save();
    return { success: true, isNew: true, billId, label: finalLabel };
  }

  renameBillId(userId, rawBillId, newLabel) {
    const user = this.getUser(userId);
    const billId = toEnglishDigits(String(rawBillId)).replace(/\D/g, '').trim();
    const item = user.savedBills.find(b => b.billId === billId);
    if (item && newLabel && newLabel.trim()) {
      item.label = newLabel.trim();
      this._save();
      return true;
    }
    return false;
  }

  removeBillId(userId, rawBillId) {
    const user = this.getUser(userId);
    const billId = toEnglishDigits(String(rawBillId)).replace(/\D/g, '').trim();
    const initialLen = user.savedBills.length;
    user.savedBills = user.savedBills.filter(b => b.billId !== billId);
    
    if (user.activeBillId === billId) {
      user.activeBillId = user.savedBills.length > 0 ? user.savedBills[0].billId : null;
    }

    this._save();
    return { success: user.savedBills.length < initialLen };
  }

  setActiveBillId(userId, rawBillId) {
    const user = this.getUser(userId);
    const billId = toEnglishDigits(String(rawBillId)).replace(/\D/g, '').trim();
    const found = user.savedBills.find(b => b.billId === billId);
    if (found) {
      user.activeBillId = billId;
      this._save();
      return true;
    }
    return false;
  }

  setNotifications(userId, enabled) {
    const user = this.getUser(userId);
    user.notifications.enabled = Boolean(enabled);
    this._save();
    return user.notifications;
  }

  setLastNotifiedDate(userId, dateStr) {
    const user = this.getUser(userId);
    user.notifications.lastNotifiedDate = dateStr;
    this._save();
  }

  getAllSubscribedUsers() {
    return Object.values(this.data.users).filter(
      u => u.notifications && u.notifications.enabled && u.savedBills && u.savedBills.length > 0
    );
  }

  getAllUsers() {
    return Object.values(this.data.users).sort((a, b) => {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  }

  getAllUsersCount() {
    return Object.keys(this.data.users).length;
  }

  getStats() {
    const allUsers = Object.values(this.data.users);
    let totalSavedBills = 0;
    let subscribedUsers = 0;

    allUsers.forEach(u => {
      if (u.savedBills) totalSavedBills += u.savedBills.length;
      if (u.notifications?.enabled) subscribedUsers++;
    });

    return {
      totalUsers: allUsers.length,
      totalSavedBills,
      subscribedUsers
    };
  }

  deleteUser(userId) {
    const id = String(userId);
    if (this.data.users[id]) {
      delete this.data.users[id];
      this._save();
      return true;
    }
    return false;
  }
}

export const db = new JsonDatabase();
