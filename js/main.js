import Editor from './Editor.js';
import { supabase } from './login/supabase.js';

async function main() {
  try {
    const editor = new Editor();
    await editor.init();

    // --- CHECK SESSION ON PAGE LOAD ---
    const { data: { session } } = await supabase.auth.getSession();

    if (session && session.user) {
      editor.signals.userLoggedIn.dispatch(session.user);
    }

    // --- LISTEN TO AUTH STATE CHANGES ---
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        editor.signals.userLoggedIn.dispatch(session.user);
      }

      if (event === 'SIGNED_OUT') {
        editor.signals.userLoggedOut.dispatch();
      }
    });

  } catch (error) {
    console.error('Failed to initialize editor:', error);
    indexedDB.deleteDatabase('kokraf-storage');
  }
}

main();