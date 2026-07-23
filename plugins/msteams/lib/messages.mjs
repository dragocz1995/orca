// Service texts the bot itself speaks (not the model). English + Czech, picked by cfg.language.
// Teams renders markdown, so /help command names come out monospaced.
import { SHARED_MESSAGES } from '../../_shared/messages.mjs';
import { renderHelpLines } from '../../_shared/help.mjs';

const mono = (s) => `\`${s}\``;

export const MESSAGES = {
  en: {
    ...SHARED_MESSAGES.en,
    error: (detail) => `⚠️ ${detail}`,
    newConversation: '🆕 Fresh conversation started in this chat.',
    pickModel: '🧠 Pick the model for this chat:',
    modelSet: (m) => `✅ Model set to ${m}.`,
    pickContext: '💬 Continue this chat in one of your conversations:',
    contextBound: (title) => `🔗 This chat now continues “${title || 'your conversation'}”.`,
    pickThinking: '🧠 Pick the reasoning effort for this chat:',
    reasoningDefault: 'Default (model default)',
    thinkingSet: (l) => `✅ Reasoning effort set to ${l}.`,
    fastSet: (on) => on ? '⚡ Fast mode is on for this chat.' : '🐢 Fast mode is off for this chat.',
    fastUsage: 'Usage: /fast, /fast on, or /fast off.',
    pickDisplay: '🎛️ Configure what this chat shows while the agent works:',
    displaySet: (d) => `🎛️ Display: tools ${d.toolActivity} · layout ${d.toolMessageMode} · answer ${d.answerMode} · output ${d.toolOutput}.`,
    nothingRunning: '💤 Nothing is running in this chat.',
    noSession: '💤 No active conversation in this chat yet.',
    status: (model, pct, tokens) => `🧠 ${model}\n📊 Context ${pct}% · ${tokens} tokens`,
    askExpired: '⏱ This question expired.',
    askAnswered: (s) => `✅ Answered\n${s}`,
    askForSomeoneElse: 'This question is for someone else.',
    help: (name, commands) => [
      `**${name} on Microsoft Teams**`,
      'Write to me and I answer.',
      '',
      ...renderHelpLines({ lang: 'en', commands, mono, place: 'chat' }),
    ].join('\n\n'),
  },
  cs: {
    ...SHARED_MESSAGES.cs,
    error: (detail) => `⚠️ ${detail}`,
    newConversation: '🆕 V tomto chatu začíná nová konverzace.',
    pickModel: '🧠 Vyberte model pro tento chat:',
    modelSet: (m) => `✅ Model nastaven na ${m}.`,
    pickContext: '💬 Navažte v tomto chatu na jednu ze svých konverzací:',
    contextBound: (title) => `🔗 Tento chat nyní pokračuje v konverzaci „${title || 'vaší konverzaci'}“.`,
    pickThinking: '🧠 Vyberte úroveň uvažování pro tento chat:',
    reasoningDefault: 'Výchozí (nastavení modelu)',
    thinkingSet: (l) => `✅ Úroveň uvažování nastavena na ${l}.`,
    fastSet: (on) => on ? '⚡ Fast režim je v tomto chatu zapnutý.' : '🐢 Fast režim je v tomto chatu vypnutý.',
    fastUsage: 'Použití: /fast, /fast on nebo /fast off.',
    pickDisplay: '🎛️ Nastavte, co tento chat zobrazuje, zatímco agent pracuje:',
    displaySet: (d) => `🎛️ Zobrazení: nástroje ${d.toolActivity} · rozložení ${d.toolMessageMode} · odpověď ${d.answerMode} · výstup ${d.toolOutput}.`,
    nothingRunning: '💤 V tomto chatu nic neběží.',
    noSession: '💤 V tomto chatu zatím není žádná aktivní konverzace.',
    status: (model, pct, tokens) => `🧠 ${model}\n📊 Kontext ${pct}% · ${tokens} tokenů`,
    askExpired: '⏱ Tento dotaz vypršel.',
    askAnswered: (s) => `✅ Odpovězeno\n${s}`,
    askForSomeoneElse: 'Na tuhle otázku odpovídá někdo jiný.',
    help: (name, commands) => [
      `**${name} v Microsoft Teams**`,
      'Napište mi a odpovím.',
      '',
      ...renderHelpLines({ lang: 'cs', commands, mono, place: 'chat', placeLoc: 'chatu' }),
    ].join('\n\n'),
  },
};
