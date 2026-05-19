import { supabase } from '/supabase/supabase.js';

export class NanoBanana {
  static async generate(imageInputs, options = {}) {
    const { prompt } = options;

    if (!prompt) throw new Error('NanoBanana: prompt is required');
    if (!Array.isArray(imageInputs) || imageInputs.length === 0)
      throw new Error('NanoBanana: imageInputs must be a non-empty array');

    // Accept Blobs, URLs, or data URLs — normalize everything to URL strings
    const image_input = await Promise.all(imageInputs.map(input => this._toUrl(input)));

    const { data, error } = await supabase.functions.invoke('generate-texture', {
      body: { prompt, image_input },
    });

    if (error) throw new Error(`generate-nano-banana: ${error.message}`);

    const urls = Array.isArray(data.url) ? data.url : [data.url];
    return urls.map(url => ({ url }));
  }

  static async _toUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof Blob || input instanceof File) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); // data URL — Replicate accepts these
        reader.onerror = reject;
        reader.readAsDataURL(input);
      });
    }
    throw new Error('NanoBanana: unsupported input type');
  }
}