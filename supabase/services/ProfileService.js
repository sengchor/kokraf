import { auth } from './AuthService.js';

class ProfileService {
  constructor() {
    this.profile = null;
  }

  async loadProfile() {
    const user = auth.user;
    if (!user) return null;

    const metadata = user.user_metadata || {};

    this.profile = {
      id: user.id,
      email: user.email,

      displayName:
        metadata.full_name ||
        metadata.name ||
        this.extractNameFromEmail(user.email),

      avatarUrl:
        metadata.avatar_url ||
        metadata.picture ||
        null
    };

    return this.profile;
  }

  getProfile() {
    return this.profile;
  }

  getDisplayName() {
    return this.profile?.displayName || 'User';
  }

  getAvatarUrl() {
    return this.profile?.avatarUrl;
  }

  extractNameFromEmail(email) {
    if (!email) return 'User';
    return email.split('@')[0];
  }
}

export const profile = new ProfileService();