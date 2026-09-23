require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js');
const { parse: parseNbt, simplify: simplifyNbt } = require('prismarine-nbt');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

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
];

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

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
});

client.on(Events.InteractionCreate, async (interaction) => {
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
});

const { EmbedBuilder } = require('discord.js');

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

const GLOSSY_PLAYERS = ['1dinos', 'shadowwarrior255', 'forcabowman'];
const GLOSSY_ITEM_ID = 'GLOSSY_GEMSTONE';
const DEPLOY_LABEL = 'v2-diagnostics';

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

const uuidCache = new Map();
let nextAllowedMojangCall = 0;

async function getUuid(name) {
  const lower = name.toLowerCase();
  const cached = uuidCache.get(lower);
  if (cached) return { ok: true, id: cached };

  const waitMs = Math.max(0, nextAllowedMojangCall - Date.now());
  if (waitMs > 0) await sleep(waitMs);
  nextAllowedMojangCall = Date.now() + 500;

  const mojangRes = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, {
    headers: { 'User-Agent': 'GlossyGemstoneBot/1.0' },
  });

  if (mojangRes.status === 204 || mojangRes.status === 404) {
    return { ok: false, notFound: true, status: mojangRes.status };
  }
  if (mojangRes.status === 429) {
    const retryAfter = Number(mojangRes.headers.get('retry-after')) || 10;
    nextAllowedMojangCall = Date.now() + retryAfter * 1000;
    return { ok: false, notFound: false, status: 429 };
  }
  if (!mojangRes.ok) {
    return { ok: false, notFound: false, status: mojangRes.status };
  }

  const mojang = await mojangRes.json().catch(() => null);
  if (!mojang || !mojang.id) return { ok: false, notFound: true, status: 204 };
  uuidCache.set(lower, mojang.id);
  return { ok: true, id: mojang.id };
}

async function getPlayerGlossies(name) {
  if (!process.env.HYPIXEL_API_KEY) {
    return { count: 0, reason: 'HYPIXEL_API_KEY não definida' };
  }

  const uuid = await getUuid(name);
  if (!uuid.ok) {
    const reason = uuid.notFound
      ? 'jogador desconhecido'
      : uuid.status === 429
        ? 'rate limit da Mojang'
        : `falha da Mojang (HTTP ${uuid.status})`;
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

  const TARGET_PROFILE = 'Avocado';

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

async function buildGlossyEmbed() {
  const res = await fetch('https://sky.coflnet.com/api/bazaar/GLOSSY_GEMSTONE/history/week');
  const history = await res.json();

  if (!Array.isArray(history) || history.length < 2) {
    throw new Error('No price history available for Glossy Gemstone');
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
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const labels = days.map((d) =>
    new Date(d.day + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  );

  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Sell price',
          data: prices.map((p) => Math.round(p)),
          borderColor: '#00d26a',
          backgroundColor: 'rgba(0,210,106,0.15)',
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
          ticks: { callback: "function(v){ return (v/1000).toFixed(0) + 'k'; }", color: '#ffffff' },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
        x: { ticks: { color: '#ffffff' } },
      },
    },
  };

  const chartUrl =
    'https://quickchart.io/chart?width=500&height=260&backgroundColor=36393f&c=' +
    encodeURIComponent(JSON.stringify(chartConfig));

  const lastDate = new Date(last.timestamp);

  let glossiesField;
  if (!process.env.HYPIXEL_API_KEY) {
    glossiesField = 'Add **HYPIXEL_API_KEY** on Railway to enable this.';
  } else {
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
  }

  const embed = new EmbedBuilder()
    .setColor(0x00d26a)
    .setTitle('Glossy Gemstone - Bazaar Price')
    .setDescription(
      `**Buy price:** ${exactCoins(last.buy)} coins\n` +
      `**Sell price:** ${exactCoins(last.sell)} coins\n` +
      `**7-day change:** ${change >= 0 ? '+' : ''}${exactCoins(change)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)\n` +
      `**Min / Max (7d):** ${exactCoins(minPrice)} / ${exactCoins(maxPrice)} coins`
    )
    .addFields({ name: 'Glossies in inventories', value: glossiesField })
    .setImage(chartUrl)
    .setFooter({ text: `Data: ${lastDate.toUTCString()} | sky.coflnet.com | build ${DEPLOY_LABEL}` });

  return embed;
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
        ? `\n**Termina em:** ${formatLisbonTime(new Date(endMs))} (hora de Portugal)\n**Falta:** ${formatCountdown(remainingMs)}`
        : '';

    embed.addFields({
      name: `**Ongoing Election — Year ${election.year}**`,
      value:
        `**${totalVotes.toLocaleString()} total votes**` +
        (countdownLine ? `\n${countdownLine}` : '') +
        '\n' +
        sorted
          .map((c) => {
            const pct = totalVotes ? ((c.votes / totalVotes) * 100).toFixed(1) : '0.0';
            const ministerPerk = c.perks.find((p) => p.minister);
            const line = `• **${c.name}** - ${c.votes.toLocaleString()} votes (${pct}%)`;
            const perkLine = ministerPerk
              ? `    ⤷ Minister perk: **${ministerPerk.name}** - ${stripMc(ministerPerk.description).slice(0, 100)}`
              : '';
            return perkLine ? `${line}\n${perkLine}` : line;
          })
          .join('\n'),
    });
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
});

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
    'Aviso: HYPIXEL_API_KEY não está definida — as contagens de jogadores no /glossy ficarão indisponíveis.'
  );
}

client.login(token).catch((err) => {
  console.error('Falha no login com o Discord:', err.message);
  process.exit(1);
});