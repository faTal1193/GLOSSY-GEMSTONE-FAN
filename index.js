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

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'test') {
    interaction.reply({
      content: 'Bot online e a funcionar!',
      ephemeral: true,
    });
  }
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) return;

  if (message.content === '!ping') {
    message.reply('Pong!');
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