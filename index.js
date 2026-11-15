require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, REST, Routes, ActivityType } = require('discord.js');
const { parse: parseNbt, simplify: simplifyNbt } = require('prismarine-nbt');
const { ProfileNetworthCalculator } = require('skyhelper-networth');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function setBotPresence() {
  client.user.setPresence({
    status: 'online',
    activities: [{ name: ' ', type: ActivityType.Streaming, url: 'https://twitch.tv/glossygemstone' }],
  });
}

const GLOSSY_PLAYERS = ['1dinos', 'shadowwarrior255', 'forcabowman', 'Blazecraft_edu', 'V1D_exe'];
const GLOSSY_PLAYER_CHOICES = GLOSSY_PLAYERS.map((name) => ({ name, value: name }));

const commands = [
  {
    name: 'test',
    description: 'Responds to check that the bot is online',
  },
  {
    name: 'election',
    description: 'Shows the current SkyBlock election (mayor, minister and candidates)',
  },
  {
    name: 'glossy',
    description: 'Shows Glossy Gemstone bazaar price with a 7-day chart',
  },
  {
    name: 'chalice',
    description: 'Shows Avaricious Chalice bazaar price with a 7-day chart',
  },
  {
    name: 'networth',
    description: 'Compare the networth of 1-5 players from the glossy list (SkyCofl prices)',
    options: GLOSSY_PLAYERS.slice(0, 5).map((_, index) => ({
      name: `player${index + 1}`,
      description: index === 0 ? 'Player 1 (required)' : `Player ${index + 1} (optional)`,
      type: 3,
      required: index === 0,
      choices: GLOSSY_PLAYER_CHOICES,
    })),
  },
  {
    name: 'alert',
    description: 'Price alerts for Glossy Gemstone / Avaricious Chalice',
    options: [
      {
        name: 'add',
        description: 'Create a price alert',
        type: 1,
        options: [
          {
            name: 'item',
            description: 'Item a seguir',
            type: 3,
            required: true,
            choices: [
              { name: 'Glossy Gemstone', value: 'GLOSSY_GEMSTONE' },
              { name: 'Avaricious Chalice', value: 'AVARICIOUS_CHALICE' },
            ],
          },
          { name: 'preco', description: 'Preço alvo em coins', type: 4, required: true },
          {
            name: 'direcao',
            description: 'Baixo: preço desce abaixo do alvo / Cima: preço sobe acima do alvo',
            type: 3,
            required: true,
            choices: [
              { name: 'Baixo', value: 'baixo' },
              { name: 'Cima', value: 'cima' },
            ],
          },
          {
            name: 'tipo',
            description: 'Tipo de preço a vigiar: sell ou buy (default: sell)',
            type: 3,
            required: false,
            choices: [
              { name: 'sell', value: 'sell' },
              { name: 'buy', value: 'buy' },
            ],
          },
          {
            name: 'channel',
            description: 'Canal para o alerta (default: canal atual)',
            type: 7,
            required: false,
            channel_types: [0, 5],
          },
        ],
      },
      { name: 'list', description: 'Show all price alerts', type: 1 },
      {
        name: 'remove',
        description: 'Remove a price alert',
        type: 1,
        options: [{ name: 'id', description: 'Alert id (see /alert list)', type: 3, required: true }],
      },
      {
        name: 'reset',
        description: 'Re-arm a disabled price alert',
        type: 1,
        options: [{ name: 'id', description: 'Alert id (see /alert list)', type: 3, required: true }],
      },
    ],
  },
];

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  setBotPresence();

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    const current = await rest.get(Routes.applicationCommands(c.user.id));
    const stale = current.filter((cmd) => !commands.some((wanted) => wanted.name === cmd.name));

    for (const cmd of stale) {
      await rest.delete(Routes.applicationCommand(c.user.id, cmd.id));
      console.log(`Removed stale command: /${cmd.name}`);
    }

    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log('Slash commands registered successfully.');
  } catch (error) {
    console.error('Error registering slash commands:', error.message);
  }

  loadAlerts();
  if (alerts.length) console.log(`Price alerts loaded: ${alerts.length}`);
  setInterval(() => {
    if (pollingInFlight) return;
    pollingInFlight = true;
    alertPollTick().finally(() => {
      pollingInFlight = false;
    });
  }, ALERT_POLL_MS);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('nw_')) {
      return handleNetworthViewButton(interaction);
    }
    return handleAlertButton(interaction);
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'test') {
    interaction.reply({
      content: 'Bot is online and working!',
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'election') {
    await interaction.deferReply();
    try {
      const embed = await buildElectionEmbed();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error in /election command:', err.message);
      await interaction.editReply('Could not fetch election data right now. Try again later.');
    }
  }

  if (interaction.commandName === 'glossy') {
    await interaction.deferReply();
    try {
      const embed = await buildGlossyEmbed();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error in /glossy command:', err.message);
      await interaction.editReply('Could not fetch Glossy Gemstone price right now. Try again later.');
    }
  }

  if (interaction.commandName === 'chalice') {
    await interaction.deferReply();
    try {
      const embed = await buildChaliceEmbed();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error in /chalice command:', err.message);
      await interaction.editReply('Could not fetch Avaricious Chalice price right now. Try again later.');
    }
  }

  if (interaction.commandName === 'networth') {
    return handleNetworthCommand(interaction);
  }

  if (interaction.commandName === 'alert') {
    await handleAlertCommand(interaction);
  }
});

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const stripMc = (str) => str.replace(/§[0-9a-fk-or]/gi, '').replace(/\u0026/g, '');

const exactCoins = (n) => Math.round(n).toLocaleString('en-US');

function timeAgo(ms) {
  if (!ms) return '';
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'agora mesmo';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

const SKYBLOCK_EPOCH_MS = 1560275700000;
const SKYBLOCK_DAY_MS = 20 * 60 * 1000;
const SKYBLOCK_YEAR_MS = 372 * SKYBLOCK_DAY_MS;
const ELECTION_END_OFFSET_DAYS = 88;

function skyblockElectionEndMs(year) {
  return SKYBLOCK_EPOCH_MS + year * SKYBLOCK_YEAR_MS + ELECTION_END_OFFSET_DAYS * SKYBLOCK_DAY_MS;
}

function formatCountdown(ms) {
  if (ms <= 0) return 'acabou';
  const totalMin = Math.ceil(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatLisbonTime(date) {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function addChunkedFields(embed, name, lines, maxChars = 1000) {
  let chunk = [];
  let chunkLen = 0;
  for (const line of lines) {
    const addLen = line.length + 1;
    if (chunk.length && chunkLen + addLen > maxChars) {
      embed.addFields({ name, value: chunk.join('\n') });
      chunk = [];
      chunkLen = 0;
    }
    chunk.push(line);
    chunkLen += addLen;
  }
  if (chunk.length) {
    embed.addFields({ name, value: chunk.join('\n') });
  }
}

const GLOSSY_ITEM_ID = 'GLOSSY_GEMSTONE';
const TARGET_PROFILE = process.env.GLOSSY_PROFILE || 'Papaya';
const COFLNET_HEADERS = {
  'User-Agent': 'GlossyGemstoneBot/1.0',
  Accept: 'application/json',
};
const DEPLOY_LABEL = 'v5-networth-ui';

function isGlossyItem(item) {
  if (!item) return false;
  if (item.id === GLOSSY_ITEM_ID || item.id === `SKYBLOCK:${GLOSSY_ITEM_ID}`) return true;
  const ea = item.tag && item.tag.ExtraAttributes;
  return !!(ea && ea.id === GLOSSY_ITEM_ID);
}

function countSimpleItems(items) {
  let total = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (isGlossyItem(item)) total += Number(item.Count) || 0;
  }
  return total;
}

async function countNbtBlob(data) {
  if (!data || typeof data !== 'string') return 0;
  try {
    const buffer = Buffer.from(data, 'base64');
    const { parsed } = await parseNbt(buffer);
    const simple = simplifyNbt(parsed);
    return countSimpleItems(simple && simple.i);
  } catch (err) {
    return 0;
  }
}

async function countInventory(value) {
  if (value == null) return 0;
  if (typeof value === 'string') return countNbtBlob(value);
  if (typeof value.data === 'string') return countNbtBlob(value.data);
  if (Array.isArray(value.i)) {
    return countSimpleItems(value.i);
  }
  if (Array.isArray(value)) {
    let total = 0;
    for (const entry of value) {
      total += await countInventory(entry);
    }
    return total;
  }
  if (typeof value === 'object') {
    let total = 0;
    for (const child of Object.values(value)) {
      total += await countInventory(child);
    }
    return total;
  }
  return 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJsonWithRetry(url, options, attempts = 3) {
  let lastStatus = 0;
  let lastError = 'resposta inválida';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      lastStatus = res.status;
      if (res.ok && json && !json.slug) return { ok: true, json };
      if (json && json.slug) lastError = json.message || json.slug;
      else lastError = `HTTP ${res.status}`;
      if (res.status === 404 || (res.status !== 429 && res.status < 500)) {
        return { ok: false, status: res.status, error: lastError };
      }
    } catch (err) {
      lastStatus = 0;
      lastError = err.message;
    }
    if (i < attempts - 1) await sleep(500 * (i + 1));
  }
  return { ok: false, status: lastStatus, error: lastError };
}

const uuidCache = new Map();
let nextAllowedMojangCall = 0;

const UUID_HEADERS = {
  'User-Agent': 'GlossyGemstoneBot/1.0',
  Accept: 'application/json',
};

function normalizeUuid(id) {
  return typeof id === 'string' ? id.replace(/-/g, '').toLowerCase() : '';
}

function uuidFailureReason(uuid) {
  if (uuid.notFound) return 'jogador desconhecido';
  if (uuid.status === 429) return 'rate limit ao obter UUID';
  if (uuid.status) return `falha ao obter UUID (HTTP ${uuid.status})`;
  return 'falha ao obter UUID';
}

async function getUuidFallback(name) {
  try {
    const res = await fetch(
      `https://sky.coflnet.com/api/search/player/${encodeURIComponent(name)}`,
      { headers: UUID_HEADERS }
    );
    if (res.ok) {
      const list = await res.json().catch(() => null);
      const match =
        Array.isArray(list) &&
        list.find(
          (p) => p && typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase()
        );
      if (match && match.uuid) return { ok: true, id: normalizeUuid(match.uuid) };
    }
  } catch (err) {
    console.error(`[${name}] SkyCofl search falhou: ${err.message}`);
  }

  try {
    const res = await fetch(
      `https://playerdb.co/api/player/minecraft/${encodeURIComponent(name)}`,
      { headers: UUID_HEADERS }
    );
    if (res.ok) {
      const json = await res.json().catch(() => null);
      const player = json && json.data && json.data.player;
      const rawId = player && (player.raw_id || player.id);
      if (rawId) return { ok: true, id: normalizeUuid(rawId) };
    }
  } catch (err) {
    console.error(`[${name}] PlayerDB falhou: ${err.message}`);
  }

  return { ok: false, notFound: false, status: 0 };
}

async function getUuid(name) {
  const lower = name.toLowerCase();
  const cached = uuidCache.get(lower);
  if (cached) return { ok: true, id: cached };

  let result = { ok: false, notFound: false, status: 0 };
  if (Date.now() >= nextAllowedMojangCall) {
    nextAllowedMojangCall = Date.now() + 500;
    try {
      const mojangRes = await fetch(
        `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
        { headers: UUID_HEADERS }
      );
      if (mojangRes.status === 204 || mojangRes.status === 404) {
        result = { ok: false, notFound: true, status: mojangRes.status };
      } else if (mojangRes.status === 429) {
        const retryAfter = Math.min(Number(mojangRes.headers.get('retry-after')) || 5, 10);
        nextAllowedMojangCall = Date.now() + retryAfter * 1000;
        result = { ok: false, notFound: false, status: 429 };
      } else if (!mojangRes.ok) {
        result = { ok: false, notFound: false, status: mojangRes.status };
      } else {
        const mojang = await mojangRes.json().catch(() => null);
        if (mojang && mojang.id) {
          result = { ok: true, id: normalizeUuid(mojang.id) };
        } else {
          result = { ok: false, notFound: true, status: mojangRes.status };
        }
      }
    } catch (err) {
      result = { ok: false, notFound: false, status: 0 };
    }
  } else {
    result = { ok: false, notFound: false, status: 429 };
  }

  if (!result.ok) {
    const fallback = await getUuidFallback(name);
    if (fallback.ok) result = fallback;
  }

  if (result.ok) uuidCache.set(lower, result.id);
  return result;
}

async function getPlayerGlossiesHypixel(name) {
  if (!process.env.HYPIXEL_API_KEY) {
    return { count: 0, reason: 'HYPIXEL_API_KEY não definida' };
  }

  const uuid = await getUuid(name);
  if (!uuid.ok) {
    const reason = uuidFailureReason(uuid);
    console.error(`[${name}] Não foi possível obter UUID: ${reason}`);
    return { count: 0, reason };
  }

  const res = await fetch(`https://api.hypixel.net/v2/skyblock/profiles?uuid=${uuid.id}`, {
    headers: { 'API-Key': process.env.HYPIXEL_API_KEY },
  });
  const rawBody = await res.text();
  const json = (() => {
    try {
      return JSON.parse(rawBody);
    } catch {
      return null;
    }
  })();
  const profilesCount = json && Array.isArray(json.profiles) ? json.profiles.length : 'n/a';
  const summary = `[${name}] Hypixel -> HTTP ${res.status}, success=${json && json.success}, profiles=${profilesCount}`;
  if (!json || !res.ok || json.success === false || profilesCount === 0) {
    console.error(`${summary} | body: ${rawBody.slice(0, 600)}`);
  } else {
    console.log(summary);
  }

  if (!json) return { count: 0, reason: `resposta inválida (HTTP ${res.status})` };

  const hypixelCause = (json.cause || json.reason || '').trim();

  if (!res.ok) {
    const tag = res.status === 403 ? 'chave inválida' : res.status === 429 ? 'rate limit da Hypixel' : `HTTP ${res.status}`;
    return { count: 0, reason: hypixelCause ? `${tag}: ${hypixelCause}` : tag };
  }

  if (json.success === false) {
    return { count: 0, reason: hypixelCause || 'API do jogador desligada' };
  }
  if (profilesCount === 0) {
    return { count: 0, reason: 'sem perfis SkyBlock (API desligada?)' };
  }

  const sorted = json.profiles
    .map((profile) => {
      const member = profile.members && profile.members[uuid.id] ? profile.members[uuid.id] : null;
      let firstJoin = member && member.first_join;
      if (!firstJoin && member && member.profile) firstJoin = member.profile.first_join;
      const isTarget = (profile.cute_name || '').toLowerCase() === TARGET_PROFILE.toLowerCase();
      return { profile, member, firstJoin: firstJoin || Number.MAX_SAFE_INTEGER, isTarget, selected: profile.selected };
    })
    .sort((a, b) => {
      if (a.isTarget !== b.isTarget) return a.isTarget ? -1 : 1;
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      return a.firstJoin - b.firstJoin;
    });

  const { profile, member } = sorted[0];
  if (!member) return { count: 0, reason: 'membro não encontrado no perfil' };

  let total = 0;

  const inv = member.inventory || {};
  const containers = [
    inv.inv_contents !== undefined ? inv.inv_contents : member.inv_contents,
    inv.inv_armor !== undefined ? inv.inv_armor : member.inv_armor,
    inv.ender_chest_contents !== undefined ? inv.ender_chest_contents : member.ender_chest_contents,
    inv.backpack_contents !== undefined ? inv.backpack_contents : member.backpack_contents,
    inv.wardrobe_contents !== undefined ? inv.wardrobe_contents : member.wardrobe_contents,
    inv.equipment_contents !== undefined ? inv.equipment_contents : member.equipment_contents,
    inv.bag_contents,
    member.storage,
    member.vault,
    profile.vault,
  ];

  for (const container of containers) {
    total += await countInventory(container);
  }

  const sacksCounts =
    (member.sacks_counts && member.sacks_counts[GLOSSY_ITEM_ID]) ||
    (inv.sacks_counts && inv.sacks_counts[GLOSSY_ITEM_ID]) ||
    0;
  total += Number(sacksCounts) || 0;

  return { count: total, profileName: profile.cute_name || 'Unknown', lastSave: member.last_save || null };
}

async function fetchCoflnetMember(name) {
  const uuid = await getUuid(name);
  if (!uuid.ok) {
    const reason = uuidFailureReason(uuid);
    console.error(`[${name}] Não foi possível obter UUID: ${reason}`);
    return { ok: false, reason };
  }

  const list = await fetchJsonWithRetry(`https://sky.coflnet.com/api/profile/${uuid.id}`, {
    headers: COFLNET_HEADERS,
  });
  if (!list.ok) {
    return { ok: false, reason: `SkyCofl: ${list.error || `HTTP ${list.status}`}` };
  }

  const profiles = list.json && list.json.profiles;
  if (!profiles || !Object.keys(profiles).length) {
    return { ok: false, reason: 'sem perfis SkyBlock (API desligada?)' };
  }

  const wanted = TARGET_PROFILE.toLowerCase();
  const entry =
    Object.entries(profiles).find(([cuteName]) => cuteName.toLowerCase() === wanted) ||
    Object.entries(profiles)[0];
  const [profileName, profileId] = entry;

  const res = await fetchJsonWithRetry(
    `https://sky.coflnet.com/api/profile/${uuid.id}/${profileId}`,
    { headers: COFLNET_HEADERS }
  );
  if (!res.ok) {
    return { ok: false, reason: `SkyCofl: ${res.error || `HTTP ${res.status}`}` };
  }

  const member = res.json;
  if (!member || !member.player_id) {
    return { ok: false, reason: 'perfil indisponível na SkyCofl' };
  }

  return { ok: true, uuid: uuid.id, profileName, profileId, member };
}

async function getPlayerGlossiesCoflnet(name) {
  const profile = await fetchCoflnetMember(name);
  if (!profile.ok) return { count: 0, reason: profile.reason };

  const inventory = profile.member.inventory;
  if (!inventory) return { count: 0, reason: 'inventário desligado na API' };

  let total = 0;
  for (const [key, value] of Object.entries(inventory)) {
    if (key === 'sacks_counts' || key === 'backpack_icons' || key === 'wardrobe_equipped_slot') {
      continue;
    }
    total += await countInventory(value);
  }
  total += Number(inventory.sacks_counts && inventory.sacks_counts[GLOSSY_ITEM_ID]) || 0;

  return { count: total, profileName: profile.profileName };
}

async function getPlayerGlossies(name) {
  const cozy = await getPlayerGlossiesCoflnet(name).catch((err) => {
    console.error(`[${name}] SkyCofl falhou: ${err.message}`);
    return { count: 0, reason: `SkyCofl: ${err.message}` };
  });
  if (!cozy.reason) return cozy;
  if (process.env.HYPIXEL_API_KEY) {
    console.warn(`[${name}] SkyCofl indisponível (${cozy.reason}); a tentar Hypixel.`);
    const hypixel = await getPlayerGlossiesHypixel(name);
    if (!hypixel.reason) return hypixel;
  }
  return cozy;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const NETWORTH_GROUP_ORDER = [
  { key: 'armor', label: 'Armor' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'wardrobe', label: 'Wardrobe' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'enderchest', label: 'Ender Chest' },
  { key: 'backpacks', label: 'Backpacks' },
  { key: 'accessories', label: 'Accessories' },
  { key: 'pets', label: 'Pets' },
  { key: 'quiver', label: 'Quiver' },
  { key: 'potionBag', label: 'Potion Bag' },
  { key: 'vault', label: 'Personal Vault' },
  { key: 'storage', label: 'Storage' },
  { key: 'museum', label: 'Museum' },
  { key: 'rift', label: 'Rift' },
  { key: 'essence', label: 'Essence' },
  { key: 'gemstones', label: 'Gemstones' },
  { key: 'sacks', label: 'Sacks' },
  { key: 'purse', label: 'Purse' },
];

const SKYHELPER_TYPE_GROUPS = {
  armor: 'armor',
  equipment: 'equipment',
  wardrobe: 'wardrobe',
  inventory: 'inventory',
  enderchest: 'enderchest',
  accessories: 'accessories',
  pets: 'pets',
  quiver: 'quiver',
  potion_bag: 'potionBag',
  personal_vault: 'vault',
  storage: 'storage',
  museum: 'museum',
  rift: 'rift',
  essence: 'essence',
  sacks: 'sacks',
  sacks_bag: 'sacks',
  fishing_bag: 'sacks',
};

function aggregateNetworth(types, purse) {
  const groups = {};
  for (const group of NETWORTH_GROUP_ORDER) groups[group.key] = 0;

  for (const [type, groupKey] of Object.entries(SKYHELPER_TYPE_GROUPS)) {
    const entry = types && types[type];
    if (entry) groups[groupKey] += Number(entry.total) || 0;
  }
  groups.purse = Number(purse) || 0;
  return groups;
}

function topHoldings(types, limit = 5) {
  const sackItems = types && types.sacks && Array.isArray(types.sacks.items) ? types.sacks.items : [];
  return sackItems
    .filter((item) => item && Number(item.price) > 0)
    .sort((a, b) => Number(b.price) - Number(a.price))
    .slice(0, limit)
    .map((item) => ({ key: item.id || item.name || 'unknown', value: Number(item.price) }));
}

function formatItemName(id) {
  return id
    .replace(/:/g, ' ')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function formatNetworth(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return String(Math.round(n));
}

async function fetchNetworthInput(name) {
  const profile = await fetchCoflnetMember(name);
  if (!profile.ok) return { ok: false, name, reason: profile.reason };
  return { ok: true, name, ...profile };
}

async function calculateNetworth(input) {
  const { name, profileName, member } = input;
  let networth;
  try {
    const calculator = new ProfileNetworthCalculator(member, undefined, 0);
    networth = await calculator.getNetworth();
  } catch (err) {
    return { ok: false, name, reason: `Networth: ${err.message}` };
  }

  const types = networth.types || {};
  return {
    ok: true,
    name,
    profileName,
    total: Number(networth.networth) || 0,
    groups: aggregateNetworth(types, networth.purse),
    holdings: topHoldings(types, 5),
  };
}

async function getNetworthComparison(names) {
  const inputs = await mapLimit(names, 3, (name) =>
    fetchNetworthInput(name).catch((err) => ({
      ok: false,
      name,
      reason: `SkyCofl: ${err.message}`,
    }))
  );

  return mapLimit(inputs, 3, (input) =>
    input.ok
      ? calculateNetworth(input).catch((err) => ({
          ok: false,
          name: input.name,
          reason: `SkyCofl: ${err.message}`,
        }))
      : input
  );
}

const NETWORTH_VIEWS = [
  { key: 'money', label: 'Money' },
  { key: 'categories', label: 'Categories' },
  { key: 'items', label: 'Top Sack Items' },
];
const NETWORTH_SESSION_TTL_MS = 30 * 60 * 1000;
const NETWORTH_MAX_SESSIONS = 200;
const networthSessions = new Map();
let networthSessionSeq = 0;

function pruneNetworthSessions() {
  const now = Date.now();
  for (const [id, session] of networthSessions) {
    if (now - session.createdAt > NETWORTH_SESSION_TTL_MS) {
      networthSessions.delete(id);
    }
  }
  while (networthSessions.size > NETWORTH_MAX_SESSIONS) {
    const oldest = networthSessions.keys().next().value;
    networthSessions.delete(oldest);
  }
}

function createNetworthSession(results) {
  pruneNetworthSessions();
  const id = `${Date.now().toString(36)}${(networthSessionSeq++).toString(36)}`;
  networthSessions.set(id, { results, createdAt: Date.now() });
  return id;
}

function buildNetworthViewRow(sessionId, activeView) {
  const row = new ActionRowBuilder();
  for (const view of NETWORTH_VIEWS) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`nw_${view.key}_${sessionId}`)
        .setLabel(view.label)
        .setStyle(view.key === activeView ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }
  return row;
}

function buildNetworthErrorEmbed(results) {
  const failed = results.filter((result) => !result.ok);
  return new EmbedBuilder()
    .setColor(0xff5555)
    .setTitle('SkyBlock Networth - Error')
    .setDescription(
      failed.map((result) => `• **${result.name}** — ${result.reason}`).join('\n') ||
        'Could not calculate networth right now.'
    )
    .setFooter({ text: `sky.coflnet.com | build ${DEPLOY_LABEL}` });
}

function buildNetworthMoneyEmbed(results) {
  const ok = results.filter((result) => result.ok).sort((a, b) => b.total - a.total);
  if (!ok.length) return buildNetworthErrorEmbed(results);
  const failed = results.filter((result) => !result.ok);

  const leader = ok[0].total;
  const ranking = ok
    .map((result, index) => {
      const diff = result.total - leader;
      const suffix = index === 0 ? '' : ` · ${formatNetworth(diff)} difference`;
      return (
        `#${index + 1} **${result.name}** — **${formatNetworth(result.total)}** coins\n` +
        `   ${exactCoins(result.total)} coins${suffix}`
      );
    })
    .join('\n');

  return new EmbedBuilder()
    .setColor(0xffaa00)
    .setTitle('SkyBlock Networth - Money')
    .setDescription(
      `**Profile:** ${ok[0].profileName}\n` +
        `**Source:** SkyHelper valuation (matches SkyCrypt)\n\n` +
        ranking +
        (failed.length
          ? `\n\n**Failed:**\n${failed
              .map((result) => `• **${result.name}** — ${result.reason}`)
              .join('\n')}`
          : '')
    )
    .setFooter({ text: `sky.coflnet.com | build ${DEPLOY_LABEL}` });
}

function networthFailedField(results) {
  const failed = results.filter((result) => !result.ok);
  if (!failed.length) return null;
  return {
    name: 'Failed',
    value: failed
      .map((result) => `• **${result.name}** — ${result.reason}`)
      .join('\n')
      .slice(0, 1024),
  };
}

function buildNetworthCategoriesEmbed(results) {
  const ok = results.filter((result) => result.ok).sort((a, b) => b.total - a.total);
  if (!ok.length) return buildNetworthErrorEmbed(results);

  const totalField = {
    name: 'Total',
    value: ok.map((result) => `**${result.name}:** ${formatNetworth(result.total)}`).join('\n'),
  };

  const categoryFields = NETWORTH_GROUP_ORDER.map((group) => {
    const anyValue = ok.some((result) => (result.groups[group.key] || 0) > 0);
    if (!anyValue && group.key !== 'purse') return null;
    return {
      name: group.label,
      value: ok
        .map((result) => `**${result.name}:** ${formatNetworth(result.groups[group.key] || 0)}`)
        .join('\n'),
    };
  }).filter(Boolean);

  const fields = [totalField, ...categoryFields];
  const failedField = networthFailedField(results);
  if (failedField) fields.push(failedField);

  return new EmbedBuilder()
    .setColor(0x00aaff)
    .setTitle('SkyBlock Networth - Categories')
    .setDescription('Values in coins. Purse is included; the shared co-op bank is excluded.')
    .addFields(fields)
    .setFooter({ text: `sky.coflnet.com | build ${DEPLOY_LABEL}` });
}

function buildNetworthItemsEmbed(results) {
  const ok = results.filter((result) => result.ok).sort((a, b) => b.total - a.total);
  if (!ok.length) return buildNetworthErrorEmbed(results);

  const holdingsFields = ok.map((result) => {
    const lines = (result.holdings || []).map(
      (item) => `• ${formatItemName(item.key)}: ${formatNetworth(item.value)}`
    );
    return {
      name: result.name,
      value: lines.length ? lines.join('\n') : 'No valuable sack items found.',
    };
  });

  const fields = [...holdingsFields];
  const failedField = networthFailedField(results);
  if (failedField) fields.push(failedField);

  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('SkyBlock Networth - Top Sack Items')
    .setDescription('Most valuable sack items per player.')
    .addFields(fields)
    .setFooter({ text: `sky.coflnet.com | build ${DEPLOY_LABEL}` });
}

function buildNetworthView(results, view) {
  if (view === 'categories') return buildNetworthCategoriesEmbed(results);
  if (view === 'items') return buildNetworthItemsEmbed(results);
  return buildNetworthMoneyEmbed(results);
}

async function handleNetworthCommand(interaction) {
  const selected = [];
  for (let index = 1; index <= 5; index += 1) {
    const name = interaction.options.getString(`player${index}`);
    if (name) selected.push(name);
  }

  const names = [...new Set(selected)];
  if (names.length !== selected.length) {
    return interaction.reply({
      content: 'Choose a different player in each option.',
      ephemeral: true,
    });
  }
  if (!names.length) {
    return interaction.reply({ content: 'Choose at least one player.', ephemeral: true });
  }

  await interaction.deferReply();
  try {
    const results = await getNetworthComparison(names);
    const sessionId = createNetworthSession(results);
    await interaction.editReply({
      embeds: [buildNetworthView(results, 'money')],
      components: [buildNetworthViewRow(sessionId, 'money')],
    });
  } catch (err) {
    console.error('Error in /networth command:', err.message);
    await interaction.editReply('Could not calculate networth right now. Try again later.');
  }
}

async function handleNetworthViewButton(interaction) {
  const parts = interaction.customId.split('_');
  if (parts.length !== 3) {
    return interaction.reply({ content: 'Unknown networth view.', ephemeral: true });
  }

  const [, view, sessionId] = parts;
  if (!NETWORTH_VIEWS.some((entry) => entry.key === view)) {
    return interaction.reply({ content: 'Unknown networth view.', ephemeral: true });
  }

  const session = networthSessions.get(sessionId);
  if (!session) {
    return interaction.reply({
      content: 'This comparison expired. Run /networth again.',
      ephemeral: true,
    });
  }

  try {
    await interaction.update({
      embeds: [buildNetworthView(session.results, view)],
      components: [buildNetworthViewRow(sessionId, view)],
    });
  } catch (err) {
    console.error('Error switching /networth view:', err.message);
  }
}

async function verifyHypixelKey() {
  try {
    const res = await fetch('https://api.hypixel.net/v2/key', {
      headers: { 'API-Key': process.env.HYPIXEL_API_KEY },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.success) {
      const owner = (body.record && body.record.owner) || '?';
      console.log(`Hypixel API key válida (owner: ${owner}).`);
    } else {
      console.error(`Hypixel API key INVÁLIDA — status ${res.status}: ${body.cause || JSON.stringify(body)}`);
    }
  } catch (err) {
    console.error('Não foi possível validar a Hypixel API key:', err.message);
  }
}

async function fetchBazaarData(itemId) {
  const res = await fetch(`https://sky.coflnet.com/api/bazaar/${itemId}/history/week`);
  const history = await res.json();

  if (!Array.isArray(history) || history.length < 2) {
    throw new Error(`No price history available for ${itemId}`);
  }

  const sorted = history.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const byDay = new Map();
  for (const point of sorted) {
    const day = point.timestamp.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(point.sell);
  }
  const days = [...byDay.entries()].map(([day, prices]) => ({
    day,
    price: prices.reduce((sum, p) => sum + p, 0) / prices.length,
  }));

  const last = sorted[sorted.length - 1];
  const first = sorted[0];
  const change = last.sell - first.sell;
  const changePct = first.sell ? (change / first.sell) * 100 : 0;
  const prices = days.map((d) => d.price);

  const labels = days.map((d) =>
    new Date(d.day + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  );

  const chartUrl = buildBazaarChart(itemId, labels, prices);

  return {
    last,
    first,
    change,
    changePct,
    prices,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    lastDate: new Date(last.timestamp),
    chartUrl,
  };
}

function buildBazaarChart(itemId, labels, prices, color = '#00d26a') {
  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Sell price',
          data: prices.map((p) => Math.round(p)),
          borderColor: color,
          backgroundColor: color + '26',
          pointRadius: 4,
          fill: true,
          tension: 0.2,
        },
      ],
    },
    options: {
      legend: { display: false },
      scales: {
        y: {
          ticks: {
            callback:
              "function(v){ if (v >= 1000000) { var m = v/1000000; return m.toFixed(m < 10 ? 1 : 0) + 'M'; } if (v >= 1000) { var k = v/1000; return k.toFixed(k < 10 ? 1 : 0) + 'k'; } return v; }",
            color: '#ffffff',
          },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
        x: { ticks: { color: '#ffffff' } },
      },
    },
  };

  return (
    'https://quickchart.io/chart?width=500&height=260&backgroundColor=36393f&c=' +
    encodeURIComponent(JSON.stringify(config))
  );
}

async function buildGlossyEmbed() {
  const data = await fetchBazaarData('GLOSSY_GEMSTONE');

  let glossiesField;
  const results = [];
  for (const player of GLOSSY_PLAYERS) {
    results.push(await getPlayerGlossies(player));
  }
  glossiesField = results
    .map((result, index) => {
      const name = GLOSSY_PLAYERS[index];
      if (result.reason) {
        return `• **${name}** — N/A (${result.reason})`;
      }
      const saved = result.lastSave ? ` · save ${timeAgo(result.lastSave)}` : '';
      return `• **${name}** — ||${String(result.count).padStart(5, '0')}|| (${result.profileName}${saved})`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x00d26a)
    .setTitle('Glossy Gemstone - Bazaar Price')
    .setDescription(
      `**Buy price:** ${exactCoins(data.last.buy)} coins\n` +
      `**Sell price:** ${exactCoins(data.last.sell)} coins\n` +
      `**7-day change:** ${data.change >= 0 ? '+' : ''}${exactCoins(data.change)} (${data.changePct >= 0 ? '+' : ''}${data.changePct.toFixed(1)}%)\n` +
      `**Min / Max (7d):** ${exactCoins(data.minPrice)} / ${exactCoins(data.maxPrice)} coins`
    )
    .addFields({ name: 'Glossies in inventories', value: glossiesField })
    .setImage(data.chartUrl)
    .setFooter({ text: `Data: ${data.lastDate.toUTCString()} | sky.coflnet.com | build ${DEPLOY_LABEL}` });

  return embed;
}

async function buildChaliceEmbed() {
  const data = await fetchBazaarData('AVARICIOUS_CHALICE');

  return new EmbedBuilder()
    .setColor(0xaa00aa)
    .setTitle('Avaricious Chalice - Bazaar Price')
    .setDescription(
      `**Buy price:** ${exactCoins(data.last.buy)} coins\n` +
      `**Sell price:** ${exactCoins(data.last.sell)} coins\n` +
      `**7-day change:** ${data.change >= 0 ? '+' : ''}${exactCoins(data.change)} (${data.changePct >= 0 ? '+' : ''}${data.changePct.toFixed(1)}%)\n` +
      `**Min / Max (7d):** ${exactCoins(data.minPrice)} / ${exactCoins(data.maxPrice)} coins`
    )
    .setImage(data.chartUrl)
    .setFooter({ text: `Data: ${data.lastDate.toUTCString()} | sky.coflnet.com | build ${DEPLOY_LABEL}` });
}

async function buildElectionEmbed() {
  const res = await fetch('https://api.hypixel.net/v2/resources/skyblock/election');
  const data = await res.json();

  if (!data.success || !data.mayor) {
    throw new Error('Election data unavailable');
  }

  const mayor = data.mayor;
  const election = data.current || data.election;
  const lastUpdated = new Date(data.lastUpdated);

  const totalVotes = election && election.candidates
    ? election.candidates.reduce((sum, c) => sum + c.votes, 0)
    : 0;

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`Current mayor: ${mayor.name}`)
    .setDescription(
      `**Mayor perks**\n` +
      mayor.perks.map((p) => {
        const ministerBadge = p.minister ? ' `(Minister)`' : '';
        return `• **${p.name}** - ${stripMc(p.description)}${ministerBadge}`;
      }).join('\n')
    );

  if (mayor.minister) {
    embed.addFields({
      name: '**Minister**',
      value: `• **${mayor.minister.name}** - ${stripMc(mayor.minister.perk.description)}`,
    });
  }

  embed.addFields({ name: '\u200b', value: '\u2501'.repeat(22) });

  if (election && election.candidates && election.candidates.length) {
    const sorted = election.candidates.slice().sort((a, b) => b.votes - a.votes);

    const endMs = skyblockElectionEndMs(election.year);
    const remainingMs = endMs - lastUpdated.getTime();
    const countdownLine =
      remainingMs > 0
        ? `\n**Termina em:** ${formatLisbonTime(new Date(endMs))} \n**Falta:** ${formatCountdown(remainingMs)}`
        : '';

    embed.addFields({
      name: `**Ongoing Election — Year ${election.year}**`,
      value:
        `**${totalVotes.toLocaleString()} total votes**` +
        (countdownLine ? `\n${countdownLine}` : ''),
    });

    const candidateLines = sorted.map((c) => {
      const pct = totalVotes ? ((c.votes / totalVotes) * 100).toFixed(1) : '0.0';
      const ministerPerk = c.perks.find((p) => p.minister);
      const line = `• **${c.name}** - ${c.votes.toLocaleString()} votes (${pct}%)`;
      if (!ministerPerk) return line;
      return `${line}\n    ⤷ Minister perk: **${ministerPerk.name}** - ${stripMc(ministerPerk.description)}`;
    });

    addChunkedFields(embed, '**Candidates**', candidateLines);
  } else {
    embed.addFields({
      name: '**Election**',
      value: 'There is no election running right now.',
    });
  }

  embed.setFooter({
    text: `Data updated: ${lastUpdated.toLocaleString()}`,
  });

  return embed;
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.content === '!ping') {
    return message.reply('Pong!');
  }

  if (message.content === '!election') {
    try {
      const embed = await buildElectionEmbed();
      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Error in !election command:', err.message);
      return message.reply('Could not fetch election data right now. Try again later.');
    }
  }

  if (message.content === '!glossy') {
    try {
      const embed = await buildGlossyEmbed();
      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Error in !glossy command:', err.message);
      return message.reply('Could not fetch Glossy Gemstone price right now. Try again later.');
    }
  }

  if (message.content === '!chalice') {
    try {
      const embed = await buildChaliceEmbed();
      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Error in !chalice command:', err.message);
      return message.reply('Could not fetch Avaricious Chalice price right now. Try again later.');
    }
  }
});

const ALERT_POLL_MS = 5 * 60 * 1000;
const ALERTS_PATH = process.env.ALERTS_FILE || path.join(__dirname, 'alerts.json');
const ALERT_ITEMS = {
  GLOSSY_GEMSTONE: 'Glossy Gemstone',
  AVARICIOUS_CHALICE: 'Avaricious Chalice',
};

let alerts = [];
let pollingInFlight = false;

function loadAlerts() {
  try {
    if (fs.existsSync(ALERTS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8'));
      alerts = Array.isArray(parsed) ? parsed : Array.isArray(parsed.alerts) ? parsed.alerts : [];
      for (const a of alerts) {
        if (a.direction === 'below') a.direction = 'baixo';
        else if (a.direction === 'above') a.direction = 'cima';
      }
    }
  } catch (err) {
    console.error('Could not load alerts.json:', err.message);
    alerts = [];
  }
  return alerts;
}

function saveAlerts() {
  try {
    fs.mkdirSync(path.dirname(ALERTS_PATH), { recursive: true });
    fs.writeFileSync(ALERTS_PATH, JSON.stringify({ alerts }, null, 2));
  } catch (err) {
    console.error('Could not save alerts.json:', err.message);
  }
}

const genAlertId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const alertStateLabel = (state) =>
  state === 'armed' ? 'armado' : state === 'fired' ? 'aguarda preço seguro' : 'desligado';

function alertItemColor(itemId) {
  return itemId === 'GLOSSY_GEMSTONE' ? 0x00d26a : 0xaa00aa;
}

async function fetchBazaarPrices() {
  if (!process.env.HYPIXEL_API_KEY) return null;
  const res = await fetch('https://api.hypixel.net/v2/skyblock/bazaar', {
    headers: { 'API-Key': process.env.HYPIXEL_API_KEY },
  });
  if (!res.ok) throw new Error(`bazaar HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success || !json.products) throw new Error('bazaar body inválido');
  return json.products;
}

async function sendAlertMessage(alert, priceNow, product = null) {
  const channel = client.channels.cache.get(alert.channelId);
  if (!channel || !channel.isTextBased()) {
    console.error(`Alert ${alert.id}: canal ${alert.channelId} não encontrado no cache`);
    return;
  }

  const itemName = ALERT_ITEMS[alert.itemId] || alert.itemId;
  const arrow = alert.direction === 'baixo' ? 'abaixo de' : 'acima de';
  const quantized =
    typeof product.lastUpdated === 'number' ? timeAgo(Date.now() - product.lastUpdated) : '';

  const embed = new EmbedBuilder()
    .setColor(alertItemColor(alert.itemId))
    .setTitle(`${itemName} cruzou o limiar`)
    .setDescription(
      `**Item:** ${itemName}\n` +
        `**Limiar:** ${alert.priceKind} ${arrow} **${exactCoins(alert.threshold)}** coins\n` +
        `**Preço atual (${alert.priceKind}):** **${exactCoins(priceNow)}** coins`
    )
    .setFooter({
      text: `Disparou a ${formatLisbonTime(new Date())}${quantized ? ` • dados de há ${quantized}` : ''}`,
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`alert_disable_${alert.id}`)
      .setLabel('Desativar alerta')
      .setStyle(ButtonStyle.Danger)
  );

  try {
    await channel.send({
      content: `<@${alert.createdBy}> — ${itemName} ${arrow} **${exactCoins(alert.threshold)}** coins (${alert.priceKind})!`,
      embeds: [embed],
      components: [row],
    });
  } catch (err) {
    console.error(`Alert ${alert.id}: falha ao enviar para ${alert.channelId}:`, err.message);
  }
}

async function alertPollTick() {
  const active = alerts.filter((a) => a.state === 'armed' || a.state === 'fired');
  if (!active.length) return;

  let products;
  try {
    products = await fetchBazaarPrices();
  } catch (err) {
    console.error('Alert poll: não foi possível buscar preços da bazaar:', err.message);
    return;
  }
  if (!products) return;

  for (const alert of active) {
    const product = products[alert.itemId];
    if (!product || !product.quick_status) continue;
    const priceNow =
      alert.priceKind === 'buy' ? product.quick_status.buyPrice : product.quick_status.sellPrice;
    if (typeof priceNow !== 'number' || !isFinite(priceNow)) continue;

    const crossed =
      alert.direction === 'baixo' ? priceNow < alert.threshold : priceNow > alert.threshold;

    if (alert.state === 'fired') {
      const rearmsafe =
        alert.direction === 'baixo'
          ? priceNow >= alert.threshold * 1.05
          : priceNow <= alert.threshold * 0.95;
      if (rearmsafe) {
        alert.state = 'armed';
        saveAlerts();
        console.log(
          `[alert] ${alert.id} rearmado: ${alert.itemId} ${alert.priceKind} ${Math.round(priceNow)} (limiar ${alert.threshold})`
        );
      }
      continue;
    }

    if (crossed) {
      alert.state = 'fired';
      saveAlerts();
      console.log(
        `[alert] ${alert.id} disparou: ${alert.itemId} ${alert.priceKind} ${Math.round(priceNow)} ${alert.direction} limiar ${alert.threshold}`
      );
      await sendAlertMessage(alert, priceNow, product);
    }
  }
}

async function handleAlertCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    if (!process.env.HYPIXEL_API_KEY) {
      return interaction.reply({
        content: '**HYPIXEL_API_KEY** não está configurada — os alertas não podem funcionar.',
        ephemeral: true,
      });
    }

    const itemId = interaction.options.getString('item', true);
    const threshold = interaction.options.getInteger('preco', true);
    const direction = interaction.options.getString('direcao', true);
    const priceKind = interaction.options.getString('tipo') || 'sell';
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    if (threshold <= 0) {
      return interaction.reply({ content: 'O threshold tem de ser maior que 0.', ephemeral: true });
    }
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: 'O canal escolhido não é válido para mensagens.',
        ephemeral: true,
      });
    }
    const canSend = (() => {
      try {
        const perms = channel.permissionsFor(client.user.id);
        return !perms || perms.has(['ViewChannel', 'SendMessages']);
      } catch {
        return true;
      }
    })();
    if (!canSend) {
      return interaction.reply({
        content: `Não tenho permissões para enviar mensagens em <#${channel.id}>.`,
        ephemeral: true,
      });
    }

    const alert = {
      id: genAlertId(),
      itemId,
      threshold,
      direction,
      priceKind,
      channelId: channel.id,
      createdBy: interaction.user.id,
      createdAt: Date.now(),
      state: 'armed',
    };
    alerts.push(alert);
    saveAlerts();

    const arrow = direction === 'baixo' ? 'abaixo de' : 'acima de';
    return interaction.reply({
      content:
        `Alerta criado — id \`${alert.id}\`\n` +
        `• ${ALERT_ITEMS[itemId]} ${arrow} **${exactCoins(threshold)}** coins (${priceKind})\n` +
        `• Canal: <#${channel.id}>\n` +
        `• O bot verifica a cada 5 min e dispara a cada passagem até desligares o alerta.`,
      ephemeral: true,
    });
  }

  if (sub === 'list') {
    if (!alerts.length) {
      return interaction.reply({
        content: 'Sem alertas. Usa `/alert add` para criar um.',
        ephemeral: true,
      });
    }
    const embed = new EmbedBuilder()
      .setColor(0x00d26a)
      .setTitle('Alertas de preço')
      .setDescription(`${alerts.length} alertas ativos`);
    const lines = alerts.map((a) => {
      const arrow = a.direction === 'baixo' ? 'abaixo de' : 'acima de';
      return `\`${a.id}\` • **${ALERT_ITEMS[a.itemId] || a.itemId}** ${arrow} ${exactCoins(a.threshold)} (${a.priceKind}) — <#${a.channelId}> — ${alertStateLabel(a.state)}`;
    });
    addChunkedFields(embed, 'Alerta', lines, 900);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'remove') {
    const id = interaction.options.getString('id', true);
    const idx = alerts.findIndex((a) => a.id === id);
    if (idx === -1) {
      return interaction.reply({ content: `Alerta \`${id}\` não encontrado.`, ephemeral: true });
    }
    const [removed] = alerts.splice(idx, 1);
    saveAlerts();
    return interaction.reply({
      content: `Alerta \`${id}\` removido (${ALERT_ITEMS[removed.itemId] || removed.itemId}).`,
      ephemeral: true,
    });
  }

  if (sub === 'reset') {
    const id = interaction.options.getString('id', true);
    const alert = alerts.find((a) => a.id === id);
    if (!alert) {
      return interaction.reply({ content: `Alerta \`${id}\` não encontrado.`, ephemeral: true });
    }
    alert.state = 'armed';
    saveAlerts();
    return interaction.reply({ content: `Alerta \`${id}\` rearmado.`, ephemeral: true });
  }
}

async function handleAlertButton(interaction) {
  const prefix = 'alert_disable_';
  if (!interaction.customId.startsWith(prefix)) return;
  const id = interaction.customId.slice(prefix.length);
  const alert = alerts.find((a) => a.id === id);
  if (!alert) {
    return interaction.reply({ content: 'Alerta não encontrado.', ephemeral: true });
  }
  alert.state = 'disabled';
  saveAlerts();
  try {
    await interaction.update({ components: [] });
  } catch (err) {
    console.error(`Alert ${id}: falha ao atualizar a mensagem do botão:`, err.message);
  }
  return interaction.followUp({
    content: `Alerta \`${id}\` desativado. Usa \`/alert reset ${id}\` para reativar.`,
    ephemeral: true,
  });
}

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('FALHA: variável DISCORD_TOKEN está vazia ou não definida no Railway.');
  console.error('Configura em Railway > Serviço > Variables > DISCORD_TOKEN = <token do bot>.');
  process.exit(1);
} else {
  console.log(
    `DISCORD_TOKEN encontrada (início: ${token.slice(0, 4)}..., tamanho: ${token.length})`
  );
}

if (process.env.HYPIXEL_API_KEY) {
  verifyHypixelKey();
} else {
  console.warn(
    'Aviso: HYPIXEL_API_KEY não está definida — os alertas de preço no /alert ficarão indisponíveis.'
  );
}

client.login(token).catch((err) => {
  console.error('Falha no login com o Discord:', err.message);
  process.exit(1);
});
