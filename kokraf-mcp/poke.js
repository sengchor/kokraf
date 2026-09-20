import { EditorBridge } from './bridge.js';

const [method, rawParams] = process.argv.slice(2);

if (!method) {
  console.error('usage: node poke.js <method> [json-params]');
  process.exit(1);
}

let params = {};
if (rawParams) {
  try {
    params = JSON.parse(rawParams);
  } catch (err) {
    console.error(`Bad JSON params: ${err.message}`);
    process.exit(1);
  }
}

const bridge = new EditorBridge({
  port: Number(process.env.KOKRAF_BRIDGE_PORT ?? 7331),
  token: process.env.KOKRAF_BRIDGE_TOKEN ?? null,
  log: (msg) => console.error(`[bridge] ${msg}`),
});

try {
  await bridge.start();
  console.error('[poke] waiting for editor (up to 20s)...');
  await bridge.waitForEditor(20000);
  const result = await bridge.call(method, params);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 0;
} catch (err) {
  console.error(`error: ${err.message}`);
  if (err.editorStack) console.error(err.editorStack);
  process.exitCode = 1;
} finally {
  await bridge.stop();
}