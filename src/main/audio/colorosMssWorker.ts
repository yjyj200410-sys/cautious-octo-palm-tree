import { parentPort, workerData } from 'node:worker_threads';

import type { MssPacket } from '../../common/colorosMss';
import { createMssModel } from './colorosMssModel';

async function initialize() {
  const model = await createMssModel(workerData.modelPath);
  parentPort!.postMessage({ type: 'ready', modelBytes: model.modelBytes });
  let queue = Promise.resolve();
  let closing = false;
  parentPort!.on('message', (message: { type: string; id: number; packet: MssPacket }) => {
    if (message.type === 'shutdown' && !closing) {
      closing = true;
      queue = queue.then(async () => {
        await model.dispose();
        parentPort!.close();
        return undefined;
      });
    } else if (message.type === 'infer' && !closing) {
      queue = queue.then(async () => {
        try {
          const result = await model.process(message.packet);
          parentPort!.postMessage({ type: 'result', id: message.id, result }, [
            result.vocals.buffer
          ]);
        } catch (error) {
          parentPort!.postMessage({
            type: 'error',
            id: message.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return undefined;
      });
    }
  });
}
initialize().catch((error) => {
  parentPort!.postMessage({
    type: 'init-error',
    error: error instanceof Error ? error.message : String(error)
  });
  parentPort!.close();
});
