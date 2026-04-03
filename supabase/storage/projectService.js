import { supabase } from '../supabase.js';
import { auth } from '../AuthService.js';

export async function createProject(editor, name = 'Untitled Project') {
  const user = auth.user;

  const { data, error } = await supabase
    .from('projects')
    .insert({
      id: editor.currentProjectId,
      user_id: user.id,
      name: name
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

export async function saveProject(editor, {name = null, override = false} = {}) {
  if (override) {
    await uploadProject(editor, editor.currentProjectId);
    await uploadThumbnail(editor, editor.currentProjectId);
  } else {
    const project = await createProject(editor, name);
    const [filePath] = await Promise.all([
      uploadProject(editor, project.id),
      uploadThumbnail(editor, project.id)
    ]);
    await updateProjectFilePath(project.id, filePath);
  }
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
  else {
    history.replaceState(null, '', `/?projectId=${projectId}`);
  }

  console.log(`Project uploaded to cloud: ${filePath}`);

  return filePath;
}

export async function updateProjectFilePath(projectId, filePath) {
  const { error } = await supabase
    .from('projects')
    .update({ file_path: filePath })
    .eq('id', projectId);

  if (error) throw error;
}

export async function projectExistsInCloud(projectId) {
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

export async function loadProject(editor, projectId) {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('file_path')
    .eq('id', projectId)
    .maybeSingle();

  if (projectError) throw projectError;

  if (!project || !project.file_path) {
    throw new Error('Project not found or missing file path');
  }

  const filePath = project.file_path;

  const { data: blob, error: downloadError } = await supabase.storage
    .from('projects')
    .download(filePath);

  if (downloadError) throw downloadError;

  const text = await blob.text();
  const json = JSON.parse(text);

  // Load into editor
  editor.sceneManager.emptyAllScenes();
  editor.fromJSON(json);
  requestAnimationFrame(() => editor.panelResizer.onWindowResize());

  console.log(`Project loaded from cloud: ${filePath}`);
}

export async function getUserProjects() {
  const user = auth.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching projects:', error);
    return [];
  }

  return data;
}

export async function deleteProject(projectId) {
  const { data: project } = await supabase
    .from('projects')
    .select('file_path')
    .eq('id', projectId)
    .single();

  console.log(project.file_path);
  if (project?.file_path) {
    await supabase.storage.from('projects').remove([project.file_path]);
  }

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId);

  if (error) throw error;
}

export async function uploadThumbnail(editor, projectId) {
  const user = auth.user;

  const camera = editor.cameraManager.camera;
  const blob = await editor.renderer.captureThumbnail(editor.sceneManager, camera);

  const filePath = `${user.id}/${projectId}/thumbnail.webp`;

  const { error } = await supabase.storage
    .from('projects')
    .upload(filePath, blob, {
      contentType: 'image/webp',
      upsert: true
    });

  if (error) throw error;
  return filePath;
}

export async function getThumbnailUrl(projectId) {
  const user = auth.user;
  if (!user) return null;

  const { data, error } = await supabase.storage
    .from('projects')
    .createSignedUrl(
      `${user.id}/${projectId}/thumbnail.webp`,
      60 * 60
    );

  if (error) {
    console.error('Thumbnail URL error:', error);
    return null;
  }

  return data.signedUrl;
}