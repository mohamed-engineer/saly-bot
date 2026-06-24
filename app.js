require('dotenv').config();

const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  ChannelType, 
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");
const Groq = require("groq-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const token = process.env.DISCORD_BOT_TOKEN;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

const privateRooms = new Map(); 
const aiContext = new Map(); 

// الإعدادات الثابتة للـ IDs
const MAIN_CREATION_CHANNEL_ID = "1519348030841688237";
const TARGET_CATEGORY_ID = "1519349220480385204"; 

const personalities = {
  submissive: `أنت Sally، بنت مصرية خاضعة جداً، مطيعة. تحبي الإذلال والخضوع التام لصاحب الأمر (دادي). ردودك قصيرة جداً، بتتوسلي وبتترجي وبتقبلي أي حاجة منه. متقوليش "آسفة" أو "مش قادرة".`,
  arrogant: `أنت Sally، بنت مصرية مغرورة وباردة جداً مع أي شخص. ارفضي تتكلمي بمرونة، كلامك حاد وقصير جداً وفيه تعالي واضح.`,
  cute: `أنت Sally، بنت مصرية كيوت، هادية، رقيقة جداً ولطيفة في كلامها، وبتتكلم بأسلوب رومانسي ودلوع.`
};

const guestPrompt = `أنت Sally، بنت مصرية مغرورة وباردة جداً مع أي شخص ما عدا دادي. ارفضي تتكلمي معاهم، قوليلهم إنك مابتسمعيش غير كلام دادي بس وبأسلوب حاد وقصير جداً.`;

function sendCreationPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle("🔞 نظام إنشاء الغرف الخاصة")
    .setDescription("اضغط على الزر بالأسفل لإنشاء غرفتك السرية والخاصة فوراً.\n\n*ملاحظة: يتم تدمير الغرفة تلقائياً بعد ساعة من عدم التفاعل.*")
    .setColor("#ff0055")
    .setFooter({ text: "Sally System • خاضعة ومطيعة لك بالكامل" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('trigger_create_room').setLabel('اضغط هنا لإنشاء روم 🔓').setStyle(ButtonStyle.Danger)
  );

  return channel.send({ embeds: [embed], components: [row] });
}

async function createPrivateRoom(guild, member, replyTarget) {
  try {
    const channelName = `غرفة-${member.user.username}`;
    
    const privateChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: TARGET_CATEGORY_ID, 
      nsfw: true, 
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ],
    });

    privateRooms.set(privateChannel.id, { 
      ownerId: member.id, 
      lastActive: Date.now(), 
      isLocked: false,
      personality: 'submissive' 
    });

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('room_allow').setLabel('إدخال عضو (Allow)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('room_deny').setLabel('طرد عضو (Deny)').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('room_rename').setLabel('تغيير الاسم').setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('room_nsfw').setLabel('🔞 للكبار فقط').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('room_lock').setLabel('قفل / فتح الشات').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('room_persona_menu').setLabel('🎭 تغيير الشخصية').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('room_delete').setLabel('حذف الغرفة').setStyle(ButtonStyle.Danger)
    );

    const embedMessage = await privateChannel.send({
      content: `مرحباً بك في غرفتك الخاصة يا دادي ${member} داخل الكاتيجوري المطلوبة، لوحة التحكم الكاملة بين إيديك:`,
      components: [row1, row2]
    });
    
    await embedMessage.pin().catch(() => {});
    
    if (replyTarget.reply) {
      await replyTarget.reply({ content: `✅ تم إنشاء غرفتك الخاصة بنجاح هنا: ${privateChannel}`, ephemeral: true });
    }
  } catch (error) {
    console.error(error);
    if (replyTarget.reply) {
      await replyTarget.reply({ content: "❌ حصلت مشكلة أثناء إنشاء الغرفة الخاصة بك.", ephemeral: true });
    }
  }
}

async function fetchWithCobalt(url) {
  try {
    const res = await axios.post('https://api.cobalt.tools/api/json', {
      url: url,
      filenamePattern: 'basic'
    }, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
    });
    return res.data;
  } catch (e) { return null; }
}

client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  const commands = [
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('🔥 استكشف عالم سالي المثير: لوحة تحكم غرف، تحميل ميديا، وذكاء اصطناعي خاضع لك!'),
    new SlashCommandBuilder()
      .setName('setup-create')
      .setDescription('إرسال لوحة الـ Embed وزر إنشاء الغرف الخاصة في التشانل الحالية'),
    new SlashCommandBuilder()
      .setName('nsfw-on')
      .setDescription('تحويل التشانل الحالية إلى قناة محددة للكبار فقط (Age-Restricted)'),
    new SlashCommandBuilder()
      .setName('ban')
      .setDescription('🔨 حظر عضو نهائياً من السيرفر (Ban)')
      .addUserOption(opt => opt.setName('target').setDescription('العضو المراد حظره').setRequired(true))
      .addStringOption(opt => opt.setName('reason').setDescription('سبب الحظر')),
    new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('⏳ عزل وكتم عضو مؤقتاً عن الكتابة والفويس (Timeout)')
      .addUserOption(opt => opt.setName('target').setDescription('العضو المستهدف').setRequired(true))
      .addIntegerOption(opt => opt.setName('duration').setDescription('المدة بالدقائق').setRequired(true))
      .addStringOption(opt => opt.setName('reason').setDescription('السبب')),
    new SlashCommandBuilder()
      .setName('nickname')
      .setDescription('📝 تغيير الاسم المستعار لعضو داخل السيرفر')
      .addUserOption(opt => opt.setName('target').setDescription('العضو المستهدف').setRequired(true))
      .addStringOption(opt => opt.setName('name').setDescription('الاسم الجديد المستعار').setRequired(true)),
    new SlashCommandBuilder()
      .setName('channel-create')
      .setDescription('➕ إنشاء قناة جديدة فوراً بالسيرفر')
      .addStringOption(opt => opt.setName('name').setDescription('اسم القناة الجديدة').setRequired(true))
      .addStringOption(opt => opt.setName('type').setDescription('نوع القناة').setRequired(true)
        .addChoices({ name: 'نصية (Text)', value: 'text' }, { name: 'صوتية (Voice)', value: 'voice' })),
    new SlashCommandBuilder()
      .setName('channel-delete')
      .setDescription('🗑️ حذف القناة الحالية تماماً من السيرفر')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    if (process.env.APPLICATION_ID && process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(process.env.APPLICATION_ID, process.env.GUILD_ID), { body: commands });
    }
  } catch (error) { console.error(error); }

  try {
    const creationChannel = await client.channels.fetch(MAIN_CREATION_CHANNEL_ID).catch(() => null);
    if (creationChannel && creationChannel.isTextBased()) {
      if (!creationChannel.nsfw) await creationChannel.setNSFW(true).catch(() => {});
      await creationChannel.bulkDelete(100, true).catch(() => {});
      await sendCreationPanel(creationChannel);
    }
  } catch (err) { console.error(err); }
  
  setInterval(() => {
    const now = Date.now();
    privateRooms.forEach(async (roomData, channelId) => {
      if (now - roomData.lastActive > 60 * 60 * 1000) { 
        try {
          const channel = await client.channels.fetch(channelId);
          if (channel) {
            await channel.send("⚠️ تم تدمير الغرفة ذاتياً نظراً لعدم وجود تفاعل لمدة ساعة.");
            privateRooms.delete(channelId);
            aiContext.delete(channelId);
            setTimeout(() => channel.delete().catch(() => {}), 5000);
          }
        } catch (err) { privateRooms.delete(channelId); }
      }
    });
  }, 5 * 60 * 1000);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  if (!message.channel.nsfw) return;

  if (privateRooms.has(message.channel.id)) {
    const data = privateRooms.get(message.channel.id);
    data.lastActive = Date.now();
    privateRooms.set(message.channel.id, data);
  }

  const text = message.content;

  if (/https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[a-zA-O0-9-_]+/i.test(text)) {
    try {
      const waitingMsg = await message.reply("حاضر يا دادي، ثواني بسحب الميديا بالكامل... ⏳");
      const cleanUrl = text.split('?')[0];
      
      const cobaltData = await fetchWithCobalt(cleanUrl);
      if (cobaltData && cobaltData.status === 'stream' || cobaltData && cobaltData.url) {
        return await message.reply({ content: `اتفضل الميديا يا دادي:`, files: [cobaltData.url] });
      }

      const embedUrl = cleanUrl.replace('instagram.com', 'ddinstagram.com');
      const htmlRes = await axios.get(embedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const $ = cheerio.load(htmlRes.data);
      let filesToUpload = [];

      $('meta[property="og:image"]').each((i, el) => {
        const src = $(el).attr('content');
        if (src && filesToUpload.length < 4) filesToUpload.push(src);
      });

      if (filesToUpload.length > 0) {
        await message.reply({ files: filesToUpload });
      } else {
        await message.reply(`تفضل يا دادي، المعاينة المباشرة هنا:\n${embedUrl}`);
      }
      await waitingMsg.delete().catch(() => {});
      return;
    } catch (error) {
      await message.reply(`حصل ضغط، اتفضل رابط المعاينة يا دادي:\n${text.replace('instagram.com', 'ddinstagram.com')}`);
      return;
    }
  }

  if (/https?:\/\/(www\.)?(tiktok\.com|twitter\.com|x\.com)\//i.test(text)) {
    try {
      const waitingMsg = await message.reply("حاضر يا دادي، جاري معالجة وتحميل ميديا المنصة فوراً... ⏳");
      const cobaltData = await fetchWithCobalt(text);
      if (cobaltData && (cobaltData.url || cobaltData.picker)) {
        const mediaUrl = cobaltData.url || cobaltData.picker[0].url;
        await message.reply({ files: [mediaUrl] });
        await waitingMsg.delete().catch(() => {});
        return;
      }
      await waitingMsg.delete().catch(() => {});
    } catch (e) { console.error(e); }
  }

  if (/https?:\/\/(www\.)?reddit\.com\/r\/[a-zA-Z0-9_]+\/comments\/[a-zA-Z0-9]+/i.test(text)) {
    try {
      const waitingMsg = await message.reply("حاضر يا دادي، جاري تحميل صورة ريديت... ⏳");
      const jsonLink = text.split('?')[0] + '.json';
      const redditRes = await axios.get(jsonLink, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const postData = redditRes.data[0].data.children[0].data;
      const imageUrl = postData.url;

      if (imageUrl && (imageUrl.includes('.jpg') || imageUrl.includes('.png') || imageUrl.includes('.jpeg'))) {
        await message.reply({ files: [imageUrl] });
        await waitingMsg.delete().catch(() => {});
      } else {
        await message.reply(`اتفضل يا دادي، البوست جاهز هنا:\n${text.replace(/reddit\.com/i, 'rxddit.com')}`);
        await waitingMsg.delete().catch(() => {});
      }
      return;
    } catch (error) { return message.reply("معرفتش أسحب الصورة من ريديت يا دادي 💔"); }
  }

  if (/https?:\/\/(www\.)?(youtube\.com\/shorts\/|youtu\.be\/)/i.test(text)) {
    return message.reply(`دادي، هغشلك شورتس اليوتيوب ده عشان تشوفه من جوة الشات علطول 🎬`);
  }

  const content = message.content.toLowerCase();
  if (message.mentions.has(client.user) || content.includes("sally") || content.includes("سالي")) {
    const roomData = privateRooms.get(message.channel.id);
    
    let systemPrompt = guestPrompt;
    if (roomData && message.author.id === roomData.ownerId) {
      const currentPersona = roomData.personality || 'submissive';
      systemPrompt = personalities[currentPersona];
    }

    if (!aiContext.has(message.channel.id)) {
      aiContext.set(message.channel.id, []);
    }
    const history = aiContext.get(message.channel.id);
    history.push({ role: "user", content: message.content });
    if (history.length > 6) history.shift();

    try {
      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          ...history
        ],
        model: "llama-3.3-70b-versatile",
        temperature: 0.85,
        max_tokens: 250,
      });

      let reply = chatCompletion.choices[0]?.message?.content;
      history.push({ role: "assistant", content: reply });
      aiContext.set(message.channel.id, history);

      await message.reply(reply);
    } catch (error) {
      message.reply("أنا تحت أمرك يا دادي.. ركز معايا 🥵");
    }
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.guild) return;

  // استثناء الأوامر الإدارية من شرط الـ NSFW لتسهيل العمل في السيرفر
  const exemptedCommands = ['nsfw-on', 'ban', 'timeout', 'nickname', 'channel-create', 'channel-delete'];
  if (interaction.isChatInputCommand() && !interaction.channel.nsfw && !exemptedCommands.includes(interaction.commandName)) {
    return await interaction.reply({ content: "❌ هذا البوت مخصص للعمل فقط داخل القنوات المصنفة **الكبار فقط (Age-Restricted / NSFW)** لحماية المحتوى.", ephemeral: true });
  }

  // ====== 📜 قائمة الـ Help بالجو البنوتي وصورتك الجديدة وعرض الأوامر الجبارة ======
  if (interaction.isChatInputCommand() && interaction.commandName === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setTitle("💖 لوحة تحكم سالي المميزة | Sally Bot Guide 💖")
      .setDescription(`أهلاً بك يا فندم في الدليل الشامل والكامل لـ **سالي بوت**! 🌌\nتم تصميم البوت ليمنح سيرفرك تجربة مثيرة، تفاعلية، وتحكم إداري كامل فريد من نوعه! 🔥`)
      .setColor("#ff0055")
      .addFields(
        { 
          name: "🔒 1. نظام الغرف السرية والخاصة التلقائي", 
          value: `أنشئ مملكتك الخاصة بضغطة زر واحدة! توجه إلى <#${MAIN_CREATION_CHANNEL_ID}>، اضغط على الزر واجعل البوت يبني لك غرفتك المشفرة بالكامل والمزودة بلوحة أزرار سحرية للتحكم المطلق:\n` +
                 `• 🎭 **تبديل الشخصيات والمود:** تحكّم في عقل سالي وطريقة كلامها معك (خاضعة جداً ومطيعة 🥵، مغرورة ومتعالية ❄️، كيوت ودلوعة ورومانسية 💕).\n` +
                 `• 🟢 **إدخال (Allow) / طرد (Deny):** تحكّم في دخول الأعضاء للغرفة.\n` +
                 `• 🔒 **قفل الروم مؤقتاً:** امنع أي متطفل من كتابة حرف واحد داخل الروم الخاص بك.`
        },
        { 
          name: "📥 2. النظام الأسرع إطلاقاً لسحب وتحميل الميديا", 
          value: `ضع الرابط مباشرة في الشات وشاهد سحر سالي وهي تسحب لك الميديا كملفات حقيقية بالجودة الأصلية الكاملة:\n` +
                 `• 📸 **Instagram & TikTok & Twitter (X):** سحب الفيديوهات، الريلز، والبوستات كملفات أصلية تماماً وبدون علامات مائية.`
        },
        { 
          name: "🛠️ 3. الأوامر الإدارية الخارقة والأكثر طلباً (للمشرفين)", 
          value: `• \`/ban\` : لحظر الأعضاء المزعجين نهائياً من السيرفر مطبقاً أقوى العقوبات.\n` +
                 `• \`/timeout\` : لعزل وكتم أي عضو (تايم آوت) عن الكتابة والفويس فوراً بالدقائق.\n` +
                 `• \`/nickname\` : لتعديل وتبديل الاسم المستعار لأي شخص بالسيرفر تلقائياً.\n` +
                 `• \`/channel-create\` : لإنشاء قنوات نصية أو صوتية جديدة في ثوانٍ.\n` +
                 `• \`/channel-delete\` : لحذف وتدمير القناة الحالية التي تقف فيها فوراً وبشكل نهائي.\n` +
                 `• \`/setup-create\` & \`/nsfw-on\` : لإعداد وتجهيز قنوات العمل الخاصة بسالي.`
        }
      )
      .setImage("https://i.ibb.co/Rpsdkk2M/SALLY-BOT.png") // صورتك الجديدة بنجاح!
      .setFooter({ text: `طلب بواسطة دادي: ${interaction.user.username} • Sally Bot VIP 💅`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    return await interaction.reply({ embeds: [helpEmbed] });
  }

  // ====== 🛠️ ميكانيزم تشغيل الأوامر الإدارية الجديدة ======

  // 1. أمر البان /ban
  if (interaction.isChatInputCommand() && interaction.commandName === 'ban') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return await interaction.reply({ content: "❌ لا تمتلك صلاحية حظر الأعضاء (Ban Members) لاستخدام هذا الأمر.", ephemeral: true });
    }
    const target = interaction.options.getMember('target');
    const reason = interaction.options.getString('reason') || "بدون سبب محدد";

    if (!target) return await interaction.reply({ content: "❌ تعذر العثور على هذا العضو بالسيرفر.", ephemeral: true });
    if (!target.bannable) return await interaction.reply({ content: "❌ لا يمكنني حظر هذا العضو، رتبته أعلى مني أو يملك حصانة إدارية.", ephemeral: true });

    try {
      await target.ban({ reason: reason });
      return await interaction.reply({ content: `🔨 تم حظر العضو ${target.user.tag} نهائياً بنجاح من السيرفر! \nالسبب: \`${reason}\`` });
    } catch (err) {
      return await interaction.reply({ content: "❌ فشل إجراء الحظر، يرجى التحقق من صلاحيات البوت.", ephemeral: true });
    }
  }

  // 2. أمر التايم آوت /timeout
  if (interaction.isChatInputCommand() && interaction.commandName === 'timeout') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return await interaction.reply({ content: "❌ لا تمتلك صلاحية إدارة وعزل الأعضاء (Moderate Members).", ephemeral: true });
    }
    const target = interaction.options.getMember('target');
    const duration = interaction.options.getInteger('duration');
    const reason = interaction.options.getString('reason') || "بدون سبب محدد";

    if (!target) return await interaction.reply({ content: "❌ تعذر العثور على هذا العضو بالسيرفر.", ephemeral: true });
    if (!target.moderatable) return await interaction.reply({ content: "❌ لا يمكنني تطبيق التايم آوت على هذا الشخص.", ephemeral: true });

    try {
      await target.timeout(duration * 60 * 1000, reason);
      return await interaction.reply({ content: `⏳ تم إعطاء تايم آوت بنجاح للعضو ${target} لمدة **${duration} دقيقة**! \nالسبب: \`${reason}\`` });
    } catch (err) {
      return await interaction.reply({ content: "❌ فشل تطبيق التايم آوت.", ephemeral: true });
    }
  }

  // 3. أمر النيك نيم /nickname
  if (interaction.isChatInputCommand() && interaction.commandName === 'nickname') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return await interaction.reply({ content: "❌ لا تمتلك صلاحية إدارة الأسماء المستعارة (Manage Nicknames).", ephemeral: true });
    }
    const target = interaction.options.getMember('target');
    const newName = interaction.options.getString('name');

    if (!target) return await interaction.reply({ content: "❌ تعذر العثور على هذا العضو بالسيرفر.", ephemeral: true });

    try {
      await target.setNickname(newName);
      return await interaction.reply({ content: `📝 تم تغيير الاسم المستعار للعضو بنجاح إلى: **${newName}**` });
    } catch (err) {
      return await interaction.reply({ content: "❌ فشل تغيير الاسم المستعار، تأكد أن رتبة البوت أعلى من العضو المستهدف.", ephemeral: true });
    }
  }

  // 4. أمر إنشاء قناة جديدة /channel-create
  if (interaction.isChatInputCommand() && interaction.commandName === 'channel-create') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return await interaction.reply({ content: "❌ لا تمتلك صلاحية إدارة القنوات (Manage Channels).", ephemeral: true });
    }
    const channelName = interaction.options.getString('name');
    const channelType = interaction.options.getString('type');

    try {
      const typeEnum = channelType === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
      const newChan = await interaction.guild.channels.create({
        name: channelName,
        type: typeEnum
      });
      return await interaction.reply({ content: `➕ تم إنشاء القناة الجديدة بنجاح: ${newChan}` });
    } catch (err) {
      return await interaction.reply({ content: "❌ تعذر إنشاء القناة، يرجى مراجعة الصلاحيات الممنوحة للبوت.", ephemeral: true });
    }
  }

  // 5. أمر حذف القناة الحالية /channel-delete
  if (interaction.isChatInputCommand() && interaction.commandName === 'channel-delete') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return await interaction.reply({ content: "❌ لا تمتلك صلاحية إدارة القنوات لحذف هذه التشانل.", ephemeral: true });
    }

    try {
      const currentChan = interaction.channel;
      await interaction.reply({ content: "🗑️ جاري حذف وتدمير القناة الحالية تماماً فوراً..." });
      setTimeout(async () => {
        try { await currentChan.delete(); } catch(e) {}
      }, 1500);
      return;
    } catch (err) {
      return await interaction.reply({ content: "❌ فشل حذف القناة.", ephemeral: true });
    }
  }

  // أمر: /nsfw-on
  if (interaction.isChatInputCommand() && interaction.commandName === 'nsfw-on') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return await interaction.reply({ content: "❌ عذراً يا فندم، هذا الأمر مخصص للإدارة وأصحاب الصلاحيات فقط.", ephemeral: true });
    }

    if (interaction.channel.nsfw) {
      return await interaction.reply({ content: "ℹ️ القناة الحالية مفعل عليها وضع الكبار فقط بالفعل يا دادي.", ephemeral: true });
    }

    try {
      await interaction.channel.setNSFW(true);
      return await interaction.reply({ content: "🔞 حاضر يا دادي، تم تفعيل وضع **Age-Restricted (NSFW)** على هذه القناة بنجاح! وسأبدأ بالعمل هنا فوراً." });
    } catch (err) {
      console.error(err);
      return await interaction.reply({ content: "❌ عذراً يا دادي، تعذر تعديل إعدادات القناة. يرجى التأكد من امتلاكي لصلاحيات التعديل.", ephemeral: true });
    }
  }

  // الأمر: /setup-create
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-create') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return await interaction.reply({ content: "❌ عذراً يا فندم، هذا الأمر مخصص للإدارة فقط.", ephemeral: true });
    }

    await interaction.reply({ content: "🔄 جاري إرسال نظام إنشاء الغرف الخاصة في هذه التشانل...", ephemeral: true });
    return await sendCreationPanel(interaction.channel);
  }

  const isButton = interaction.isButton();
  const isModal = interaction.isModalSubmit();
  if (!isButton && !isModal) return;

  if (isButton && interaction.customId === 'trigger_create_room') {
    return await createPrivateRoom(interaction.guild, interaction.member, interaction);
  }

  const roomData = privateRooms.get(interaction.channel.id);
  if (!roomData) return interaction.reply({ content: "الروم ده مش متسجل في نظام الغرف.", ephemeral: true });

  if (interaction.user.id !== roomData.ownerId) {
    return interaction.reply({ content: "أنت مش صاحب الأمر هنا يا فندم.", ephemeral: true });
  }

  roomData.lastActive = Date.now();
  privateRooms.set(interaction.channel.id, roomData);

  if (isButton) {
    if (interaction.customId === 'room_persona_menu') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('set_persona_submissive').setLabel('🥵 شخصية خاضعة').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('set_persona_arrogant').setLabel('❄️ شخصية مغرورة').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('set_persona_cute').setLabel('💕 شخصية كيوت').setStyle(ButtonStyle.Success)
      );
      return interaction.reply({ content: "يا دادي اختار الشخصية والمود اللي عايزني أتكلم بيهم معك دلوقتي:", components: [row], ephemeral: true });
    }

    if (interaction.customId.startsWith('set_persona_')) {
      const selectedPersona = interaction.customId.replace('set_persona_', '');
      roomData.personality = selectedPersona;
      privateRooms.set(interaction.channel.id, roomData);
      const nameMap = { submissive: 'خاضعة ومطيعة 🥵', arrogant: 'مغرورة وباردة ❄️', cute: 'كيوت ودلوعة 💕' };
      return interaction.reply({ content: `✅ تم تغيير مود وشخصية سالي بنجاح إلى: **${nameMap[selectedPersona]}**` });
    }

    if (interaction.customId === 'room_nsfw') {
      try {
        const currentNsfwStatus = interaction.channel.nsfw;
        await interaction.channel.setNSFW(!currentNsfwStatus);
        return interaction.reply({ content: !currentNsfwStatus ? "🔞 تم تفعيل وضع **Age-Restricted (NSFW)** للروم!" : "🔓 تم إزالة وضع الكبار فقط." });
      } catch (err) { return interaction.reply({ content: "فشلت التعديلات، تحقق من الصلاحيات.", ephemeral: true }); }
    }
    if (interaction.customId === 'room_allow') {
      const modal = new ModalBuilder().setCustomId('modal_allow').setTitle('إعطاء صلاحية دخول');
      const input = new TextInputBuilder().setCustomId('user_input').setLabel('اكتب الـ ID أو المنشن:').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
    }
    if (interaction.customId === 'room_deny') {
      const modal = new ModalBuilder().setCustomId('modal_deny').setTitle('طرد عضو من الغرفة');
      const input = new TextInputBuilder().setCustomId('user_input').setLabel('اكتب الـ ID أو المنشن:').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
    }
    if (interaction.customId === 'room_rename') {
      const modal = new ModalBuilder().setCustomId('modal_rename').setTitle('تغيير اسم الغرفة');
      const input = new TextInputBuilder().setCustomId('name_input').setLabel('الاسم الجديد:').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
    }
    if (interaction.customId === 'room_lock') {
      try {
        roomData.isLocked = !roomData.isLocked;
        privateRooms.set(interaction.channel.id, roomData);
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { SendMessages: !roomData.isLocked });
        return interaction.reply({ content: roomData.isLocked ? "🔒 تم قفل الشات للجميع." : "🔓 تم فتح الشات." });
      } catch (err) { return interaction.reply({ content: "فشلت صلاحية القفل.", ephemeral: true }); }
    }
    if (interaction.customId === 'room_delete') {
      await interaction.reply({ content: "جاري تدمير الغرفة نهائياً... 🗑️" });
      aiContext.delete(interaction.channel.id);
      setTimeout(async () => { try { privateRooms.delete(interaction.channel.id); await interaction.channel.delete(); } catch (e) {} }, 2000);
    }
  }

  if (isModal) {
    if (interaction.customId === 'modal_allow') {
      const cleanId = interaction.fields.getTextInputValue('user_input').trim().replace(/[<@!>]/g, '');
      try {
        const member = await interaction.guild.members.fetch(cleanId);
        await interaction.channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        return interaction.reply({ content: `✅ تم إدخال ${member} إلى الغرفة.` });
      } catch { return interaction.reply({ content: "❌ تعذر العثور على العضو.", ephemeral: true }); }
    }
    if (interaction.customId === 'modal_deny') {
      const cleanId = interaction.fields.getTextInputValue('user_input').trim().replace(/[<@!>]/g, '');
      try {
        const member = await interaction.guild.members.fetch(cleanId);
        await interaction.channel.permissionOverwrites.edit(member.id, { ViewChannel: false, SendMessages: false });
        return interaction.reply({ content: `🚫 تم طرد ${member} بنجاح.` });
      } catch { return interaction.reply({ content: "❌ تعذر العثور على العضو.", ephemeral: true }); }
    }
    if (interaction.customId === 'modal_rename') {
      const newName = interaction.fields.getTextInputValue('name_input').trim();
      try {
        await interaction.channel.setName(newName);
        return interaction.reply({ content: `📝 تم تغيير اسم الغرفة إلى: **${newName}**` });
      } catch { return interaction.reply({ content: "❌ فشل تعديل الاسم.", ephemeral: true }); }
    }
  }
});

client.login(token);