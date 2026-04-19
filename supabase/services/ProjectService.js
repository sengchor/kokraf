import { supabase } from '../supabase.js';
import { auth } from './AuthService.js';
import { createEmptyProject } from '/js/utils/ProjectFactory.js';

export async function createProject(projectId, name = 'Untitled Project') {
  const user = auth.user;

  const { data, error } = await supabase
    .from('projects')
    .insert({
      id: projectId,
      user_id: user.id,
      name: name
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

export async function saveProject(editor, {name = null, override = false} = {}) {
  const json = editor.toJSON();
  const camera = editor.cameraManager.camera;
  const blob = await editor.renderer.captureThumbnail(editor.sceneManager, camera);

  try {
    if (override) {
      await uploadProject(json, editor.currentProjectId);
      await uploadThumbnail(blob, editor.currentProjectId);
    } else {
      const project = await createProject(editor.currentProjectId, name);
      editor.currentProjectId = project.id;

      const [filePath] = await Promise.all([
        uploadProject(json, project.id),
        uploadThumbnail(blob, project.id)
      ]);

      await updateProjectFilePath(project.id, filePath);
    }

    history.replaceState(null, '', `/?projectId=${editor.currentProjectId}`);
  } catch (err) {
    console.error('Save failed:', err);
  }
}

export async function uploadProject(json, projectId) {
  const user = auth.user;

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
    .select('id, name, created_at, is_public')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching projects:', error);
    return [];
  }

  return data;
}

export async function deleteProject(projectId) {
  const user = auth.user;
  
  const { data: project } = await supabase
    .from('projects')
    .select('file_path')
    .eq('id', projectId)
    .single();

  const pathsToDelete = [];

  if (project?.file_path) {
    pathsToDelete.push(project.file_path);
  }

  if (user) {
    pathsToDelete.push(`${user.id}/${projectId}/thumbnail.webp`);
  }

  if (pathsToDelete.length > 0) {
    await supabase.storage
      .from('projects')
      .remove(pathsToDelete);
  }

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId);

  if (error) throw error;
}

export async function renameProject(projectId, newName) {
  const { error } = await supabase
    .from('projects')
    .update({ name: newName })
    .eq('id', projectId);

  if (error) throw error;
}

export async function setProjectVisibility(projectId, isPublic) {
  const { error } = await supabase
    .from('projects')
    .update({ is_public: isPublic })
    .eq('id', projectId);

  if (error) throw error;
}

export async function uploadThumbnail(blob, projectId) {
  const user = auth.user;

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

export async function createEmptyCloudProject(name = 'Untitled Project') {
  const user = auth.user;
  if (!user) throw new Error('Not authenticated');

  const projectId = crypto.randomUUID();

  const project = await createProject(projectId, name);
  const emptyScene = createEmptyProject(projectId);

  const filePath = await uploadProject(emptyScene, project.id);
  await updateProjectFilePath(project.id, filePath);

  const thumbnailBlob = await fetchThumbnailAsBlob(
    '/assets/images/empty-project-thumbnail.webp'
  );
  await uploadThumbnail(thumbnailBlob, project.id);

  return project;
}

async function fetchThumbnailAsBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load thumbnail');

  return await res.blob();
}