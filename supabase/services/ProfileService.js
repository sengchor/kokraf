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

  async saveProfile({ displayName, username, about }) {
    const user = auth.user;
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        id: user.id,
        display_name: displayName,
        username: username,
        about: about
      });

    if (error) throw error;

    this.profile = {
      ...this.profile,
      displayName,
      username,
      about
    }

    return this.profile;
  }

  extractNameFromEmail(email) {
    if (!email) return 'User';
    return email.split('@')[0].replace(/[+.]/g, '');
  }
}

export const profile = new ProfileService();