import { supabase } from './supabase.js';
import { Signal } from '../utils/Signals.js';

class AuthService {
  constructor() {
    this.user = null;

    this.signals = {
      login: new Signal(),
      logout: new Signal()
    };

    this.init();
  }

  async init() {
    const { data: { session } } = await supabase.auth.getSession();
    this.user = session?.user || null;

    if (this.user) {
      this.signals.login.dispatch(this.user);
    }

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        this.user = session.user;
        this.signals.login.dispatch(session.user);
      }

      if (event === 'SIGNED_OUT') {
        this.user = null;
        this.signals.logout.dispatch();
      }
    });
  }

  async login(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  async signup(email, password) {
    return supabase.auth.signUp({ email, password });
  }

  async logout() {
    return supabase.auth.signOut();
  }

  isLoggedIn() {
    return !!this.user;
  }
}

export const auth = new AuthService();
