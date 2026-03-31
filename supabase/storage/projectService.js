import { supabase } from '../supabase.js';
import { auth } from '../AuthService.js';

export async function createProject(name = 'Untitled Project') {
  const user = auth.user;

  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: name
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

export async function uploadProject(editor, projectId) {
  const user = auth.user;

  const json = editor.toJSON();
  const jsonString = JSON.stringify(json);

  const filePath = `${user.id}/${projectId}/latest.json`;

  const blob = new Blob([jsonString], { type: 'application/json' });

  const { error } = await supabase.storage
    .from('projects')
    .upload(filePath, blob, {
      contentType: 'application/json',
      upsert: true
    });

  if (error) throw error;

  console.log(`Project uploaded to cloud: ${filePath}`);

  return filePath;
}