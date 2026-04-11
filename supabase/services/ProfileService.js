import { auth } from './AuthService.js';
import { supabase } from '../supabase.js';

class ProfileService {
  constructor() {
    this.profile = null;
  }

  async loadProfile() {
    const user = auth.user;
    if (!user) return null;

    const metadata = user.user_metadata || {};

    // Check user_profiles table first
    const { data: saved } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    this.profile = {
      id: user.id,
      email: user.email,

      // Prefer saved data, fall back to Google auth metadata
      displayName:
        saved?.display_name ||
        metadata.full_name ||
        metadata.name ||
        this.extractNameFromEmail(user.email),

      username:
        saved?.username ||
        this.extractNameFromEmail(user.email),

      avatarUrl:
        saved?.avatar_url ||
        metadata.avatar_url ||
        metadata.picture ||
        null,

      about: saved?.about || null,
    };

    return this.profile;
  }

  async saveProfile({ displayName, username, about, avatarUrl }) {
    const user = auth.user;
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        id: user.id,
        display_name: displayName,
        username: username,
        about: about,
        avatar_url: avatarUrl,
      });

    if (error) throw error;

    this.profile = {
      ...this.profile,
      displayName,
      username,
      about,
      avatarUrl,
    };

    return this.profile;
  }

  async uploadAvatar(file) {
    const user = auth.user;
    if (!user) throw new Error('Not authenticated');

    const converted = await this.convertToWebP(file);
    const filePath = `${user.id}/avatar.webp`;

    const { error } = await supabase.storage
      .from('users')
      .upload(filePath, converted, { contentType: 'image/webp', upsert: true });

    if (error) throw error;

    const { data } = supabase.storage.from('users').getPublicUrl(filePath);
    return `${data.publicUrl}?t=${Date.now()}`;
  }

  extractNameFromEmail(email) {
    if (!email) return 'User';
    return email.split('@')[0].replace(/[+.]/g, '');
  }

  convertToWebP(file, quality = 0.85) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = img.width;
        canvas.height = img.height;

        canvas.getContext('2d').drawImage(img, 0, 0);

        URL.revokeObjectURL(url);

        canvas.toBlob(resolve, 'image/webp', quality);
      };

      img.src = url;
    });
  }
}

export const profile = new ProfileService();