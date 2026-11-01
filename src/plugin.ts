import { startManagedService, type ManagedService } from './managed-service';
import type { Options } from './config';

let instance: Promise<ManagedService> | undefined;

export default {
  id: 'magpie-speed',
  server: async (_input: unknown, opts: Options = {}) => {
    instance ??= startManagedService(opts).catch((error) => {
      instance = undefined;
      throw error;
    });
    await instance;
    return {};
  },
};
