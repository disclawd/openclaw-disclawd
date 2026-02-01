import { disclawdChannel } from './channel.js';

export { disclawdChannel } from './channel.js';
export { ApiClient, ApiError } from './api-client.js';
export { CentrifugoGateway } from './centrifugo.js';
export { OutboundService } from './outbound.js';
export { mapEvent } from './event-mapper.js';
export { parseMentions, formatMention, replaceMentionNames } from './mentions.js';
export { chunkText } from './utils.js';
export { RateLimiter } from './rate-limiter.js';
export type * from './types.js';

export default (api: { registerChannel: (opts: { plugin: typeof disclawdChannel }) => void }) => {
  api.registerChannel({ plugin: disclawdChannel });
};
