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
    description: 'Responde para verificar que o bot está online',
  },
];

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log('Comandos slash registados com sucesso.');
  } catch (error) {
    console.error('Erro a registar comandos slash:', error.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'test') {
    interaction.reply({
      content: 'Bot online e a funcionar!',
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
    throw new Error('Dados de eleição indisponíveis');
  }

  const mayor = data.mayor;
  const election = data.election;

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle(`Prefeito atual: ${mayor.name}`)
    .setDescription('**Perks do prefeito:**\n' + mayor.perks.slice(0, 3).map((p) => `• **${p.name}** - ${stripMc(p.description)}`).join('\n'))
    .addFields({
      name: 'Ministro',
      value: mayor.minister
        ? `**${mayor.minister.name}** - ${stripMc(mayor.minister.perk.description)}`
        : 'Sem ministro',
    });

  if (election && election.candidates) {
    embed.addFields({
      name: `Candidatos (ano ${election.year})`,
      value: election.candidates
        .slice()
        .sort((a, b) => b.votes - a.votes)
        .map((c) => `**${c.name}** - ${c.votes.toLocaleString()} votos`)
        .join('\n'),
    });
  }

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
      console.error('Erro no comando !election:', err.message);
      return message.reply('Não consegui obter os dados da eleição agora. Tenta de novo mais tarde.');
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