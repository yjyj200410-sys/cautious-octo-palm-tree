import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/src/api/ncm-client', () => ({ ncmApi: {} }));
vi.mock('../../../../../src/renderer/src/ncm/repository', () => ({ NcmRepository: {} }));
vi.mock('../../../../../src/renderer/src/ncm/adapters', () => ({ adaptPlaylistList: vi.fn() }));
import { requireNcmWriteSuccess } from '../../../../../src/renderer/src/ncm/NeteaseSyncService';

describe('NCM mutation result validation', () => {
  it('accepts direct and wrapped business success responses', () => {
    expect(() => requireNcmWriteSuccess({ code: 200 })).not.toThrow();
    expect(() => requireNcmWriteSuccess({ status: 200, body: { code: 200 } })).not.toThrow();
  });
  it('rejects HTTP 200 carrying a business error instead of removing local rows', () => {
    expect(() =>
      requireNcmWriteSuccess({ status: 200, body: { code: 502, message: '无权限' } })
    ).toThrow('无权限');
    expect(() => requireNcmWriteSuccess({ code: 401 })).toThrow();
    expect(() => requireNcmWriteSuccess(undefined)).toThrow();
  });
});
