type SupportedLocale = 'zh-CN' | 'en';

const MESSAGES: Record<SupportedLocale, Record<string, string>> = {
  'zh-CN': {
    'gateway.rate_limit': '你的消息发送频率已达上限，请稍后再试。',
    'gateway.message_send': '当前没有发送消息的权限。',
    'command_filter.forbidden': '这个命令目前不在你的权限范围内。',
    'command_filter.unknown': '这个命令当前未注册，出于安全考虑已被拦截。',
    'tool.permission': '工具 "{tool}" 需要权限 "{permission}"。',
    'tool.path': '访问路径 "{path}" 需要权限 "{permission}"。',
  },
  en: {
    'gateway.rate_limit': 'Your message rate limit has been reached. Please try again later.',
    'gateway.message_send': 'You do not currently have permission to send messages.',
    'command_filter.forbidden': 'This command is currently outside your permission scope.',
    'command_filter.unknown': 'This command is not registered and was blocked for safety.',
    'tool.permission': 'Tool "{tool}" requires permission "{permission}".',
    'tool.path': 'Access to path "{path}" requires permission "{permission}".',
  },
};

function normalizeLocale(locale?: string): SupportedLocale {
  if (!locale) return 'zh-CN';
  return locale.toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
}

export function formatReason(
  code: string,
  params: Record<string, string> = {},
  locale?: string,
): string {
  const table = MESSAGES[normalizeLocale(locale)];
  const template = table[code] ?? MESSAGES['zh-CN'][code] ?? code;
  return template.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '');
}
