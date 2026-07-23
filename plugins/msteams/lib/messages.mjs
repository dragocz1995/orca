// Service texts the bot itself speaks (not the model). English + Czech, picked by cfg.language.
export const MESSAGES = {
  en: {
    error: (detail) => `⚠️ ${detail}`,
    notConfigured: 'The Teams bot is not fully configured (app ID, client secret and tenant ID are required).',
  },
  cs: {
    error: (detail) => `⚠️ ${detail}`,
    notConfigured: 'Bot pro Teams není plně nakonfigurován (je vyžadováno App ID, klientský tajný klíč a ID tenantu).',
  },
};
