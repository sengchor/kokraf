import { supabase } from '/supabase/supabase.js';

export class StableDiffusion {
  static async generateFromBlob(imageBlob, options = {}) {
    const { prompt, negativePrompt, imageStrength, cfgScale, steps } = options;

    if (!prompt) throw new Error('StableDiffusion: prompt is required');

    const imageBase64 = await this._blobToBase64(imageBlob);

    const { data, error } = await supabase.functions.invoke('generate-texture', {
      body: { imageBase64, prompt, negativePrompt, imageStrength, cfgScale, steps },
    });

    if (error) throw new Error(`generate-texture: ${error.message}`);

    return data.artifacts.map(artifact => {
      const bytes = Uint8Array.from(atob(artifact.base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      return { blob, url };
    });
  }

  static _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}