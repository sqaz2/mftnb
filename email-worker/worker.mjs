import { EmailMessage } from 'cloudflare:email';
import { handleReply } from './auto-reply.mjs';

export default {
  async email(message) {
    await handleReply(message, EmailMessage);
  }
};
