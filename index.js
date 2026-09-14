require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js');

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
});

const { EmbedBuilder } = require('discord.js');

const stripMc = (str) => str.replace(/§[0-9a-fk-or]/gi, '').replace(/\u0026/g, '');

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