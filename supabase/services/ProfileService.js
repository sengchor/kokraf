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

      bannerUrl:
        saved?.banner_url || null,

      about: saved?.about || null,
    };

    return this.profile;
  }

  async loadPublicProfiles(userIds) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, display_name, username, avatar_url')
      .in('id', userIds);

    if (error) { console.error(error); return {}; }

    return Object.fromEntries((data || []).map(p => [p.id, p]));
  }

  async saveProfile({ displayName, username, about, avatarUrl, bannerUrl }) {
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
        banner_url: bannerUrl,
      });

    if (error) throw error;

    this.profile = {
      ...this.profile,
      displayName,
      username,
      about,
      avatarUrl,
      bannerUrl,
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

  async uploadAvatar(file) {
    const user = auth.user;
    if (!user) throw new Error('Not authenticated');

    const converted = await this.convertToWebP(file);
    
    const uniqueId = Date.now();
    const filePath = `${user.id}/avatar_${uniqueId}.webp`;

    const { error } = await supabase.storage
      .from('users')
      .upload(filePath, converted, { contentType: 'image/webp' });

    if (error) throw error;

    supabase.storage.from('users').list(user.id).then(({ data: files }) => {
      if (files) {
        const oldAvatars = files
          .filter(f => f.name.includes('avatar') && f.name !== `avatar_${uniqueId}.webp`)
          .map(f => `${user.id}/${f.name}`);
        
        if (oldAvatars.length > 0) {
          supabase.storage.from('users').remove(oldAvatars);
        }
      }
    });

    const { data } = supabase.storage.from('users').getPublicUrl(filePath);
    return data.publicUrl; 
  }

  async uploadBanner(file) {
    const user = auth.user;
    if (!user) throw new Error('Not authenticated');

    const converted = await this.convertToWebP(file);
    
    const uniqueId = Date.now();
    const filePath = `${user.id}/banner_${uniqueId}.webp`;

    const { error } = await supabase.storage
      .from('users')
      .upload(filePath, converted, { contentType: 'image/webp' });

    if (error) throw error;

    supabase.storage.from('users').list(user.id).then(({ data: files }) => {
      if (files) {
        const oldBanners = files
          .filter(f => f.name.includes('banner') && f.name !== `banner_${uniqueId}.webp`)
          .map(f => `${user.id}/${f.name}`);
        
        if (oldBanners.length > 0) {
          supabase.storage.from('users').remove(oldBanners);
        }
      }
    });

    const { data } = supabase.storage.from('users').getPublicUrl(filePath);
    return data.publicUrl; 
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

  cropToAspectRatio(file, aspectRatio) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        let srcX = 0, srcY = 0;
        let srcW = img.width, srcH = img.height;

        const imageRatio = img.width / img.height;

        if (imageRatio > aspectRatio) {
          // Wider than target — crop sides
          srcW = Math.round(img.height * aspectRatio);
          srcX = Math.round((img.width - srcW) / 2);
        } else {
          // Taller than target — crop top/bottom
          srcH = Math.round(img.width / aspectRatio);
          srcY = Math.round((img.height - srcH) / 2);
        }

        const canvas = document.createElement('canvas');
        canvas.width  = srcW;
        canvas.height = srcH;

        canvas.getContext('2d').drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

        URL.revokeObjectURL(url);

        canvas.toBlob(resolve, file.type);
      };

      img.src = url;
    });
  }
}

export const profile = new ProfileService();