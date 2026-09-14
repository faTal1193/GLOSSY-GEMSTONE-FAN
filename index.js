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

const GLOSSY_PLAYERS = ['1dinos', 'shadowwarrior255', 'forcabowman'];
const GLOSSY_ITEM_ID = 'GLOSSY_GEMSTONE';

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

async function getPlayerGlossies(name) {
  if (!process.env.HYPIXEL_API_KEY) return null;

  const mojangRes = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, {
    headers: { 'User-Agent': 'GlossyGemstoneBot/1.0' },
  });
  if (!mojangRes.ok) return null;
  const mojang = await mojangRes.json();
  const uuid = mojang && mojang.id;
  if (!uuid) return null;

  const res = await fetch(`https://api.hypixel.net/v2/skyblock/profiles?uuid=${uuid}`, {
    headers: { 'API-Key': process.env.HYPIXEL_API_KEY },
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.success || !Array.isArray(json.profiles) || json.profiles.length === 0) return null;

  const TARGET_PROFILE = 'Avocado';

  const sorted = json.profiles
    .map((profile) => {
      const member = profile.members && profile.members[uuid] ? profile.members[uuid] : null;
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
  if (!member) return null;

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
    const results = await Promise.allSettled(GLOSSY_PLAYERS.map((player) => getPlayerGlossies(player)));
    glossiesField = results
      .map((result, index) => {
        const name = GLOSSY_PLAYERS[index];
        if (result.status === 'fulfilled' && result.value !== null) {
          const saved = result.value.lastSave ? ` · save ${timeAgo(result.value.lastSave)}` : '';
          return `• **${name}** — ||${result.value.count}|| (${result.value.profileName}${saved})`;
        }
        return `• **${name}** — N/A (API desligada)`;
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
    .setFooter({ text: `Data: ${lastDate.toUTCString()} | sky.coflnet.com` });

  return embed;
}

async function buildElectionEmbed() {
  const res = await fetch('https://api.hypixel.net/v2/resources/skyblock/election');
  const data = await res.json();

  if (!data.success || !data.mayor) {
    throw new Error('Election data unavailable');
  }

  const mayor = data.mayor;
  const election = data.election;
  const lastUpdated = new Date(data.lastUpdated);

  const totalVotes = election && election.candidates
    ? election.candidates.reduce((sum, c) => sum + c.votes, 0)
    : 0;

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`Current mayor: ${mayor.name}`)
    .setDescription(
      `**Mayor perks:**\n` +
      mayor.perks.map((p) => {
        const ministerBadge = p.minister ? ' `<-- Minister`' : '';
        return `• **${p.name}** - ${stripMc(p.description)}${ministerBadge}`;
      }).join('\n')
    );

  if (mayor.minister) {
    embed.addFields({
      name: 'Minister',
      value: `**${mayor.minister.name}** - ${stripMc(mayor.minister.perk.description)}`,
    });
  }

  if (election && election.candidates && election.candidates.length) {
    const sorted = election.candidates.slice().sort((a, b) => b.votes - a.votes);
    embed.addFields({
      name: `Candidates (year ${election.year}) - ${totalVotes.toLocaleString()} total votes`,
      value: sorted
        .map((c) => {
          const pct = totalVotes ? ((c.votes / totalVotes) * 100).toFixed(1) : '0.0';
          const ministerPerk = c.perks.find((p) => p.minister);
          const line = `**${c.name}** - ${c.votes.toLocaleString()} votes (${pct}%)`;
          const perkLine = ministerPerk
            ? `  ⤷ Minister perk: **${ministerPerk.name}** - ${stripMc(ministerPerk.description).slice(0, 100)}`
            : '';
          return perkLine ? `${line}\n${perkLine}` : line;
        })
        .join('\n'),
    });
  } else if (!election || !election.candidates) {
    embed.addFields({
      name: 'Election',
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

client.login(token).catch((err) => {
  console.error('Falha no login com o Discord:', err.message);
  process.exit(1);
});